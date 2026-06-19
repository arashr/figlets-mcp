'use strict';

/**
 * apply-ds-setup.js
 * MCP tool handler for apply_ds_setup.
 *
 * Reads the prepared design-system.config.js, sends the full DS object to the
 * bridge plugin via /request-ds-setup, and waits for the plugin to create all
 * 5 variable collections. Returns the list of built collection names.
 *
 * Precondition: prepare_ds_config must have been called first (failCount === 0).
 */

const path = require('path');
const { getConfigPathGuardError } = require('../utils/paths.js');
const { requestBridgePost } = require('../bridges/bridge-request.js');

function _loadDsConfigCore() {
  try {
    return require("../figlets-core.js").dsConfig;
  } catch (_) {
    return require("../figlets-core.js").dsConfig;
  }
}

function _contrastRepairOptions(pairSuggestions) {
  const options = [];
  for (const key of Object.keys(pairSuggestions || {})) {
    const suggestion = pairSuggestions[key] || {};
    const parts = String(key || "").split("|");
    const background = parts[0] || suggestion.bg || "";
    const text = parts[1] || suggestion.text || "";
    for (const mode of Object.keys(suggestion)) {
      const suggestedText = suggestion[mode];
      if (!background || !text || !suggestedText) continue;
      options.push({
        id: `${background}|${text}|${mode}`,
        background,
        text,
        mode,
        suggestedText,
      });
    }
  }
  return options;
}

function _staleSemanticRefs(ds) {
  const staleSemantics = [];
  const utilityRampNames = new Set(['neutral', 'red', 'green', 'yellow', 'blue', 'neutral-variant']);
  const configuredBrandNames = new Set((((ds || {}).color || {}).brand || []).map(item => item && item.name).filter(Boolean));
  function check(token, ref) {
    if (!ref || typeof ref !== 'string') return;
    const match = ref.match(/^color\/([^/]+)\/\d+$/);
    if (!match) return;
    const rampName = match[1];
    if (!configuredBrandNames.has(rampName) && !utilityRampNames.has(rampName)) {
      staleSemantics.push({ token, ref, currentName: rampName });
    }
  }
  const semantics = ds && ds.color && ds.color.semantics || {};
  for (const pair of (semantics.pairs || [])) {
    const pairLabel = pair.bg || 'pair';
    if (pair.Light) { check(pairLabel, pair.Light.bg); check(pairLabel, pair.Light.text); }
    if (pair.Dark) { check(pairLabel, pair.Dark.bg); check(pairLabel, pair.Dark.text); }
  }
  for (const icon of (semantics.icons || [])) {
    check(icon.token, icon.Light);
    check(icon.token, icon.Dark);
  }
  for (const item of (semantics.unpaired || [])) {
    check(item.token || 'unpaired', item.Light);
    check(item.token || 'unpaired', item.Dark);
  }
  return staleSemantics;
}

function _writeDesignMdExport(configPath) {
  try {
    let designMdIntake;
    try {
      designMdIntake = require("../figlets-core.js").dsConfig.designMdIntake;
    } catch (_) {
      designMdIntake = require("../figlets-core.js").dsConfig.designMdIntake;
    }
    if (designMdIntake && designMdIntake.writeDesignMdFromDsConfig) {
      return designMdIntake.writeDesignMdFromDsConfig(configPath);
    }
  } catch (_) {}
  return null;
}

function handleApplyDsSetup({ config_path }) {
  const resolvedPath = path.resolve(config_path);
  const guardError = getConfigPathGuardError(resolvedPath);
  if (guardError) return Promise.resolve(guardError);

  const core = _loadDsConfigCore();
  const readDsConfig = core.readDsConfig;

  let ds;
  try {
    ds = readDsConfig(resolvedPath);
  } catch (err) {
    return Promise.resolve({
      error: err.message,
      hint: 'Run prepare_ds_config first to compute and validate the config.',
    });
  }

  // Verify the config is ready — must have color ramps and no failing pairs
  if (!ds.color || !ds.color.ramps || !ds.color.ramps.length) {
    return Promise.resolve({
      error: 'Config is missing DS.color.ramps. Run prepare_ds_config first.',
    });
  }
  if (!ds.spacing || !ds.primitives) {
    return Promise.resolve({
      error: 'Config is missing spacing/primitives data. Run prepare_ds_config first.',
    });
  }

  let validation;
  try {
    validation = core.validateSemanticPairs(ds);
  } catch (err) {
    return Promise.resolve({
      error: `Config is not ready to build: ${err.message}`,
      hint: 'Run prepare_ds_config and resolve setup readiness findings before apply_ds_setup.',
    });
  }
  if ((validation.failCount || 0) > 0) {
    return Promise.resolve({
      error: `Config is not ready to build: ${validation.failCount} semantic color pair(s) fail contrast.`,
      failCount: validation.failCount,
      contrastRepairTool: 'apply_ds_config_contrast_repairs',
      contrastRepairOptions: _contrastRepairOptions(validation.pairSuggestions || {}),
      hint: 'Apply approved semanticPairs.contrastRepairOptions to the config, rerun prepare_ds_config, and call apply_ds_setup only when readyToBuild is true.',
    });
  }
  const staleSemantics = _staleSemanticRefs(validation.ds || ds);
  if (staleSemantics.length) {
    return Promise.resolve({
      error: `Config is not ready to build: ${staleSemantics.length} semantic reference(s) point to ramps outside the current brand/utility palette.`,
      staleSemantics,
      hint: 'Run prepare_ds_config and resolve stale semantic references before apply_ds_setup.',
    });
  }

  return requestBridgePost('/request-ds-setup', ds, { timeoutMs: 185000 }).then((response) => {
    if (response.statusCode === 200) {
      const parsed = response.data || {};
      const result = parsed.result || {};
      const designMdPath = _writeDesignMdExport(resolvedPath);
      return {
        collections: result.collections || [],
        skipped:     result.skipped || [],
        message:     result.message || 'DS setup complete.',
        designMdExport: designMdPath ? { path: designMdPath } : null,
        configPath:  resolvedPath,
      };
    }
    if (response.connectionError) {
      return { error: response.connectionError };
    }
    if (response.statusCode === 503) {
      return { error: 'Figma plugin is not connected. Open the Figlets Bridge plugin in Figma Desktop and try again.' };
    }
    if (response.statusCode === 504) {
      return { error: 'DS setup timed out. For large systems this can take 3+ minutes — try again with the plugin open.' };
    }
    return { error: `Unexpected status ${response.statusCode}` };
  });
}

module.exports = { handleApplyDsSetup };
