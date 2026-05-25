const assert = require("assert");
const http = require("http");
const net = require("net");
const { execFileSync } = require("child_process");

function freshSyncFigmaData() {
  [
    "../../packages/figlets-mcp-server/src/utils/receiver-url.js",
    "../../packages/figlets-mcp-server/src/utils/ensure-receiver.js",
    "../../packages/figlets-mcp-server/src/bridges/bridge-request.js",
    "../../packages/figlets-mcp-server/src/tools/sync-figma-data.js",
  ].forEach((modulePath) => {
    try { delete require.cache[require.resolve(modulePath)]; } catch (_) {}
  });
  return require("../../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
}

function startMockReceiver(statusCode, responseBody) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(responseBody);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function stopListenerOnPort(port) {
  try {
    const pids = execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) {
      try { process.kill(Number(pid), "SIGTERM"); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = (async () => {
  const { syncFigmaDataTool } = freshSyncFigmaData();

  // Test 1: tool metadata is correct
  assert.strictEqual(syncFigmaDataTool.name, "sync_figma_data");
  assert.ok(syncFigmaDataTool.description.length > 0, "description should not be empty");

  // Test 2: handler resolves with success content on 200
  {
    const server = await startMockReceiver(200, JSON.stringify({
      ok: true,
      fileKey: "local_active_file",
      previousFileKey: "local_previous_file",
      dataPath: "/tmp/local_active_file/figma-data.json",
      sessionId: "test-session"
    }));
    const port = server.address().port;
    process.env.FIGLETS_RECEIVER_URL = `http://127.0.0.1:${port}`;
    try {
      const { handleSyncFigmaData } = freshSyncFigmaData();
      const result = await handleSyncFigmaData();
      assert.ok(Array.isArray(result.content), "result should have content array");
      assert.ok(result.content[0].text.includes("Sync complete"), "success message should mention sync complete");
      const payload = JSON.parse(result.content[0].text);
      assert.strictEqual(payload.activeFile.fileKey, "local_active_file");
      assert.strictEqual(payload.activeFile.snapshotPath, "/tmp/local_active_file/figma-data.json");
      assert.strictEqual(payload.sessionId, "test-session");
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // Test 3: handler rejects on non-200 status
  {
    const server = await startMockReceiver(503, "plugin not connected");
    const port = server.address().port;
    process.env.FIGLETS_RECEIVER_URL = `http://127.0.0.1:${port}`;
    try {
      const { handleSyncFigmaData } = freshSyncFigmaData();
      await assert.rejects(
        handleSyncFigmaData,
        (err) => {
          assert.ok(err.message.includes("Figma plugin is not connected"), `error should mention plugin connection, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // Test 4: handler rejects with a clear message when receiver is not running
  {
    process.env.FIGLETS_RECEIVER_URL = "http://127.0.0.1:19999";
    try {
      const { handleSyncFigmaData } = freshSyncFigmaData();
      await assert.rejects(
        handleSyncFigmaData,
        (err) => {
          assert.ok(err.message.includes("configured receiver URL"), `error should mention configured receiver URL, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // Test 5: default receiver ECONNREFUSED self-heals by starting the receiver, then reports plugin offline precisely.
  {
    const port = await getFreePort();
    process.env.FIGLETS_RECEIVER_PORT = String(port);
    delete process.env.FIGLETS_RECEIVER_URL;
    try {
      const { handleSyncFigmaData } = freshSyncFigmaData();
      await assert.rejects(
        handleSyncFigmaData,
        (err) => {
          assert.ok(!err.message.includes("Failed to contact"), `sync should not use stale generic contact error: ${err.message}`);
          assert.ok(err.message.includes("Figma plugin is not connected"), `error should distinguish plugin offline: ${err.message}`);
          return true;
        }
      );
      const health = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/health`, (res) => {
          let body = "";
          res.on("data", chunk => { body += chunk; });
          res.on("end", () => resolve(JSON.parse(body)));
        }).on("error", reject);
      });
      assert.strictEqual(health.ok, true);
      assert.strictEqual(health.receiver, "running");
    } finally {
      stopListenerOnPort(port);
      delete process.env.FIGLETS_RECEIVER_PORT;
      delete process.env.FIGLETS_RECEIVER_URL;
      freshSyncFigmaData();
    }
  }
})();
