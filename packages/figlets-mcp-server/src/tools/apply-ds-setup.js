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

const http = require('http');
const path = require('path');
const { getConfigPathGuardError } = require('../utils/paths.js');

function _writeDesignMdExport(configPath) {
  try {
    let designMdIntake;
    try {
      designMdIntake = require('@figlets/core').dsConfig.designMdIntake;
    } catch (_) {
      designMdIntake = require('../../../figlets-core/src/ds-config/index.js').designMdIntake;
    }
    if (designMdIntake && designMdIntake.writeDesignMdFromDsConfig) {
      return designMdIntake.writeDesignMdFromDsConfig(configPath);
    }
  } catch (_) {}
  return null;
}

function handleApplyDsSetup({ config_path }) {
  const resolvedPath = path.resolve(config_path);
  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || 'http://localhost:1337';
  const guardError = getConfigPathGuardError(resolvedPath);
  if (guardError) return Promise.resolve(guardError);

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

  const body = JSON.stringify(ds);

  return new Promise((resolve) => {
    const req = http.request(`${receiverUrl}/request-ds-setup`, {
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
          try { parsed = JSON.parse(data); } catch {}
          const result = parsed.result || {};
          const designMdPath = _writeDesignMdExport(resolvedPath);
          resolve({
            collections: result.collections || [],
            skipped:     result.skipped || [],
            message:     result.message || 'DS setup complete.',
            designMdExport: designMdPath ? { path: designMdPath } : null,
            configPath:  resolvedPath,
          });
        } else if (res.statusCode === 503) {
          resolve({ error: 'Figma plugin is not connected. Open the Figlets Bridge plugin in Figma Desktop and try again.' });
        } else if (res.statusCode === 504) {
          resolve({ error: 'DS setup timed out. For large systems this can take 3+ minutes — try again with the plugin open.' });
        } else {
          resolve({ error: `Unexpected status ${res.statusCode}` });
        }
      });
    });

    req.setTimeout(185000, () => {
      req.destroy();
      resolve({ error: 'Request timed out. The plugin may still be building — check Figma.' });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({ error: 'Bridge receiver is not running. The MCP server should start it automatically — try restarting Claude Desktop.' });
      } else {
        resolve({ error: err.message });
      }
    });

    req.write(body);
    req.end();
  });
}

module.exports = { handleApplyDsSetup };
