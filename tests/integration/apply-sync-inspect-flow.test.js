/**
 * Same-session apply → sync → inspect must read the healed scoped snapshot,
 * not the stale flat .local/figma-data.json when active-file.json is empty.
 */

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-apply-sync-inspect-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figma-bridge-plugin/src/receiver.js",
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/bridges/figma-data-source.js",
  "../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js",
  "../../packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js",
  "../../packages/figlets-mcp-server/src/tools/sync-figma-data.js",
];
toClear.forEach((modulePath) => {
  try { delete require.cache[require.resolve(modulePath)]; } catch (_) {}
});

const receiver = require("../../packages/figma-bridge-plugin/src/receiver.js");
const { handleInspectDsSetupGaps } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");
const { handleApplyDsSetupRepairs } = require("../../packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js");
const { handleSyncFigmaData } = require("../../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
const { loadActiveFigmaDataSource } = require("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js");

const fileKey = "local_apply_sync_inspect";
const fileName = "Apply Sync Inspect Flow";
const fileDir = path.join(TEMP_DIR, fileKey);
const configPath = path.join(fileDir, "design-system.config.js");

function colorVar(id, name, valuesByMode, variableCollectionId = "semantics") {
  return { id, name, resolvedType: "COLOR", variableCollectionId, valuesByMode };
}

function buildSnapshot(includeCompanion) {
  const variables = [
    colorVar("p-blue-800", "color/blue/800", { default: { r: 0.01, g: 0.02, b: 0.03 } }, "primitives"),
    colorVar("p-blue-100", "color/blue/100", { default: { r: 0.9, g: 0.92, b: 0.96 } }, "primitives"),
    colorVar("surface-info-variant", "color/surface/info-variant", {
      light: { type: "VARIABLE_ALIAS", id: "p-blue-100" },
      dark: { type: "VARIABLE_ALIAS", id: "p-blue-800" },
    }),
    colorVar("on-surface-info", "color/on-surface/info", {
      light: { type: "VARIABLE_ALIAS", id: "p-blue-800" },
      dark: { type: "VARIABLE_ALIAS", id: "p-blue-100" },
    }),
  ];
  if (includeCompanion) {
    variables.push(colorVar(
      "on-surface-info-variant",
      "color/on-surface/info-variant",
      {
        light: { type: "VARIABLE_ALIAS", id: "p-blue-800" },
        dark: { type: "VARIABLE_ALIAS", id: "p-blue-100" },
      }
    ));
  }
  return {
    fileKey,
    fileName,
    collections: [
      {
        id: "primitives",
        name: "Primitives",
        variableIds: ["p-blue-800", "p-blue-100"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "semantics",
        name: "Color / Semantics",
        variableIds: variables
          .filter((v) => v.variableCollectionId === "semantics")
          .map((v) => v.id),
        modes: [
          { modeId: "light", name: "Light" },
          { modeId: "dark", name: "Dark" },
        ],
      },
    ],
    variables,
  };
}

function cleanup(done) {
  receiver.close(() => {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
    delete process.env.FIGLETS_RECEIVER_URL;
    toClear.forEach((modulePath) => {
      try { delete require.cache[require.resolve(modulePath)]; } catch (_) {}
    });
    done();
  });
}

function simulatePluginApply(baseUrl) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + "/poll?sessionId=apply-sync-inspect&capabilities=setup-repairs,extract-all", (pollRes) => {
      let body = "";
      pollRes.on("data", (chunk) => { body += chunk; });
      pollRes.on("end", () => {
        let command;
        try { command = JSON.parse(body); } catch (err) { reject(err); return; }
        if (command.command !== "apply-setup-repairs") {
          reject(new Error("Expected apply-setup-repairs, got " + command.command));
          return;
        }
        const payload = JSON.stringify({
          created: [{
            name: "color/on-surface/info-variant",
            source: "color/on-surface/info",
            collection: "Color / Semantics",
          }],
          skipped: [],
          unresolved: [],
          message: "1 created, 0 skipped, 0 unresolved.",
        });
        const req = http.request(baseUrl + "/sync-setup-repairs?fileKey=" + fileKey, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        }, (res) => {
          let response = "";
          res.on("data", (chunk) => { response += chunk; });
          res.on("end", () => resolve(JSON.parse(response)));
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
      });
    }).on("error", reject);
  });
}

