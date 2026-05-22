'use strict';

/**
 * update-ds-primitives.js
 * MCP tool handler for update_ds_primitives.
 *
 * Reads a prepared design-system.config.js and asks the bridge plugin to
 * overwrite values of EXISTING variables in the Primitives collection that
 * match the requested categories (e.g. color, spacing). It can also refresh
 * Color collection semantic aliases that point at those primitives. Pass
 * dry_run first when the designer needs to review missing-variable repairs
 * before any Figma variables are created or changed. Variable IDs are
 * preserved, so existing component bindings keep resolving.
 *
 * Use this when ramps or other primitive values change but the rest of the
 * design system has not. For first-time creation, use apply_ds_setup.
 *
 * Categories supported today: "color", "spacing", "color-semantics", "primitive-typography", "primitive-shadow".
 * The plugin's UPDATE_PRIMITIVE_SPECS map is the source of truth for the full
 * set; unknown categories are reported back, never silently ignored.
 */

const path = require('path');
const { requestBridgePost } = require('../bridges/bridge-request.js');
const { getConfigPathGuardError } = require('../utils/paths.js');

const updateDsPrimitivesTool = {
  name: 'update_ds_primitives',
  description:
    'Update existing variable values and semantic aliases in place, without recreating collections or breaking bindings. Pass dry_run=true first to report proposed updates and missing variables for designer confirmation. Pass a prepared design-system.config.js path and an optional list of categories (e.g. ["color"], ["spacing"], ["color-semantics"], ["primitive-typography"], ["primitive-shadow"]). Use after re-running prepare_ds_config to push changed primitive values, primitive typography and shadow tokens in the Primitives collection, and Color collection aliases into Figma.',
  inputSchema: {
    type: 'object',
    properties: {
      config_path: {
        type: 'string',
        description: 'Absolute path to design-system.config.js (must have been prepared by prepare_ds_config).',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of categories to update. Supported today: "color", "spacing", "color-semantics", "primitive-typography", "primitive-shadow". Defaults to color, spacing, and color-semantics when omitted.',
      },
      create_missing: {
        type: 'boolean',
        description: 'When true, add missing primitive variables in the existing Primitives collection before setting their values. Existing variable IDs are preserved.',
      },
      dry_run: {
        type: 'boolean',
        description: 'When true, report variables that would be created or updated but do not mutate Figma. Use this for designer confirmation before create_missing repairs.',
      },
      prune_off_scale: {
        type: 'boolean',
        description: 'When true, delete primitive color variables whose step number is not in the configured scale (e.g. removes /50 and /950 orphans after switching from a 50-950 to a 100-900 scale).',
      },
      prune_unused_ramps: {
        type: 'boolean',
        description: 'When true, delete primitive color variables that belong to ramp folders not present in the current DS.color.ramps config (e.g. removes an old "peach" ramp entirely after a rebrand). Only removes color/<name>/<step> shaped variables with a numeric leaf.',
      },
    },
    required: ['config_path'],
  },
};

function handleUpdateDsPrimitives(args) {
  const configPath = args && args.config_path;
  const categories = args && Array.isArray(args.categories) ? args.categories : undefined;
  const createMissing    = !!(args && args.create_missing);
  const dryRun           = !!(args && args.dry_run);
  const pruneOffScale    = !!(args && args.prune_off_scale);
  const pruneUnusedRamps = !!(args && args.prune_unused_ramps);

  if (!configPath) {
    return Promise.resolve({ error: 'config_path is required.' });
  }

  const resolvedPath = path.resolve(configPath);
  const guardError = getConfigPathGuardError(resolvedPath);
  if (guardError) return Promise.resolve(guardError);

  let readDsConfig;
  try {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (e) {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  }

  let ds;
  try {
    ds = readDsConfig(resolvedPath);
  } catch (err) {
    return Promise.resolve({
      error: err.message,
      hint: 'Run prepare_ds_config first to compute and validate the config.',
    });
  }

  const requestedCategories = Array.isArray(categories) && categories.length
    ? categories
    : ['color', 'spacing', 'color-semantics'];
  const needsColor = requestedCategories.some(cat => cat === 'color' || cat === 'color-semantics');
  const needsSpacing = requestedCategories.includes('spacing');
  const needsPrimitiveTypography = requestedCategories.includes('primitive-typography');
  const needsPrimitiveShadow = requestedCategories.includes('primitive-shadow');
  const needsPrimitiveGenerator = needsPrimitiveTypography || needsPrimitiveShadow;

  if (needsColor && (!ds.color || !ds.color.ramps || !ds.color.ramps.length)) {
    return Promise.resolve({ error: 'Config is missing DS.color.ramps. Run prepare_ds_config first.' });
  }
  if ((needsSpacing || needsPrimitiveGenerator) && !ds.primitives) {
    return Promise.resolve({ error: 'Config is missing DS.primitives. Run prepare_ds_config first.' });
  }
  if (needsPrimitiveTypography && (!ds.typography || !ds.typography.scale)) {
    return Promise.resolve({ error: 'Config is missing DS.typography.scale. Run prepare_ds_config first.' });
  }

  return requestBridgePost('/request-update-primitives', {
    DS: ds,
    categories: categories,
    createMissing: createMissing,
    dryRun: dryRun,
    pruneOffScale: pruneOffScale,
    pruneUnusedRamps: pruneUnusedRamps,
  }, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
  }).then((response) => {
    if (response.connectionError) {
      return { error: response.connectionError };
    }
    const statusCode = response.statusCode;
    const parsed = response.data || {};
    if (statusCode === 200) {
      const result = parsed.result || {};
      return {
        collection: result.collection,
        dryRun: !!result.dryRun,
        categories: result.categories || [],
        unknownCategories: result.unknownCategories || [],
        report: result.report || {},
        pruned: result.pruned || 0,
        wouldPrune: result.wouldPrune || 0,
        message: result.message || 'Primitives update complete.',
        configPath: resolvedPath,
        error: result.error,
      };
    }
    if (statusCode === 503) {
      const retryHint = parsed.pluginRecentlySeen
        ? 'The plugin was connected recently and may be finishing another action; wait a moment, then try again.'
        : 'Open the Figlets Bridge plugin in Figma Desktop and try again.';
      return {
        error: `Figma plugin is not listening for primitive updates. ${retryHint}`,
        activeSessionId: parsed.activeSessionId || null,
      };
    }
    if (statusCode === 504) {
      return { error: 'Primitive update timed out — try again with the plugin open.' };
    }
    if (statusCode === 409) {
      return {
        error: parsed.error || 'The Figlets Bridge plugin is connected but does not advertise the primitive-update command. If you are developing Figlets, reload the plugin from Figma Desktop so it loads the latest local code.',
        activeSessionId: parsed.activeSessionId || null,
        pluginCapabilities: parsed.pluginCapabilities || [],
      };
    }
    return { error: `Unexpected status ${statusCode}` };
  });
}

module.exports = { updateDsPrimitivesTool, handleUpdateDsPrimitives };
