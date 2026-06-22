'use strict';

/**
 * apply-ds-setup.js
 * MCP tool handler for apply_ds_setup.
 *
 * Reads the prepared design-system.config.js, prepares the primitive inventory
 * in core/server code, and sends a setup execution payload to the bridge plugin
 * via /request-ds-setup. Returns the list of built collection names.
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

function _primitiveInventory(primitivesData) {
  const names = new Set();
  const floatValues = new Map();
  const addName = (item) => {
    if (item && item.name) names.add(String(item.name));
  };
  for (const item of (primitivesData && primitivesData.colors) || []) addName(item);
  for (const item of (primitivesData && primitivesData.scrims) || []) addName(item);
  for (const item of (primitivesData && primitivesData.strings) || []) addName(item);
  for (const item of (primitivesData && primitivesData.floats) || []) {
    addName(item);
    const value = Number(item && item.value);
    if (!isFinite(value)) continue;
    if (!floatValues.has(value)) floatValues.set(value, new Set());
    floatValues.get(value).add(String(item.name));
  }
  return { names, floatValues };
}

function _typeSizeTokenName(typePrefix, px) {
  const sizeMap = {
    10: '2xs',
    12: 'xs',
    14: 'sm',
    16: 'md',
    18: 'lg',
    20: 'xl',
    24: '2xl',
    30: '3xl',
    36: '4xl',
    48: '5xl',
    60: '6xl',
    72: '7xl',
  };
  return `${typePrefix}/size/${sizeMap[px] || px}`;
}

function _typeTrackingTokenName(typePrefix, tracking) {
  const trackingMap = {
    '-0.02': 'tight',
    '-0.01': 'snug',
    '0': 'normal',
    '0.01': 'open',
    '0.02': 'wide',
    '0.05': 'wider',
    '0.1': 'widest',
  };
  const key = String(tracking);
  return `${typePrefix}/tracking/${trackingMap[key] || key}`;
}

function _typeWeightTokenName(typePrefix, weight) {
  const weightMap = { 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' };
  return `${typePrefix}/weight/${weightMap[weight] || 'regular'}`;
}

function _checkGeneratedSetupPrimitiveCoverage(ds, primitivesData) {
  const errors = [];
  const inventory = _primitiveInventory(primitivesData);
  const typePrefix = (ds.naming && ds.naming.typePrefix) ? ds.naming.typePrefix : 'type';
  const fontPattern = (ds.naming && ds.naming.fontFamily) ? ds.naming.fontFamily : 'font/{variant}';
  const scale = (ds.typography && ds.typography.scale) ? ds.typography.scale : {};

  for (const role of Object.keys(scale)) {
    const roleDef = scale[role] || {};
    for (const size of (roleDef.sizes || [])) {
      const tokenName = _typeSizeTokenName(typePrefix, size);
      if (!inventory.names.has(tokenName)) errors.push(`missing primitive ${tokenName} for typography ${role} size ${size}`);
    }
    const weight = roleDef.weight || 400;
    const weightName = _typeWeightTokenName(typePrefix, weight);
    if (!inventory.names.has(weightName)) errors.push(`missing primitive ${weightName} for typography ${role} weight ${weight}`);
    const tracking = roleDef.tracking != null ? roleDef.tracking : 0;
    const trackingName = _typeTrackingTokenName(typePrefix, tracking);
    if (!inventory.names.has(trackingName)) errors.push(`missing primitive ${trackingName} for typography ${role} tracking ${tracking}`);
  }

  const fontName = fontPattern.replace('{variant}', 'sans');
  if (Object.keys(scale).length && !inventory.names.has(fontName)) {
    errors.push(`missing primitive ${fontName} for typography family aliases`);
  }

  function hasPrimitiveValue(value, predicate) {
    const numeric = Number(value);
    if (!isFinite(numeric)) return true;
    const names = inventory.floatValues.get(numeric);
    return !!(names && Array.from(names).some(predicate));
  }

  function checkPrimitiveValue(kind, token, value, predicate) {
    const numeric = Number(value);
    if (!isFinite(numeric)) return;
    if (!hasPrimitiveValue(numeric, predicate)) errors.push(`missing primitive for ${kind} ${token} value ${numeric}`);
  }

  const spacing = ds.spacing || {};
  for (const token of Object.keys(spacing.semantic || {})) {
    const values = Array.isArray(spacing.semantic[token]) ? spacing.semantic[token] : [spacing.semantic[token]];
    for (const value of values) {
      checkPrimitiveValue('semantic spacing', token, value, name => /^space\/[\d]+(?:[-_][\d]+)*$/.test(name));
    }
  }
  for (const token of Object.keys(spacing.radius || {})) {
    checkPrimitiveValue('radius', token, spacing.radius[token], name => /^radius\/[^/]+$/.test(name));
  }
  for (const token of Object.keys(spacing.border || {})) {
    checkPrimitiveValue('border', token, spacing.border[token], name => /^border\/width\/[^/]+$/.test(name));
  }

  return errors;
}

function _buildDsSetupPayload(core, ds) {
  const primitivesData = core.generatePrimitivesData(ds);
  const coverageErrors = _checkGeneratedSetupPrimitiveCoverage(ds, primitivesData);
  if (coverageErrors.length) {
    const err = new Error('Generated setup primitive coverage failed.');
    err.coverageErrors = coverageErrors;
    throw err;
  }
  return {
    setupPayloadVersion: 1,
    DS: ds,
    primitivesData,
  };
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

  let setupPayload;
  try {
    setupPayload = _buildDsSetupPayload(core, validation.ds || ds);
  } catch (err) {
    return Promise.resolve({
      error: err.message || 'Generated setup primitive coverage failed.',
      primitiveCoverageErrors: err.coverageErrors || [],
      hint: 'Run prepare_ds_config again. If this persists, the generated primitive ramp and semantic setup contract are out of sync.',
    });
  }

  return requestBridgePost('/request-ds-setup', setupPayload, { timeoutMs: 185000 }).then((response) => {
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

module.exports = {
  handleApplyDsSetup,
  _buildDsSetupPayload,
  _checkGeneratedSetupPrimitiveCoverage,
};
