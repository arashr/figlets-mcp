const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-receiver-special-sync-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;
process.env.FIGLETS_RECEIVER_POLL_WAIT_MS = "25";

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
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (_) {}
        resolve({ statusCode: res.statusCode, body: data, json });
      });
    });
    req.on("error", reject);
    if (textBody) req.write(textBody);
    req.end();
  });
}

module.exports = (async () => {
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    const syncPollPromise = request(port, "GET", "/poll?sessionId=sync-special&fileKey=old_file");
    const syncRequestPromise = request(port, "POST", "/request-sync", "{}");
    const syncPoll = await syncPollPromise;
    assert.strictEqual(syncPoll.statusCode, 200);
    assert.deepStrictEqual(syncPoll.json, { command: "extract-all" });

    const syncBody = JSON.stringify({
      fileKey: "new_file",
      fileName: "New File",
      variables: [{ name: "color/bg/default" }],
    });
    const syncAck = await request(port, "POST", "/sync?sessionId=sync-callback", syncBody);
    assert.strictEqual(syncAck.statusCode, 200);
    assert.strictEqual(syncAck.json.success, true);
    assert.strictEqual(syncAck.json.fileKey, "new_file");
    assert.ok(syncAck.json.dataPath.endsWith(path.join("new_file", "figma-data.json")));

    const syncResult = await syncRequestPromise;
    assert.strictEqual(syncResult.statusCode, 200);
    assert.deepStrictEqual(
      {
        success: syncResult.json.success,
        message: syncResult.json.message,
        sessionId: syncResult.json.sessionId,
        fileKey: syncResult.json.fileKey,
        previousFileKey: syncResult.json.previousFileKey,
        activeFileChanged: syncResult.json.activeFileChanged,
      },
      {
        success: true,
        message: "Sync complete",
        sessionId: "sync-callback",
        fileKey: "new_file",
        previousFileKey: "old_file",
        activeFileChanged: true,
      }
    );
    assert.ok(syncResult.json.dataPath.endsWith(path.join("new_file", "figma-data.json")));
    assert.strictEqual(
      fs.readFileSync(path.join(TEMP_DIR, "new_file", "figma-data.json"), "utf8"),
      syncBody
    );
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(TEMP_DIR, "active-file.json"), "utf8")).fileKey,
      "new_file"
    );

    const selectionRequestPromise = request(port, "POST", "/request-selection", "{}");
    await new Promise(resolve => setTimeout(resolve, 10));
    const secondSelectionRequest = await request(port, "POST", "/request-selection", "{}");
    assert.strictEqual(secondSelectionRequest.statusCode, 409);
    assert.strictEqual(secondSelectionRequest.json.pluginRecentlySeen, true);

    const selectionPoll = await request(port, "GET", "/poll?sessionId=selection-special&fileKey=selection_file");
    assert.strictEqual(selectionPoll.statusCode, 200);
    assert.deepStrictEqual(selectionPoll.json, { command: "extract-selection" });

    const selectionBody = JSON.stringify({
      fileKey: "selection_file",
      selection: [{ id: "1:2", name: "Selected card", type: "COMPONENT" }],
      meta: { fileName: "Selection File" },
    });
    const selectionAck = await request(port, "POST", "/sync-selection?sessionId=selection-callback", selectionBody);
    assert.strictEqual(selectionAck.statusCode, 200);
    assert.deepStrictEqual(selectionAck.json, { success: true });

    const selectionResult = await selectionRequestPromise;
    assert.strictEqual(selectionResult.statusCode, 200);
    assert.strictEqual(selectionResult.json.success, true);
    assert.strictEqual(selectionResult.json.message, "Selection synced");
    assert.strictEqual(selectionResult.json.sessionId, "selection-callback");
    assert.ok(selectionResult.json.path.endsWith(path.join("selection_file", "figma-selection.json")));
    assert.strictEqual(
      fs.readFileSync(path.join(TEMP_DIR, "selection_file", "figma-selection.json"), "utf8"),
      selectionBody
    );
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(TEMP_DIR, "active-file.json"), "utf8")).fileKey,
      "selection_file"
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
    delete process.env.FIGLETS_RECEIVER_POLL_WAIT_MS;
  }
})();
