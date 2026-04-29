/**
 * E2E: generate_component_doc
 *
 * Runs the real receiver, simulates the plugin's poll → build-doc → sync-doc-build
 * round-trip, calls the real handleGenerateComponentDoc, and verifies the full chain
 * including the payload routed to the plugin.
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-e2e-doc-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figma-bridge-plugin/src/receiver.js",
  "../../packages/figlets-mcp-server/src/tools/generate-component-doc.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });

const receiver = require("../../packages/figma-bridge-plugin/src/receiver.js");
const { handleGenerateComponentDoc } = require("../../packages/figlets-mcp-server/src/tools/generate-component-doc.js");

function cleanup(server, done) {
  server.close(() => {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
    delete process.env.FIGLETS_RECEIVER_URL;
    toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });
    done();
  });
}

const FAKE_DOC_RESULT = {
  componentName: "Button",
  markdown: "# Button\n\n> _[Add purpose]_\n\n## Variants\n\n_(stubbed by integration test)_\n",
  path: "component-specs/Button.md",
  componentMeta: { type: "COMPONENT_SET", variantCount: 5, width: 120, height: 40, propertyCount: 2 },
  bindingsCount: 12,
  anatomyCount: 3,
  specSheet: { page: "Components", frame: "Button · Spec" }
};

/**
 * Simulate the plugin for build-doc:
 *   1. GET /poll → expects { command: 'build-doc', data: { componentName, ... } }
 *   2. POST /sync-doc-build with the simulated plugin output
 */
function simulatePluginDocBuild(baseUrl, capturedRef) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + "/poll", (pollRes) => {
      let body = "";
      pollRes.on("data", chunk => { body += chunk; });
      pollRes.on("end", () => {
        let cmd;
        try { cmd = JSON.parse(body); } catch (e) { return reject(new Error("Unparseable poll response: " + body)); }
        if (cmd.command !== "build-doc") return reject(new Error("Plugin expected build-doc, got: " + cmd.command));
        capturedRef.command = cmd;

        const payload = JSON.stringify(FAKE_DOC_RESULT);
        const postReq = http.request(baseUrl + "/sync-doc-build", {
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
    const captured = {};

    // Start the plugin simulator first so its GET /poll registers as
    // pendingPollResponse before the tool's POST arrives. Without the small
    // delay this is a real race (~30% flake rate observed locally).
    const simPromise = simulatePluginDocBuild(baseUrl, captured);
    Promise.all([
      simPromise,
      new Promise((r) => setTimeout(r, 50)).then(() => handleGenerateComponentDoc({
        component_name: "Button",
        description: "A primary CTA button. Use when there is one most-important action on the screen.",
        usage_do: ["Use for the primary CTA"],
        usage_dont: ["Don't truncate the label"],
        variant_descriptions: { "Type=Primary": "High-emphasis" }
      }))
    ])
      .then(([pluginAck, toolResult]) => {
        // --- plugin received the right payload via the poll ---
        assert.strictEqual(pluginAck.success, true, "/sync-doc-build ack should succeed");
        assert.ok(captured.command, "plugin should have received a build-doc command");
        assert.strictEqual(captured.command.command, "build-doc");
        const data = captured.command.data;
        assert.strictEqual(data.componentName, "Button", "componentName should propagate to plugin");
        assert.ok(data.description && data.description.indexOf("primary CTA") >= 0, "description should propagate to plugin");
        assert.deepStrictEqual(data.usageDo, ["Use for the primary CTA"]);
        assert.deepStrictEqual(data.usageDont, ["Don't truncate the label"]);
        assert.deepStrictEqual(data.variantDescriptions, { "Type=Primary": "High-emphasis" });

        // --- tool returned the markdown + path for the agent to write ---
        assert.ok(!toolResult.isError, "tool should not be in error state");
        const parsed = JSON.parse(toolResult.content[0].text);
        assert.strictEqual(parsed.componentName, "Button");
        assert.strictEqual(parsed.path, "component-specs/Button.md");
        assert.ok(parsed.markdown.startsWith("# Button"));
        assert.strictEqual(parsed.bindingsCount, 12);
        assert.strictEqual(parsed.anatomyCount, 3);
        assert.deepStrictEqual(parsed.specSheet, { page: "Components", frame: "Button · Spec" });

        cleanup(receiver, resolve);
      })
      .catch(err => cleanup(receiver, () => reject(err)));
  });
});
