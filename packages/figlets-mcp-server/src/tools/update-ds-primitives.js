'use strict';

/**
 * update-ds-primitives.js
 * MCP tool handler for update_ds_primitives.
 *
 * Reads a prepared design-system.config.js and asks the bridge plugin to
 * overwrite values of EXISTING variables in the Primitives collection that
 * match the requested categories (e.g. color, spacing). It can also refresh
 * Color collection semantic aliases that point at those primitives. Variable
 * IDs are preserved, so existing component bindings keep resolving.
 *
 * Use this when ramps or other primitive values change but the rest of the
 * design system has not. For first-time creation, use apply_ds_setup.
 *
 * Categories supported today: "color", "spacing", "color-semantics".
 * The plugin's UPDATE_PRIMITIVE_SPECS map is the source of truth for the full
 * set; unknown categories are reported back, never silently ignored.
 */

const http = require('http');
const path = require('path');

const updateDsPrimitivesTool = {
  name: 'update_ds_primitives',
  description:
    'Update existing variable values and semantic aliases in place, without recreating collections or breaking bindings. Pass a prepared design-system.config.js path and an optional list of categories (e.g. ["color"], ["spacing"], ["color-semantics"]). Use after re-running prepare_ds_config to push changed primitive values and Color collection aliases into Figma.',
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
        description: 'Optional list of categories to update. Supported today: "color", "spacing", "color-semantics". Defaults to all supported categories.',
      },
      create_missing: {
        type: 'boolean',
        description: 'When true, add missing primitive variables in the existing Primitives collection before setting their values. Existing variable IDs are preserved.',
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
  const pruneOffScale    = !!(args && args.prune_off_scale);
  const pruneUnusedRamps = !!(args && args.prune_unused_ramps);

  if (!configPath) {
    return Promise.resolve({ error: 'config_path is required.' });
  }

  const resolvedPath = path.resolve(configPath);
  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || 'http://localhost:1337';

  let readDsConfig;
  try {
    ({ readDsConfig } = require('@figlets/core').dsConfig);
  } catch (e) {
    ({ readDsConfig } = require('../../../figlets-core/src/ds-config/index.js'));
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

  if (!ds.color || !ds.color.ramps || !ds.color.ramps.length) {
    return Promise.resolve({ error: 'Config is missing DS.color.ramps. Run prepare_ds_config first.' });
  }
  if (!ds.primitives) {
    return Promise.resolve({ error: 'Config is missing DS.primitives. Run prepare_ds_config first.' });
  }

  const body = JSON.stringify({ DS: ds, categories: categories, createMissing: createMissing, pruneOffScale: pruneOffScale, pruneUnusedRamps: pruneUnusedRamps });

  return new Promise((resolve) => {
    const req = http.request(`${receiverUrl}/request-update-primitives`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (e) {}
          const result = parsed.result || {};
          resolve({
            collection: result.collection,
            categories: result.categories || [],
            unknownCategories: result.unknownCategories || [],
            report: result.report || {},
            message: result.message || 'Primitives update complete.',
            configPath: resolvedPath,
            error: result.error,
          });
        } else if (res.statusCode === 503) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (e) {}
          const retryHint = parsed.pluginRecentlySeen
            ? 'The plugin was connected recently and may be finishing another action; wait a moment, then try again.'
            : 'Open the Figlets Bridge plugin in Figma Desktop and try again.';
          resolve({
            error: `Figma plugin is not listening for primitive updates. ${retryHint}`,
            activeSessionId: parsed.activeSessionId || null,
          });
        } else if (res.statusCode === 504) {
          resolve({ error: 'Primitive update timed out — try again with the plugin open.' });
        } else if (res.statusCode === 409) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (e) {}
          resolve({
            error: parsed.error || 'The Figlets Bridge plugin is connected but does not advertise the primitive-update command. If you are developing Figlets, reload the plugin from Figma Desktop so it loads the latest local code.',
            activeSessionId: parsed.activeSessionId || null,
            pluginCapabilities: parsed.pluginCapabilities || [],
          });
        } else {
          resolve({ error: `Unexpected status ${res.statusCode}` });
        }
      });
    });

    req.setTimeout(65000, () => {
      req.destroy();
      resolve({ error: 'Request timed out. The plugin may still be updating — check Figma.' });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({ error: 'Bridge receiver is not running. The MCP server should start it automatically — try restarting the MCP host.' });
      } else {
        resolve({ error: err.message });
      }
    });

    req.write(body);
    req.end();
  });
}

module.exports = { updateDsPrimitivesTool, handleUpdateDsPrimitives };
