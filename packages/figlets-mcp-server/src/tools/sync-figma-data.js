const http = require("http");
const { getActiveFileKey, getActiveFilePaths, getFilePaths } = require("../utils/paths.js");
const { ensureActiveDsConfig } = require("../utils/ensure-ds-config.js");
const { getReceiverUrl } = require("../utils/receiver-url.js");

const syncFigmaDataTool = {
  name: "sync_figma_data",
  description: "Triggers the local Figma Bridge plugin to wake up, extract all variables, styles, and components, and save them to the local workspace. This tool will block and wait until the sync is complete.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

function handleSyncFigmaData() {
  const receiverUrl = getReceiverUrl();
  const beforeFileKey = getActiveFileKey();
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${receiverUrl}/request-sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            let parsed;
            try { parsed = body ? JSON.parse(body) : {}; } catch (_) { parsed = {}; }
            const afterFileKey = parsed.fileKey || getActiveFileKey();
            const activePaths = afterFileKey ? getFilePaths(afterFileKey) : getActiveFilePaths();
            const activeFileChanged = Boolean(beforeFileKey && afterFileKey && beforeFileKey !== afterFileKey);
            const configStatus = ensureActiveDsConfig({ reason: "sync-figma-data", refreshGenerated: true });
            resolve({
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
                    },
                    sessionId: parsed.sessionId || null,
                  }, null, 2)
                }
              ]
            });
          } else {
            reject(new Error(`Sync failed with status ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on("error", (err) => {
      reject(new Error(`Failed to contact local receiver. Is it running? Error: ${err.message}`));
    });

    req.end();
  });
}

module.exports = {
  syncFigmaDataTool,
  handleSyncFigmaData
};
