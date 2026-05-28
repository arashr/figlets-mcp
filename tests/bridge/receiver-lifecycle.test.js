const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-receiver-life-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const receiverPath = "../../packages/figma-bridge-plugin/src/receiver.js";
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
        "Content-Length": Buffer.byteLength(textBody)
      } : {}
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk.toString(); });
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
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

    const pollPromise = request(
      port,
      "GET",
      "/poll?sessionId=figlets-live&capabilities=qa-audit,update-primitives,update-tokens"
    );

    const connectedHealth = await request(port, "GET", "/health");
    const connected = JSON.parse(connectedHealth.body);
    assert.strictEqual(connected.pluginConnected, true);
    assert.strictEqual(connected.activeSessionId, "figlets-live");
    assert.deepStrictEqual(connected.pluginCapabilities, ["qa-audit", "update-primitives", "update-tokens"]);
    assert.strictEqual(connected.updatePrimitivesLive, true);
    assert.strictEqual(connected.updateTokensLive, true);
    assert.strictEqual(connected.setupRepairsLive, false);

    const syncPromise = request(port, "POST", "/request-sync", "{}");
    const pollResult = await pollPromise;
    assert.deepStrictEqual(JSON.parse(pollResult.body), { command: "extract-all" });

    const busyHealth = await request(port, "GET", "/health");
    const busy = JSON.parse(busyHealth.body);
    assert.strictEqual(busy.pluginConnected, false);
    assert.strictEqual(busy.pluginRecentlySeen, true);
    assert.strictEqual(busy.activeSessionId, "figlets-live");
    assert.deepStrictEqual(busy.pluginCapabilities, ["qa-audit", "update-primitives", "update-tokens"]);
    assert.strictEqual(busy.updatePrimitivesLive, true);
    assert.strictEqual(busy.updateTokensLive, true);
    assert.strictEqual(busy.setupRepairsLive, false);

    const busyQa = await request(port, "POST", "/request-qa-audit", "{}");
    const busyQaBody = JSON.parse(busyQa.body);
    assert.strictEqual(busyQa.statusCode, 503);
    assert.strictEqual(busyQaBody.pluginRecentlySeen, true);
    assert.strictEqual(busyQaBody.activeSessionId, "figlets-live");

    const syncAck = await request(port, "POST", "/sync", JSON.stringify({ ok: true }));
    assert.strictEqual(syncAck.statusCode, 200);
    assert.strictEqual(JSON.parse(syncAck.body).success, true);
    assert.strictEqual(fs.existsSync(path.join(TEMP_DIR, "active-file.json")), false);

    const syncResult = await syncPromise;
    assert.strictEqual(syncResult.statusCode, 200);
    assert.strictEqual(JSON.parse(syncResult.body).success, true);

    // If the sync callback omits ?fileKey, the receiver should still resolve
    // scoped paths from payload/last-session context in this same session.
    const scopedPollPromise = request(
      port,
      "GET",
      "/poll?sessionId=figlets-live&capabilities=qa-audit,update-primitives,update-tokens&fileKey=local_session_file"
    );
    const scopedSyncPromise = request(port, "POST", "/request-sync", "{}");
    const scopedPoll = await scopedPollPromise;
    assert.deepStrictEqual(JSON.parse(scopedPoll.body), { command: "extract-all" });
    const scopedSyncAck = await request(
      port,
      "POST",
      "/sync",
      JSON.stringify({ ok: true, fileKey: "local_session_file" })
    );
    assert.strictEqual(scopedSyncAck.statusCode, 200);
    const scopedSyncResult = await scopedSyncPromise;
    assert.strictEqual(scopedSyncResult.statusCode, 200);
    const scopedPayload = JSON.parse(scopedSyncResult.body);
    assert.strictEqual(scopedPayload.success, true);
    assert.strictEqual(scopedPayload.fileKey, "local_session_file");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(TEMP_DIR, "active-file.json"), "utf8")).fileKey,
      "local_session_file"
    );
    assert.strictEqual(
      fs.existsSync(path.join(TEMP_DIR, "local_session_file", "figma-data.json")),
      true
    );

    fs.mkdirSync(path.join(TEMP_DIR, "local_figlets_test"), { recursive: true });
    fs.writeFileSync(
      path.join(TEMP_DIR, "local_figlets_test", "figma-data.json"),
      JSON.stringify({ fileName: "Figlets Test", fileKey: "local_figlets_test", variables: [] })
    );
    const healPollPromise = request(
      port,
      "GET",
      "/poll?sessionId=figlets-live&capabilities=qa-audit,update-primitives,update-tokens"
    );
    const healSyncPromise = request(port, "POST", "/request-sync", "{}");
    await healPollPromise;
    const healSyncAck = await request(
      port,
      "POST",
      "/sync",
      JSON.stringify({ fileName: "Figlets Test", fileKey: "", variables: [{ name: "space/4" }] })
    );
    assert.strictEqual(healSyncAck.statusCode, 200);
    const healSyncResult = await healSyncPromise;
    assert.strictEqual(healSyncResult.statusCode, 200);
    assert.strictEqual(JSON.parse(healSyncResult.body).fileKey, "local_figlets_test");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(TEMP_DIR, "active-file.json"), "utf8")).fileKey,
      "local_figlets_test"
    );
    assert.strictEqual(
      fs.existsSync(path.join(TEMP_DIR, "local_figlets_test", "figma-data.json")),
      true
    );

    const selectionPromise = request(port, "POST", "/request-selection", "{}");
    await new Promise(resolve => setTimeout(resolve, 20));

    const selectionPollPromise = request(
      port,
      "GET",
      "/poll?sessionId=figlets-live&capabilities=qa-audit,update-primitives,update-tokens"
    );
    const selectionPoll = await selectionPollPromise;
    assert.deepStrictEqual(JSON.parse(selectionPoll.body), { command: "extract-selection" });

    const selectionAck = await request(port, "POST", "/sync-selection", JSON.stringify({
      selection: [{ id: "34:2", name: "Raw card target - BNN-37", type: "COMPONENT" }],
      meta: { fileName: "Figlets Test", pageName: "BNN-37 Binding Audit Targets" }
    }));
    assert.strictEqual(selectionAck.statusCode, 200);

    const selectionResult = await selectionPromise;
    assert.strictEqual(selectionResult.statusCode, 200);
    assert.strictEqual(JSON.parse(selectionResult.body).success, true);

    const docPromise = request(port, "POST", "/request-doc-build", JSON.stringify({
      componentId: "34:2",
      componentName: "Raw card target - BNN-37"
    }));
    await new Promise(resolve => setTimeout(resolve, 20));

    const docPollPromise = request(
      port,
      "GET",
      "/poll?sessionId=figlets-live&capabilities=qa-audit,update-primitives,update-tokens"
    );
    const docPoll = await docPollPromise;
    assert.deepStrictEqual(JSON.parse(docPoll.body), {
      command: "build-doc",
      data: {
        componentId: "34:2",
        componentName: "Raw card target - BNN-37"
      }
    });

    const docAck = await request(port, "POST", "/sync-doc-build", JSON.stringify({
      componentName: "Raw card target - BNN-37",
      path: "component-specs/Raw card target - BNN-37.md",
      markdown: "# Raw card target - BNN-37"
    }));
    assert.strictEqual(docAck.statusCode, 200);

    const docResult = await docPromise;
    assert.strictEqual(docResult.statusCode, 200);
    assert.strictEqual(JSON.parse(docResult.body).success, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
  }
})();
