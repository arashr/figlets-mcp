const assert = require("assert");
const http = require("http");

const { syncFigmaDataTool, handleSyncFigmaData } = require("../../packages/figlets-mcp-server/src/tools/sync-figma-data.js");

function startMockReceiver(statusCode, responseBody) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(responseBody);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

module.exports = (async () => {
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
      await assert.rejects(
        handleSyncFigmaData,
        (err) => {
          assert.ok(err.message.includes("503"), `error should mention 503, got: ${err.message}`);
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
      await assert.rejects(
        handleSyncFigmaData,
        (err) => {
          assert.ok(err.message.includes("Failed to contact"), `error should mention contact failure, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }
})();
