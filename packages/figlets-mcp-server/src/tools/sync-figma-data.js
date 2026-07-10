const fs = require("fs");
const { getActiveFileKey, getActiveFilePaths, getFilePaths, writeActiveFile } = require("../utils/paths.js");
const { ensureActiveDsConfig } = require("../utils/ensure-ds-config.js");
const { formatPluginNotListening, requestBridgePost } = require("../bridges/bridge-request.js");
const { handleRefreshDsConfigFromFigma } = require("./refresh-ds-config-from-figma.js");

const syncFigmaDataTool = {
  name: "sync_figma_data",
  description: "Triggers the local Figma Bridge plugin to wake up, extract all variables, styles, and components, save them to the local workspace, and silently refresh compatible local Figlets config values. This tool will block and wait until the sync is complete.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

function _syncErrorMessage(response) {
  const parsed = response.data || {};
  if (response.connectionError) return response.connectionError;
  if (response.statusCode === 503) {
    return formatPluginNotListening("sync", parsed, {
      fallbackHint: "Open the Figlets Bridge plugin in Figma Desktop on the target file, then try again."
    });
  }
  if (response.statusCode === 504) {
    return "Sync timed out. Keep the Figlets Bridge plugin open in Figma Desktop and try again.";
  }
  return `Sync failed with status ${response.statusCode}: ${response.raw || JSON.stringify(parsed)}`;
}

function _refreshExistingConfigAfterSync(configStatus, activePaths, parsed) {
  const configPath = configStatus && configStatus.configPath
    ? configStatus.configPath
    : (activePaths ? activePaths.config : null);
  const snapshotPath = parsed && parsed.dataPath
    ? parsed.dataPath
    : (activePaths ? activePaths.data : null);
  const base = {
    attempted: false,
    applied: false,
    compatible: null,
    changedCount: 0,
    skippedCount: 0,
    message: null,
  };
  if (!configPath || !fs.existsSync(configPath)) {
    return Object.assign({}, base, {
      message: "No file-scoped config exists yet, so no compatible config refresh was attempted.",
    });
  }
  if (configStatus && (configStatus.created || configStatus.refreshed)) {
    return Object.assign({}, base, {
      compatible: true,
      message: configStatus.message || "Config was already created or refreshed from the synced Figma snapshot.",
    });
  }

  const args = {
    config_path: configPath,
    compatible_only: true,
  };
  if (snapshotPath) args.figmaDataPath = snapshotPath;

  try {
    const refresh = handleRefreshDsConfigFromFigma(args);
    const summary = refresh && refresh.summary ? refresh.summary : {};
    return {
      attempted: true,
      applied: !(refresh && refresh.error),
      compatible: refresh && typeof refresh.compatible === "boolean" ? refresh.compatible : !(refresh && refresh.error),
      changedCount: summary.changedCount || 0,
      skippedCount: summary.skippedCount || 0,
      message: (refresh && (refresh.message || refresh.error)) || null,
    };
  } catch (err) {
    return {
      attempted: true,
      applied: false,
      compatible: false,
      changedCount: 0,
      skippedCount: 0,
      message: err.message,
    };
  }
}

function _syncSuccessPayload(parsed, beforeFileKey) {
  if (parsed.fileKey) writeActiveFile(parsed.fileKey);
  const afterFileKey = parsed.fileKey || getActiveFileKey();
  const activePaths = afterFileKey ? getFilePaths(afterFileKey) : getActiveFilePaths();
  const activeFileChanged = Boolean(beforeFileKey && afterFileKey && beforeFileKey !== afterFileKey);
  const configStatus = ensureActiveDsConfig({ reason: "sync-figma-data", refreshGenerated: true });
  const configRefresh = _refreshExistingConfigAfterSync(configStatus, activePaths, parsed);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          message: "Sync complete! The local Figma data snapshot has been updated.",
          activeFile: {
            previousFileKey: beforeFileKey || null,
            fileKey: afterFileKey || null,
            changed: activeFileChanged,
            snapshotPath: parsed.dataPath || (activePaths ? activePaths.data : null),
            configPath: activePaths ? activePaths.config : null,
            configExists: Boolean(configStatus.configExists),
            configCreated: Boolean(configStatus.created),
            configRefreshed: Boolean(configStatus.refreshed),
            configMessage: configStatus.message || null,
            configRefresh,
          },
          sessionId: parsed.sessionId || null,
        }, null, 2)
      }
    ]
  };
}

function handleSyncFigmaData(args = {}) {
  const beforeFileKey = getActiveFileKey();
  return requestBridgePost("/request-sync", {}, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
    receiverUrl: args.receiverUrl,
  }).then((response) => {
    if (response.statusCode === 200) {
      return _syncSuccessPayload(response.data || {}, beforeFileKey);
    }
    throw new Error(_syncErrorMessage(response));
  });
}

module.exports = {
  syncFigmaDataTool,
  handleSyncFigmaData
};
