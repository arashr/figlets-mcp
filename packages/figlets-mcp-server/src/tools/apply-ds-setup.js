'use strict';

/**
 * apply-ds-setup.js
 * MCP tool handler for apply_ds_setup.
 *
 * Reads the prepared design-system.config.js, prepares the primitive inventory
 * in core/server code, and sends a setup execution payload to the bridge plugin
 * via /request-ds-setup. Returns the list of built collection names.
 *
 * Precondition: preparation is complete; contrast warnings may be acknowledged by the designer.
 */

const path = require('path');
const fs = require('fs');
const { getConfigPathGuardError } = require('../utils/paths.js');
const { loadFigmaDataSource } = require('../bridges/figma-data-source.js');
const { requestFigmaSync } = require('./sync-figma-data.js');
const { planMotionProfileOperationsFromFigmaData, handleApplyDsFigmaOperations } = require('./figma-operations.js');
const {
  prepareDesignMdArtifact,
  writePreparedDesignMdArtifact,
} = require('../utils/design-md-artifact.js');
const { bridgeStatusError, requestBridgePost } = require('../bridges/bridge-request.js');

function _loadDsConfigCore() {
  try {
    return require("../figlets-core.js").dsConfig;
  } catch (_) {
    return require("../figlets-core.js").dsConfig;
  }
}

