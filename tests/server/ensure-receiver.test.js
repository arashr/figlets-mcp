const assert = require("assert");
const http = require("http");
const { checkPort, waitForPort, ensureReceiverRunning, RECEIVER_PORT, RECEIVER_PATH } = require("../../packages/figlets-mcp-server/src/utils/ensure-receiver.js");
const fs = require("fs");

module.exports = (async () => {
  // Test 1: RECEIVER_PATH points to a file that actually exists
  assert.ok(fs.existsSync(RECEIVER_PATH), `receiver.js not found at ${RECEIVER_PATH}`);
  assert.strictEqual(RECEIVER_PORT, 17337, "Figlets should default to its project-specific bridge port");

  // Test 2: checkPort returns true for a port that is open
  {
    const server = http.createServer((_, res) => { res.end("ok"); });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const result = await checkPort(port);
    assert.strictEqual(result, true, "checkPort should return true for an open port");
    await new Promise(r => server.close(r));
  }

  // Test 3: checkPort returns false for a port nothing is listening on
  {
    const result = await checkPort(19998);
    assert.strictEqual(result, false, "checkPort should return false for a closed port");
  }

  // Test 4: waitForPort resolves quickly when port is already open
  {
    const server = http.createServer((_, res) => { res.end("ok"); });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    await waitForPort(port, 1000); // should resolve immediately
    await new Promise(r => server.close(r));
  }

  // Test 5: waitForPort rejects when port never opens within timeout
  {
    await assert.rejects(
      () => waitForPort(19997, 300),
      (err) => {
        assert.ok(err.message.includes("did not start"), `unexpected error: ${err.message}`);
        return true;
      }
    );
  }

  // Test 6: ensureReceiverRunning is a no-op when the configured receiver is already running.
  {
    const receiverUp = await checkPort(RECEIVER_PORT);
    if (receiverUp) {
      // Should complete without spawning anything
      await ensureReceiverRunning();
      // If we reach here without error, the already-running path works
      assert.ok(true, "ensureReceiverRunning should handle already-running receiver");
    }
  }
})();
