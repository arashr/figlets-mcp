const assert = require("assert");
const http = require("http");

const { syncFigmaDataTool, handleSyncFigmaData } = require("../../packages/figlets-mcp-server/src/tools/sync-figma-data.js");

function startMockReceiver(statusCode, responseBody) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(responseBody);
    });
    server.listen(0, () => resolve(server));
  });
}

module.exports = (async () => {
  // Test 1: tool metadata is correct
  assert.strictEqual(syncFigmaDataTool.name, "sync_figma_data");
  assert.ok(syncFigmaDataTool.description.length > 0, "description should not be empty");

  // Test 2: handler resolves with success content on 200
  {
    const server = await startMockReceiver(200, JSON.stringify({ ok: true }));
    const port = server.address().port;
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;
    try {
      const result = await handleSyncFigmaData();
      assert.ok(Array.isArray(result.content), "result should have content array");
      assert.ok(result.content[0].text.includes("Sync complete"), "success message should mention sync complete");
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // Test 3: handler rejects on non-200 status
  {
    const server = await startMockReceiver(503, "plugin not connected");
    const port = server.address().port;
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;
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
    process.env.FIGLETS_RECEIVER_URL = "http://localhost:19999";
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