const { contrastReadiness, contrastRepairOptions: _contrastRepairOptions } = require('../figlets-core.js').dsConfig;

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

  const { resolveTypographyFamily } = require('../figlets-core.js').dsConfig;
  for (const role of Object.keys(scale)) {
    const selected = resolveTypographyFamily(ds.typography, role, scale[role]);
    const fontName = fontPattern.replace('{variant}', selected.variant);
    if (!inventory.names.has(fontName)) errors.push(`missing primitive ${fontName} for typography family aliases (${role})`);
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

async function _setupSnapshot(expectedFileKey) {
  const result = await requestFigmaSync();
  if (!result.dataPath || !result.fileKey) throw new Error('Setup sync did not establish the current Figma file.');
  const source = loadFigmaDataSource({ figmaDataPath: result.dataPath });
  if (source.figmaData.fileKey !== result.fileKey || (expectedFileKey && expectedFileKey !== result.fileKey)) throw new Error('The connected Figma file changed during setup.');
  return { data: source.figmaData, path: source.meta.path, fileKey: result.fileKey };
}

function _setupMotionPlan(snapshot, motion) {
  const plan = planMotionProfileOperationsFromFigmaData(snapshot.data, motion);
  if (plan.error) throw new Error(plan.error);
  if (plan.repairPlan.counts.blocked || plan.repairPlan.counts.ready !== plan.requestedCount) {
    throw new Error('Configured motion could not be fully planned: ' + JSON.stringify(plan.repairPlan.designerPresentation.blocked));
  }
  return plan;
}

async function _completeSetupMotion(core, motion, fileKey, checkConfig) {
  const stages = [];
  try {
    let snapshot = await _setupSnapshot(fileKey);
    // The normal setup approval covers this exact profile. Reuse the existing
    // structural planner and atomic variable writer for its internal stages.
    for (let stage = 0; stage < 2; stage++) {
      checkConfig();
      const verification = core.motionProfileStatus(motion, snapshot.data);
      if (verification.complete) return { complete: true, verification, stages };
      const plan = _setupMotionPlan(snapshot, motion);
      if (stage && plan.phase !== 'motion_variables') throw new Error('Required motion modes are still missing after collection setup.');
      checkConfig();
      const result = await handleApplyDsFigmaOperations({ ...plan.repairPlan.applyInput, figmaDataPath: snapshot.path });
      stages.push({ phase: plan.phase, result });
      if (result.error || result.unresolved.length || result.failed.length || (plan.phase === 'motion_variables' && result.batchStatus !== 'committed')) throw new Error(result.error || 'A required motion setup stage did not complete.');
      snapshot = await _setupSnapshot(fileKey);
    }
    checkConfig();
    const verification = core.motionProfileStatus(motion, snapshot.data);
    if (!verification.complete) throw new Error(verification.errors.join(' '));
    return { complete: true, verification, stages };
  } catch (error) {
    return { complete: false, error: error.message, stages };
  }
}

async function handleApplyDsSetup(args = {}) {
  const { config_path } = args;
  const resolvedPath = path.resolve(config_path);
  const guardError = getConfigPathGuardError(resolvedPath);
  if (guardError) return guardError;

  const core = _loadDsConfigCore();
  const readDsConfig = core.readDsConfig;

  let ds;
  try {
    ds = readDsConfig(resolvedPath);
  } catch (err) {
    return {
      error: err.message,
      hint: 'Run prepare_ds_config first to compute and validate the config.',
    };
  }
  let motion;
  try { motion = core.motionProfilePreview(ds); } catch (err) { return { error: err.message }; }

  // Verify the config is ready — must have color ramps and no failing pairs
  if (!ds.color || !ds.color.ramps || !ds.color.ramps.length) {
    return {
      error: 'Config is missing DS.color.ramps. Run prepare_ds_config first.',
    };
  }
  if (!ds.spacing || !ds.primitives) {
    return {
      error: 'Config is missing spacing/primitives data. Run prepare_ds_config first.',
    };
  }

  let validation;
  try {
    validation = core.validateSemanticPairs(ds);
  } catch (err) {
    return {
      error: `Config is not ready to build: ${err.message}`,
      hint: 'Run prepare_ds_config and resolve setup readiness findings before apply_ds_setup.',
    };
  }
  const contrast = contrastReadiness(ds, validation, args.continue_with_contrast_warnings);
  if (args.continue_with_contrast_warnings === true) core.writeDsConfig(resolvedPath, ds);
  if (!contrast.ready) {
    return {
      error: contrast.referenceErrors.length ? 'Config is not ready to build: some semantic color references cannot be resolved.' : `Config is not ready to build: review or acknowledge ${contrast.blockingCount} text contrast finding(s).`,
      contrast,
      continueInput: contrast.referenceErrors.length ? null : { config_path: resolvedPath, continue_with_contrast_warnings: true },
      failCount: validation.failCount,
      contrastRepairTool: 'apply_ds_config_contrast_repairs',
      contrastRepairOptions: _contrastRepairOptions(validation.pairRepairSuggestions || validation.pairSuggestions || {}, validation.iconRepairSuggestions),
      hint: 'Offer existing semantic alias repairs or use continueInput if the designer already said to continue with the current contrast warnings. Do not ask again, change primitives, or repeat an unchanged repair.',
    };
  }
  if (ds.figlets) validation.ds.figlets = ds.figlets;
  const staleSemantics = _staleSemanticRefs(validation.ds || ds);
  if (staleSemantics.length) {
    return {
      error: `Config is not ready to build: ${staleSemantics.length} semantic reference(s) point to ramps outside the current brand/utility palette.`,
      staleSemantics,
      hint: 'Run prepare_ds_config and resolve stale semantic references before apply_ds_setup.',
    };
  }

  let setupPayload;
  try {
    setupPayload = _buildDsSetupPayload(core, validation.ds || ds);
  } catch (err) {
    return {
      error: err.message || 'Generated setup primitive coverage failed.',
      primitiveCoverageErrors: err.coverageErrors || [],
      hint: 'Run prepare_ds_config again. If this persists, the generated primitive ramp and semantic setup contract are out of sync.',
    };
  }

  const approvedConfig = fs.readFileSync(resolvedPath, 'utf8');
  const checkConfig = () => {
    if (fs.readFileSync(resolvedPath, 'utf8') !== approvedConfig) throw new Error('The approved setup config changed during the build. Review the updated setup before continuing.');
  };
  let preparedArtifact;
  try {
    preparedArtifact = await prepareDesignMdArtifact({
      ds: validation.ds || ds,
      outputPath: path.join(path.dirname(resolvedPath), 'DESIGN.md'),
      renderOptions: { sourcePath: resolvedPath },
    });
  } catch (err) {
    return {
      error: 'DESIGN.md validation failed before setup: ' + err.message,
      hint: 'Rerun prepare_ds_config and resolve the reported artifact validation problem before apply_ds_setup.',
    };
  }
  if (!preparedArtifact.lint.passed) {
    return {
      error: 'Config is not ready to build: DESIGN.md or Figlets policy validation failed.',
      lint: preparedArtifact.lint,
      hint: 'Rerun prepare_ds_config and resolve designMdExport.lint.blockingFindings before apply_ds_setup.',
    };
  }

  try { checkConfig(); } catch (error) { return { error: error.message, collections: [] }; }
  let motionSnapshot;
  if (motion) {
    try {
      motionSnapshot = await _setupSnapshot();
      _setupMotionPlan(motionSnapshot, motion);
      checkConfig();
    } catch (error) { return { error: error.message, motionPending: true, collections: [] }; }
  }

  const response = await requestBridgePost('/request-ds-setup', setupPayload, { timeoutMs: 185000 });
  if (response.statusCode === 200) {
    const parsed = response.data || {};
    const result = parsed.result || {};
    if (result.error) return { error: result.error, fontLoadFailures: result.fontLoadFailures || [], collections: result.collections || [], motionPending: Boolean(motion) };
    let motionResult;
    if (motion) {
      motionResult = await _completeSetupMotion(core, motion, motionSnapshot.fileKey, checkConfig);
      if (!motionResult.complete) return { error: motionResult.error, partial: true, collections: result.collections || [], motionPending: true, motion: motionResult };
    }
    if (ds.figlets && ds.figlets.source === 'figma-snapshot-bootstrap') {
      ds.figlets.foundationRequirementsApproved = true;
      core.writeDsConfig(resolvedPath, ds);
    }
    const written = writePreparedDesignMdArtifact(preparedArtifact, { includeSidecar: true });
    return {
      collections: [...new Set([...(result.collections || []), ...(motion ? [motion.collection] : [])])],
      contrast,
      skipped:     result.skipped || [],
      message: motion ? 'DS setup complete, including the selected motion foundations.' : (result.message || 'DS setup complete.'),
      ...(motion ? { motionPending: false, motion: { ...motion, ...motionResult } } : {}),
      designMdExport: {
        path: written.path,
        sidecarPath: written.sidecarPath,
        lint: preparedArtifact.lint,
      },
      configPath:  resolvedPath,
    };
  }
  return bridgeStatusError(response, {
      action: 'design-system setup',
      includeActiveSession: false,
      timeoutError: 'DS setup timed out. For large systems this can take 3+ minutes — try again with the plugin open.',
  });
}

module.exports = {
  handleApplyDsSetup,
  _buildDsSetupPayload,
  _checkGeneratedSetupPrimitiveCoverage,
};
