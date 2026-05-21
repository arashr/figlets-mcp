/**
 * E2E: qa_binding_audit
 *
 * Runs the real receiver, simulates the Figma plugin poll -> qa-audit -> sync-qa-audit
 * round-trip, calls the real handleQaBindingAudit, and verifies the payload routing.
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-e2e-qa-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figma-bridge-plugin/src/receiver.js",
  "../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });

const receiver = require("../../packages/figma-bridge-plugin/src/receiver.js");
const { handleQaBindingAudit } = require("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js");

const FAKE_QA_RESULT = {
  scope: "selection",
  fileName: "Portfolio DS",
  pageName: "Components",
  selectedCount: 1,
  checkedRootCount: 1,
  violationCount: 1,
  byType: { color: 1 },
  fixApplied: true,
  fixedCount: 1,
  failedCount: 0,
  fixed: [{ nodeId: "1:2", property: "Fill color", boundTo: "color/surface/default" }],
  failed: [],
  byFixability: { fixableNow: 1, needsExistingToken: 0, needsDesignerDecision: 0, unsupported: 0 },
  repairPlan: {
    tool: "qa_binding_audit",
    approvalRequired: true,
    applyInput: { fix: true },
    counts: { fixableNow: 1, needsExistingToken: 0, needsDesignerDecision: 0, unsupported: 0 }
  },
  violations: [
    {
      nodeId: "1:2",
      nodeName: "Button",
      nodeType: "FRAME",
      property: "Fill color",
      rawValue: "rgb(255,255,255)",
      type: "color",
      fixability: "fixableNow",
      suggestion: { kind: "variable", name: "color/surface/default", confidence: "high", id: "var-color-1" }
    }
  ]
};

function cleanup(server, done) {
  server.close();
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  delete process.env.FIGLETS_RECEIVER_URL;
  toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });
  setImmediate(done);
}

function simulatePluginQa(baseUrl, capturedRef) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + "/poll", (pollRes) => {
      let body = "";
      pollRes.on("data", chunk => { body += chunk; });
      pollRes.on("end", () => {
        let cmd;
        try { cmd = JSON.parse(body); } catch (e) { return reject(new Error("Unparseable poll response: " + body)); }
        if (cmd.command !== "qa-audit") return reject(new Error("Plugin expected qa-audit, got: " + cmd.command));
        capturedRef.command = cmd;

        const payload = JSON.stringify(FAKE_QA_RESULT);
        const postReq = http.request(baseUrl + "/sync-qa-audit", {
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

    const simPromise = simulatePluginQa(baseUrl, captured);
    Promise.all([
      simPromise,
      new Promise((r) => setTimeout(r, 50)).then(() => handleQaBindingAudit({ fix: true }))
    ])
      .then(([pluginAck, toolResult]) => {
        assert.strictEqual(pluginAck.success, true, "/sync-qa-audit ack should succeed");
        assert.ok(captured.command, "plugin should have received a qa-audit command");
        assert.strictEqual(captured.command.command, "qa-audit");
        assert.deepStrictEqual(captured.command.data, { fix: true });

        assert.ok(!toolResult.isError, "tool should not be in error state");
        const parsed = JSON.parse(toolResult.content[0].text);
        assert.strictEqual(parsed.scope, "selection");
        assert.strictEqual(parsed.violationCount, 1);
        assert.strictEqual(parsed.failedCount, 0);
        assert.strictEqual(parsed.fixedCount, 1);
        assert.strictEqual(parsed.violations[0].fixability, "fixableNow");
        assert.strictEqual(parsed.repairPlan.counts.fixableNow, 1);
        assert.strictEqual(parsed.violations[0].suggestion.name, "color/surface/default");

        cleanup(receiver, resolve);
      })
      .catch(err => cleanup(receiver, () => reject(err)));
  });
});