function simulatePluginSync(baseUrl, snapshot) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + "/poll?sessionId=apply-sync-inspect&capabilities=setup-repairs,extract-all", (pollRes) => {
      let body = "";
      pollRes.on("data", (chunk) => { body += chunk; });
      pollRes.on("end", () => {
        let command;
        try { command = JSON.parse(body); } catch (err) { reject(err); return; }
        if (command.command !== "extract-all") {
          reject(new Error("Expected extract-all, got " + command.command));
          return;
        }
        const payload = JSON.stringify(snapshot);
        const req = http.request(baseUrl + "/sync?fileKey=" + encodeURIComponent(fileKey), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        }, (res) => {
          let response = "";
          res.on("data", (chunk) => { response += chunk; });
          res.on("end", () => resolve({ statusCode: res.statusCode, body: JSON.parse(response) }));
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
      });
    }).on("error", reject);
  });
}

module.exports = new Promise((resolve, reject) => {
  fs.mkdirSync(fileDir, { recursive: true });
  fs.writeFileSync(path.join(fileDir, "figma-data.json"), JSON.stringify(buildSnapshot(false), null, 2), "utf8");
  fs.writeFileSync(path.join(TEMP_DIR, "figma-data.json"), JSON.stringify({
    fileName,
    fileKey: "",
    variables: [{ id: "stale-only", name: "color/stale/only", resolvedType: "COLOR", valuesByMode: {} }],
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(TEMP_DIR, "active-file.json"), JSON.stringify({ fileKey: null }), "utf8");
  fs.writeFileSync(configPath, "const DS = { color: { semantics: { pairs: [] } } };\n", "utf8");

  receiver.listen(0, () => {
    const port = receiver.address().port;
    const baseUrl = "http://127.0.0.1:" + port;
    process.env.FIGLETS_RECEIVER_URL = baseUrl;

    try {
      const beforeSource = loadActiveFigmaDataSource({});
      assert.strictEqual(beforeSource.meta.fileKey, fileKey);
      assert.ok(beforeSource.meta.path.includes(fileKey));
      assert.strictEqual(beforeSource.figmaData.variables.length, 4);

      const beforeInspect = handleInspectDsSetupGaps({});
      assert.strictEqual(beforeInspect.summary.semanticGapCount, 1);
    } catch (err) {
      cleanup(() => reject(err));
      return;
    }

    const pluginApplyPromise = simulatePluginApply(baseUrl);
    Promise.all([
      pluginApplyPromise,
      new Promise((r) => setTimeout(r, 50)).then(() => handleApplyDsSetupRepairs({
        repairs: [handleInspectDsSetupGaps({}).semanticGaps[0]],
      })),
    ])
      .then(() => {
        const pluginSyncPromise = simulatePluginSync(baseUrl, buildSnapshot(true));
        const syncRequestPromise = new Promise((r) => setTimeout(r, 50)).then(() => handleSyncFigmaData());
        return Promise.all([pluginSyncPromise, syncRequestPromise]);
      })
      .then(([pluginSyncAck, syncResult]) => {
        assert.strictEqual(pluginSyncAck.statusCode, 200);
        const syncPayload = JSON.parse(syncResult.content[0].text);
        assert.strictEqual(syncPayload.activeFile.fileKey, fileKey);

        const activeOnDisk = JSON.parse(fs.readFileSync(path.join(TEMP_DIR, "active-file.json"), "utf8"));
        assert.strictEqual(activeOnDisk.fileKey, fileKey);

        const afterSource = loadActiveFigmaDataSource({});
        assert.strictEqual(afterSource.figmaData.variables.length, 5);
        assert.strictEqual(afterSource.meta.path, path.join(fileDir, "figma-data.json"));

        const afterInspect = handleInspectDsSetupGaps({});
        assert.strictEqual(afterInspect.summary.semanticGapCount, 0);
        cleanup(resolve);
      })
      .catch((err) => cleanup(() => reject(err)));
  });
});
