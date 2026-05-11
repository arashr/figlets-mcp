/**
 * E2E-ish: inspect setup gaps -> approved repair apply -> config update.
 *
 * Runs the real receiver, simulates the Figma plugin long-poll/apply response,
 * calls real MCP handlers, and verifies that config changes happen only after
 * the approved repair succeeds.
 */

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-e2e-repair-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figma-bridge-plugin/src/receiver.js",
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/bridges/figma-data-source.js",
  "../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js",
  "../../packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });

const receiver = require("../../packages/figma-bridge-plugin/src/receiver.js");
const { handleInspectDsSetupGaps } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");
const { handleApplyDsSetupRepairs } = require("../../packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js");

const fileKey = "local_repair_flow";
const fileDir = path.join(TEMP_DIR, fileKey);
const configPath = path.join(fileDir, "design-system.config.js");
const snapshotPath = path.join(fileDir, "figma-data.json");

function colorVar(id, name, valuesByMode, variableCollectionId = "semantics") {
  return { id, name, resolvedType: "COLOR", variableCollectionId, valuesByMode };
}

const figmaData = {
  fileKey,
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
      variableIds: ["surface-info-variant", "on-surface-info"],
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
    },
  ],
  variables: [
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
  ],
};

function cleanup(done) {
  receiver.close(() => {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
    delete process.env.FIGLETS_RECEIVER_URL;
    toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });
    done();
  });
}

function simulatePluginApply(baseUrl) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + "/poll?sessionId=repair-flow&capabilities=setup-repairs", (pollRes) => {
      let body = "";
      pollRes.on("data", chunk => { body += chunk; });
      pollRes.on("end", () => {
        let command;
        try { command = JSON.parse(body); } catch (err) { reject(err); return; }
        try {
          assert.strictEqual(command.command, "apply-setup-repairs");
          // The MCP server now precomputes per-mode primitive aliases against
          // the BG variant using validateSemanticPairs. Source FG values that
          // already pass the contrast threshold are kept as-is; failing ones
          // are upgraded to the nearest accessible step on the same ramp.
          assert.deepStrictEqual(command.data.repairs, [{
            bg: "color/surface/info-variant",
            name: "color/on-surface/info-variant",
            source: "color/on-surface/info",
            aliases: { Light: "color/blue/800", Dark: "color/blue/100" },
          }]);
        } catch (err) {
          reject(err);
          return;
        }

        const payload = JSON.stringify({
          created: [{
            name: "color/on-surface/info-variant",
            source: "color/on-surface/info",
            collection: "Color / Semantics"
          }],
          skipped: [],
          unresolved: [],
          message: "1 created, 0 skipped, 0 unresolved."
        });
        const req = http.request(baseUrl + "/sync-setup-repairs?fileKey=" + fileKey, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        }, (res) => {
          let response = "";
          res.on("data", chunk => { response += chunk; });
          res.on("end", () => resolve(JSON.parse(response)));
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
  fs.writeFileSync(path.join(TEMP_DIR, "active-file.json"), JSON.stringify({ fileKey }), "utf8");
  fs.writeFileSync(snapshotPath, JSON.stringify(figmaData, null, 2), "utf8");
  fs.writeFileSync(configPath, `const DS = {
    color: { semantics: { pairs: [] } }
  };\n`, "utf8");

  receiver.listen(0, () => {
    const port = receiver.address().port;
    const baseUrl = "http://localhost:" + port;
    process.env.FIGLETS_RECEIVER_URL = baseUrl;

    try {
      const inspect = handleInspectDsSetupGaps({});
      assert.strictEqual(inspect.summary.semanticGapCount, 1);
      assert.strictEqual(inspect.semanticGaps[0].recommended, "color/on-surface/info-variant");
      assert.ok(
        !fs.readFileSync(configPath, "utf8").includes("color/on-surface/info-variant"),
        "inspection must not update config"
      );
    } catch (err) {
      cleanup(() => reject(err));
      return;
    }

    const pluginPromise = simulatePluginApply(baseUrl);
    Promise.all([
      pluginPromise,
      new Promise(resolveDelay => setTimeout(resolveDelay, 50)).then(() => handleApplyDsSetupRepairs({
        repairs: [handleInspectDsSetupGaps({}).semanticGaps[0]],
      }))
    ])
      .then(([pluginAck, applyResult]) => {
        assert.strictEqual(pluginAck.success, true);
        assert.strictEqual(applyResult.created.length, 1);
        assert.deepStrictEqual(applyResult.configUpdate, { updated: true, added: 1, conflicts: [] });
        const config = fs.readFileSync(configPath, "utf8");
        assert.ok(config.includes("color/surface/info-variant"));
        assert.ok(config.includes("color/on-surface/info-variant"));
        cleanup(resolve);
      })
      .catch(err => cleanup(() => reject(err)));
  });
});
