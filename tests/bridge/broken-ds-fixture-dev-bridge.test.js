const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CONFIRMATION_PHRASE } = require("../../packages/figlets-mcp-server/src/dev/broken-ds-fixture.js");

function requestJson(url, options, body) {
  const payload = body == null ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(url, Object.assign({
      method: "GET",
      headers: payload ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      } : {},
    }, options || {}), (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}
        resolve({ statusCode: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = (async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-broken-fixture-bridge-"));
  const receiverPath = path.resolve(__dirname, "../../packages/figma-bridge-plugin/src/receiver.js");
  const originalLocalDir = process.env.FIGLETS_LOCAL_DIR;
  const originalDevBridge = process.env.FIGLETS_DEV_BRIDGE;

  async function withServer(devBridge, run) {
    process.env.FIGLETS_LOCAL_DIR = tempDir;
    if (devBridge) process.env.FIGLETS_DEV_BRIDGE = "1";
    else delete process.env.FIGLETS_DEV_BRIDGE;
    delete require.cache[require.resolve(receiverPath)];
    const server = require(receiverPath);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      await run(port);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      delete require.cache[require.resolve(receiverPath)];
    }
  }

  try {
    await withServer(false, async (port) => {
      const disabled = await requestJson(
        `http://127.0.0.1:${port}/request-prepare-broken-ds-fixture`,
        { method: "POST" },
        { confirmation: CONFIRMATION_PHRASE }
      );
      assert.strictEqual(disabled.statusCode, 404);
      assert.match(disabled.body.error || "", /developer-only/i);

      const disabledSync = await requestJson(
        `http://127.0.0.1:${port}/sync-prepare-broken-ds-fixture`,
        { method: "POST" },
        {}
      );
      assert.strictEqual(disabledSync.statusCode, 404);
    });

    await withServer(true, async (port) => {
      const pollPromise = requestJson(`http://127.0.0.1:${port}/poll?sessionId=test-session&fileKey=local_test`, {}, null);
      const requestPromise = requestJson(
        `http://127.0.0.1:${port}/request-prepare-broken-ds-fixture`,
        { method: "POST" },
        { confirmation: CONFIRMATION_PHRASE, seed: "dev-gated", ds: { ok: true }, gaps: {} }
      );
      const poll = await pollPromise;
      assert.strictEqual(poll.statusCode, 200);
      assert.strictEqual(poll.body.command, "prepare-broken-ds-fixture");
      assert.strictEqual(poll.body.data.seed, "dev-gated");

      const sync = await requestJson(
        `http://127.0.0.1:${port}/sync-prepare-broken-ds-fixture`,
        { method: "POST" },
        { message: "done" }
      );
      assert.strictEqual(sync.statusCode, 200);
      const requested = await requestPromise;
      assert.strictEqual(requested.statusCode, 200);
      assert.strictEqual(requested.body.result.message, "done");
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
    else process.env.FIGLETS_LOCAL_DIR = originalLocalDir;
    if (originalDevBridge === undefined) delete process.env.FIGLETS_DEV_BRIDGE;
    else process.env.FIGLETS_DEV_BRIDGE = originalDevBridge;
  }
})();
