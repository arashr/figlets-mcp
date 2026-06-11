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
