const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-receiver-routes-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;
process.env.FIGLETS_RECEIVER_POLL_WAIT_MS = "25";
process.env.FIGLETS_DEV_BRIDGE = "1";

const receiverPath = path.resolve(__dirname, "../../packages/figma-bridge-plugin/src/receiver.js");
delete require.cache[require.resolve(receiverPath)];
const server = require(receiverPath);

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const textBody = body == null ? "" : String(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: urlPath,
      headers: textBody ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(textBody),
      } : {},
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk.toString(); });
      res.on("end", () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) {}
        resolve({ statusCode: res.statusCode, body: data, json: parsed });
      });
    });
    req.on("error", reject);
    if (textBody) req.write(textBody);
    req.end();
  });
}

async function pollForCommand(port, capabilities) {
  const query = capabilities && capabilities.length
    ? "&capabilities=" + encodeURIComponent(capabilities.join(","))
    : "";
  return request(port, "GET", "/poll?sessionId=route-matrix" + query);
}

async function roundTrip(port, route) {
  const pollPromise = pollForCommand(port, route.capabilities || []);
  const payload = route.payload || { marker: route.command };
  const requestPromise = request(port, "POST", route.requestPath, JSON.stringify(payload));
  const pollResult = await pollPromise;
  assert.strictEqual(pollResult.statusCode, 200, route.requestPath);
  assert.deepStrictEqual(
    pollResult.json,
    route.withData === false ? { command: route.command } : { command: route.command, data: payload },
    route.requestPath + " should dispatch the expected plugin command"
  );

  const syncBody = Object.assign({ ok: true, route: route.command }, route.syncResult || {});
  const syncAck = await request(port, "POST", route.syncPath + "?sessionId=route-matrix", JSON.stringify(syncBody));
  assert.strictEqual(syncAck.statusCode, 200, route.syncPath);
  assert.deepStrictEqual(syncAck.json, { success: true }, route.syncPath + " should acknowledge plugin result");

  const requestResult = await requestPromise;
  assert.strictEqual(requestResult.statusCode, 200, route.requestPath);
  assert.strictEqual(requestResult.json.success, true, route.requestPath);
  assert.deepStrictEqual(requestResult.json.result.ok, true, route.requestPath);
  assert.strictEqual(requestResult.json.result.route, route.command, route.requestPath);
  assert.strictEqual(requestResult.json.result.sessionId, "route-matrix", route.requestPath);
}

module.exports = (async () => {
  const routes = [
    { requestPath: "/request-showcase", syncPath: "/sync-showcase", command: "build-showcase" },
    { requestPath: "/request-doc-build", syncPath: "/sync-doc-build", command: "build-doc" },
    { requestPath: "/request-qa-audit", syncPath: "/sync-qa-audit", command: "qa-audit" },
    { requestPath: "/request-ds-setup", syncPath: "/sync-ds-setup", command: "apply-ds-setup" },
    { requestPath: "/request-update-primitives", syncPath: "/sync-update-primitives", command: "update-primitives", capabilities: ["update-primitives"] },
    { requestPath: "/request-update-tokens", syncPath: "/sync-update-tokens", command: "update-tokens", capabilities: ["update-tokens"] },
    { requestPath: "/request-foundation-repairs", syncPath: "/sync-foundation-repairs", command: "apply-foundation-repairs", capabilities: ["foundation-repairs"] },
    { requestPath: "/request-setup-repairs", syncPath: "/sync-setup-repairs", command: "apply-setup-repairs", capabilities: ["setup-repairs"] },
    { requestPath: "/request-semantic-naming-consolidation", syncPath: "/sync-semantic-naming-consolidation", command: "apply-semantic-naming-consolidation", capabilities: ["semantic-naming-consolidation"] },
    { requestPath: "/request-figma-operations", syncPath: "/sync-figma-operations", command: "apply-figma-operations", capabilities: ["figma-operations"] },
    { requestPath: "/request-reset-figlets-file", syncPath: "/sync-reset-figlets-file", command: "reset-figlets-file" },
    { requestPath: "/request-remove-text-styles", syncPath: "/sync-remove-text-styles", command: "remove-text-styles" },
    { requestPath: "/request-trim-collection-modes", syncPath: "/sync-trim-collection-modes", command: "trim-collection-modes" },
    {
      requestPath: "/request-prepare-broken-ds-fixture",
      syncPath: "/sync-prepare-broken-ds-fixture",
      command: "prepare-broken-ds-fixture",
      payload: { confirmation: "RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE", marker: "prepare-broken-ds-fixture" },
    },
  ];

  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    const syncPollPromise = pollForCommand(port, []);
    const syncRequestPromise = request(port, "POST", "/request-sync", "{}");
    const syncPoll = await syncPollPromise;
    assert.deepStrictEqual(syncPoll.json, { command: "extract-all" });
    const syncAck = await request(port, "POST", "/sync", JSON.stringify({ ok: true, fileKey: "route_matrix_file" }));
    assert.strictEqual(syncAck.statusCode, 200);
    assert.strictEqual(syncAck.json.success, true);
    assert.strictEqual(syncAck.json.fileKey, "route_matrix_file");
    const syncResult = await syncRequestPromise;
    assert.strictEqual(syncResult.statusCode, 200);
    assert.strictEqual(syncResult.json.success, true);
    assert.strictEqual(syncResult.json.fileKey, "route_matrix_file");

    const selectionPollPromise = pollForCommand(port, []);
    const selectionRequestPromise = request(port, "POST", "/request-selection", "{}");
    const selectionPoll = await selectionPollPromise;
    assert.deepStrictEqual(selectionPoll.json, { command: "extract-selection" });
    const selectionAck = await request(port, "POST", "/sync-selection", JSON.stringify({ selection: [] }));
    assert.strictEqual(selectionAck.statusCode, 200);
    assert.deepStrictEqual(selectionAck.json, { success: true });
    const selectionResult = await selectionRequestPromise;
    assert.strictEqual(selectionResult.statusCode, 200);
    assert.strictEqual(selectionResult.json.success, true);

    for (const route of routes) {
      await roundTrip(port, route);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
    delete process.env.FIGLETS_RECEIVER_POLL_WAIT_MS;
    delete process.env.FIGLETS_DEV_BRIDGE;
  }
})();
