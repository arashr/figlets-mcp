const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function freshSyncFigmaData() {
  [
    "../../packages/figlets-mcp-server/src/utils/receiver-url.js",
    "../../packages/figlets-mcp-server/src/utils/ensure-receiver.js",
    "../../packages/figlets-mcp-server/src/utils/ensure-ds-config.js",
    "../../packages/figlets-mcp-server/src/bridges/figma-data-source.js",
    "../../packages/figlets-mcp-server/src/bridges/bridge-request.js",
    "../../packages/figlets-mcp-server/src/tools/refresh-ds-config-from-figma.js",
    "../../packages/figlets-mcp-server/src/tools/sync-figma-data.js",
  ].forEach((modulePath) => {
    try { delete require.cache[require.resolve(modulePath)]; } catch (_) {}
  });
  return require("../../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
}

function writeConfig(configPath, extraRampRows) {
  const rows = [[500, 0, 0, 0]].concat(extraRampRows || []);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "const DS = " + JSON.stringify({
    color: {
      brand: [{ name: "primary", hex: "#000000", role: "primary", step: 500 }],
      ramps: [{ folder: "color/primary", steps: rows }],
      semantics: { pairs: [] },
    },
  }, null, 2) + ";\n", "utf8");
}

function writeSnapshot(snapshotPath) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify({
    fileKey: "local_refresh_file",
    collections: [
      {
        id: "primitives",
        name: "Primitives",
        variableIds: ["primary-500"],
        modes: [{ modeId: "default", name: "Default" }],
      },
    ],
    variables: [
      {
        id: "primary-500",
        name: "color/primary/500",
        resolvedType: "COLOR",
        variableCollectionId: "primitives",
        valuesByMode: { default: { r: 0.5, g: 0.2, b: 0.8 } },
      },
    ],
  }), "utf8");
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
    const syncLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-sync-tool-"));
    const previousLocalDir = process.env.FIGLETS_LOCAL_DIR;
    process.env.FIGLETS_LOCAL_DIR = syncLocalDir;
    delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
    freshSyncFigmaData();

    const server = await startMockReceiver(200, JSON.stringify({
      ok: true,
      fileKey: "local_active_file",
      previousFileKey: "local_previous_file",
      dataPath: path.join(syncLocalDir, "local_active_file", "figma-data.json"),
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
      assert.strictEqual(
        payload.activeFile.snapshotPath,
        path.join(syncLocalDir, "local_active_file", "figma-data.json")
      );
      assert.strictEqual(payload.sessionId, "test-session");
      const activeOnDisk = JSON.parse(fs.readFileSync(path.join(syncLocalDir, "active-file.json"), "utf8"));
      assert.strictEqual(activeOnDisk.fileKey, "local_active_file");
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
      if (previousLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
      else process.env.FIGLETS_LOCAL_DIR = previousLocalDir;
      fs.rmSync(syncLocalDir, { recursive: true, force: true });
      freshSyncFigmaData();
    }
  }

  // Test 2b: compatible existing config refreshes silently during sync
  {
    const syncLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-sync-refresh-ok-"));
    const previousLocalDir = process.env.FIGLETS_LOCAL_DIR;
    const fileKey = "local_refresh_file";
    const fileDir = path.join(syncLocalDir, fileKey);
    const configPath = path.join(fileDir, "design-system.config.js");
    const snapshotPath = path.join(fileDir, "figma-data.json");
    process.env.FIGLETS_LOCAL_DIR = syncLocalDir;
    delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
    freshSyncFigmaData();
    writeConfig(configPath);
    writeSnapshot(snapshotPath);

    const server = await startMockReceiver(200, JSON.stringify({
      ok: true,
      fileKey,
      dataPath: snapshotPath,
      sessionId: "refresh-ok"
    }));
    const port = server.address().port;
    process.env.FIGLETS_RECEIVER_URL = `http://127.0.0.1:${port}`;
    try {
      const { handleSyncFigmaData } = freshSyncFigmaData();
      const result = await handleSyncFigmaData();
      const payload = JSON.parse(result.content[0].text);
      assert.strictEqual(payload.activeFile.fileKey, fileKey);
      assert.strictEqual(payload.activeFile.configRefresh.attempted, true);
      assert.strictEqual(payload.activeFile.configRefresh.compatible, true);
      assert.strictEqual(payload.activeFile.configRefresh.applied, true);
      assert.ok(payload.activeFile.configRefresh.changedCount >= 1, "sync should report compatible config changes");
      const updated = fs.readFileSync(configPath, "utf8");
      assert.ok(updated.includes("#8033CC"), "compatible sync refresh should update brand hex");
      assert.ok(updated.includes("0.5"), "compatible sync refresh should update ramp row");
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
      if (previousLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
      else process.env.FIGLETS_LOCAL_DIR = previousLocalDir;
      fs.rmSync(syncLocalDir, { recursive: true, force: true });
      freshSyncFigmaData();
    }
  }

  // Test 2c: incompatible/skipped refresh is reported but does not fail sync or write config
  {
    const syncLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-sync-refresh-skip-"));
    const previousLocalDir = process.env.FIGLETS_LOCAL_DIR;
    const fileKey = "local_refresh_file";
    const fileDir = path.join(syncLocalDir, fileKey);
    const configPath = path.join(fileDir, "design-system.config.js");
    const snapshotPath = path.join(fileDir, "figma-data.json");
    process.env.FIGLETS_LOCAL_DIR = syncLocalDir;
    delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
    freshSyncFigmaData();
    writeConfig(configPath, [[900, 0, 0, 0]]);
    writeSnapshot(snapshotPath);

    const before = fs.readFileSync(configPath, "utf8");
    const server = await startMockReceiver(200, JSON.stringify({
      ok: true,
      fileKey,
      dataPath: snapshotPath,
      sessionId: "refresh-skip"
    }));
    const port = server.address().port;
    process.env.FIGLETS_RECEIVER_URL = `http://127.0.0.1:${port}`;
    try {
      const { handleSyncFigmaData } = freshSyncFigmaData();
      const result = await handleSyncFigmaData();
      const payload = JSON.parse(result.content[0].text);
      assert.strictEqual(payload.activeFile.fileKey, fileKey);
      assert.strictEqual(payload.activeFile.configRefresh.attempted, true);
      assert.strictEqual(payload.activeFile.configRefresh.compatible, false);
      assert.strictEqual(payload.activeFile.configRefresh.applied, false);
      assert.ok(payload.activeFile.configRefresh.skippedCount >= 1, "sync should report skipped config rows");
      assert.ok(payload.activeFile.configRefresh.message.includes("skipped configured rows"));
      assert.strictEqual(fs.readFileSync(configPath, "utf8"), before, "incompatible sync refresh should not write config");
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
      if (previousLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
      else process.env.FIGLETS_LOCAL_DIR = previousLocalDir;
      fs.rmSync(syncLocalDir, { recursive: true, force: true });
      freshSyncFigmaData();
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
