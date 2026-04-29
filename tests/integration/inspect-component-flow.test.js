/**
 * E2E: inspect_component
 *
 * Runs the real receiver, simulates the Figma plugin (poll → respond → post selection),
 * calls the real handleInspectComponent, and verifies the full chain.
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-e2e-inspect-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figma-bridge-plugin/src/receiver.js",
  "../../packages/figlets-mcp-server/src/tools/inspect-component.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });

const receiver = require("../../packages/figma-bridge-plugin/src/receiver.js");
const { handleInspectComponent } = require("../../packages/figlets-mcp-server/src/tools/inspect-component.js");

const FIXTURE_SELECTION = {
  selection: [
    {
      id: "1:1",
      type: "COMPONENT",
      name: "Button/Primary",
      description: "Primary action button",
      layoutMode: "HORIZONTAL",
      padding: { top: 12, right: 16, bottom: 12, left: 16 },
      itemSpacing: 8,
      componentPropertyDefinitions: {
        label: { type: "TEXT", defaultValue: "Label" },
        disabled: { type: "BOOLEAN", defaultValue: false }
      },
      children: [
        { id: "1:2", type: "TEXT", name: "Label" }
      ]
    }
  ]
};

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
 * Simulate the Figma plugin for selection:
 *   1. GET /poll → expects "extract-selection" command
 *   2. POST /sync-selection with fixture data
 */
function simulatePluginSelection(baseUrl, selectionFixture) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + "/poll", (pollRes) => {
      let body = "";
      pollRes.on("data", chunk => { body += chunk; });
      pollRes.on("end", () => {
        let cmd;
        try { cmd = JSON.parse(body); } catch (e) { return reject(new Error("Unparseable poll response: " + body)); }
        if (cmd.command !== "extract-selection") {
          return reject(new Error("Plugin expected extract-selection, got: " + cmd.command));
        }

        const selectionPath = path.join(TEMP_DIR, "figma-selection.json");
        fs.writeFileSync(selectionPath, JSON.stringify(selectionFixture));

        const payload = JSON.stringify(selectionFixture);
        const postReq = http.request(baseUrl + "/sync-selection", {
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
    const simPromise = simulatePluginSelection(baseUrl, FIXTURE_SELECTION);
    Promise.all([
      simPromise,
      new Promise((r) => setTimeout(r, 50)).then(() => handleInspectComponent())
    ])
      .then(([pluginAck, toolResult]) => {
        // --- plugin ack ---
        assert.strictEqual(pluginAck.success, true, "plugin /sync-selection ack should be success");

        // --- inspect_component assertions ---
        assert.ok(Array.isArray(toolResult.content), "tool result should have content array");
        const parsed = JSON.parse(toolResult.content[0].text);

        assert.strictEqual(parsed.selectedNodesCount, 1, "should report 1 selected node");
        assert.strictEqual(parsed.selection[0].name, "Button/Primary", "should return correct node name");
        assert.strictEqual(parsed.selection[0].type, "COMPONENT", "should preserve node type");
        assert.strictEqual(parsed.selection[0].description, "Primary action button", "should include description");
        assert.ok(parsed.selection[0].autoLayout, "should include autoLayout");
        assert.strictEqual(parsed.selection[0].autoLayout.mode, "HORIZONTAL", "should report correct layout mode");
        assert.ok(parsed.selection[0].componentPropertyDefinitions, "should include property definitions");
        assert.ok(Array.isArray(parsed.selection[0].children), "should include children");

        cleanup(receiver, resolve);
      })
      .catch(err => cleanup(receiver, () => reject(err)));
  });
});
