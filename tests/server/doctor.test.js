const assert = require("assert");
const http = require("http");
const { getDoctorReport, formatDoctorReport } = require("../../packages/figlets-mcp-server/src/cli/doctor.js");

function startHealthServer(payload) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

module.exports = (async () => {
  const oldUrl = process.env.FIGLETS_RECEIVER_URL;

  try {
    const server = await startHealthServer({
      ok: true,
      receiver: "running",
      pluginConnected: true,
      activeSessionId: "figlets-test-session",
      updatePrimitivesLive: true
    });

    try {
      process.env.FIGLETS_RECEIVER_URL = `http://127.0.0.1:${server.address().port}`;

      const report = await getDoctorReport();
      assert.strictEqual(report.receiverRunning, true);
      assert.strictEqual(report.pluginConnected, true);
      assert.strictEqual(report.activeSessionId, "figlets-test-session");

      const formatted = formatDoctorReport(report);
      assert.ok(formatted.includes("Bridge receiver: running"));
      assert.ok(formatted.includes("Figma plugin: connected"));
      assert.ok(formatted.includes("Primitive updates: available"));
      assert.ok(formatted.includes("Ready for live Figma tools."));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    if (oldUrl) process.env.FIGLETS_RECEIVER_URL = oldUrl;
    else delete process.env.FIGLETS_RECEIVER_URL;
  }

  const disconnected = formatDoctorReport({
    receiverUrl: "http://127.0.0.1:17337",
    receiverRunning: true,
    receiverHealth: { ok: true, pluginConnected: false },
    pluginConnected: false,
    activeSessionId: null,
    snapshot: { exists: false },
    selection: { exists: false }
  });
  assert.ok(disconnected.includes("open the Figlets Bridge plugin"));

  const stalePlugin = formatDoctorReport({
    receiverUrl: "http://127.0.0.1:17337",
    receiverRunning: true,
    receiverHealth: { ok: true, pluginConnected: true, updatePrimitivesLive: false },
    pluginConnected: true,
    activeSessionId: "figlets-stale",
    snapshot: { exists: false },
    selection: { exists: false }
  });
  assert.ok(stalePlugin.includes("Primitive updates: unavailable in this plugin session"));
  assert.ok(stalePlugin.includes("for local development"));
})();
