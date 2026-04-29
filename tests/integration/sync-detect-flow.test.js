/**
 * E2E: sync_figma_data → detect_design_system
 *
 * Runs the real receiver, simulates the Figma plugin (poll → respond → post data),
 * calls the real MCP tool handlers, and verifies the full chain.
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-e2e-sync-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

// Clear any cached modules that embed FIGLETS_LOCAL_DIR at require time
const toClear = [
  "../../packages/figma-bridge-plugin/src/receiver.js",
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/bridges/figma-data-source.js",
  "../../packages/figlets-mcp-server/src/tools/sync-figma-data.js",
  "../../packages/figlets-mcp-server/src/tools/detect-design-system.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });

const receiver = require("../../packages/figma-bridge-plugin/src/receiver.js");
const { handleSyncFigmaData } = require("../../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
const { handleDetectDesignSystem } = require("../../packages/figlets-mcp-server/src/tools/detect-design-system.js");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");

function cleanup(server, done) {
  server.close(() => {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
    delete process.env.FIGLETS_RECEIVER_URL;
    toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });
    done();
  });
}

/**
 * Simulate the Figma plugin:
 *   1. GET /poll  (long-poll — waits for a command)
 *   2. On command "extract-all" → POST /sync with fixture data
 */
function simulatePlugin(baseUrl, fixtureData) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + "/poll", (pollRes) => {
      let body = "";
      pollRes.on("data", chunk => { body += chunk; });
      pollRes.on("end", () => {
        let cmd;
        try { cmd = JSON.parse(body); } catch (e) { return reject(new Error("Plugin got unparseable poll response: " + body)); }
        if (cmd.command !== "extract-all") {
          return reject(new Error("Plugin expected extract-all, got: " + cmd.command));
        }

        // Post the fixture payload back as the plugin would
        const payload = JSON.stringify(fixtureData);
        const postReq = http.request(baseUrl + "/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        }, (syncRes) => {
          let syncBody = "";
          syncRes.on("data", c => { syncBody += c; });
          syncRes.on("end", () => resolve(JSON.parse(syncBody)));
        });
        postReq.on("error", reject);
        postReq.write(payload);
        postReq.end();
      });
    }).on("error", reject);
  });
}

module.exports = new Promise((resolve, reject) => {
  receiver.listen(0, () => {
    const port = receiver.address().port;
    const baseUrl = "http://localhost:" + port;
    process.env.FIGLETS_RECEIVER_URL = baseUrl;

    // Start the plugin simulator first so its GET /poll registers as
    // pendingPollResponse before the tool's POST arrives (race-safe).
    const simPromise = simulatePlugin(baseUrl, exampleFigmaData);
    Promise.all([
      simPromise,
      new Promise((r) => setTimeout(r, 50)).then(() => handleSyncFigmaData())
    ])
      .then(([pluginAck, toolResult]) => {
        // --- sync_figma_data assertions ---
        assert.strictEqual(pluginAck.success, true, "plugin /sync ack should be success");
        assert.ok(Array.isArray(toolResult.content), "tool result should have content array");
        assert.ok(toolResult.content[0].text.includes("Sync complete"), "tool should report sync complete");

        const writtenFile = path.join(TEMP_DIR, "figma-data.json");
        assert.ok(fs.existsSync(writtenFile), "figma-data.json should have been written");
        const written = JSON.parse(fs.readFileSync(writtenFile, "utf-8"));
        assert.strictEqual(written.target, "fixture-file", "written file should contain fixture data");

        // --- detect_design_system assertions ---
        const detectResult = handleDetectDesignSystem({ figmaDataPath: writtenFile });

        assert.strictEqual(typeof detectResult, "object", "detect should return an object");
        assert.strictEqual(detectResult.summary.collections, 2, "should detect 2 collections");
        assert.ok(Array.isArray(detectResult.collections), "should have compact collections array");
        assert.ok(detectResult.collections.some(c => c.name === "Primitives"), "should find Primitives collection");
        assert.ok(detectResult.collections.some(c => c.name === "Semantics"), "should find Semantics collection");
        assert.ok(Array.isArray(detectResult.textStyles), "should have textStyles array");
        assert.ok(!detectResult.snapshot, "compact result should not include raw snapshot");

        cleanup(receiver, resolve);
      })
      .catch(err => cleanup(receiver, () => reject(err)));
  });
});
