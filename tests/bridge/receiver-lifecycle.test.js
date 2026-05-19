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
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(TEMP_DIR, "active-file.json"), "utf8")).fileKey,
      null
    );

    const syncResult = await syncPromise;
    assert.strictEqual(syncResult.statusCode, 200);
    assert.strictEqual(JSON.parse(syncResult.body).success, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
  }
})();
