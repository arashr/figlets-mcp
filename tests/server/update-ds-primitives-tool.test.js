const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-update-prim-test-"));
const configPath = path.join(TEMP_DIR, "design-system.config.js");

// Minimal prepared DS — only the fields the tool validates.
const minimalDs = {
  collections: { primitives: "1. Primitives" },
  color: {
    ramps: [
      { folder: "color/lime", steps: [[500, 0.76, 0.97, 0.43]] }
    ]
  },
  primitives: {
    spacing: [[0, 0], [4, 16]]
  }
};
fs.writeFileSync(configPath, `const DS = ${JSON.stringify(minimalDs, null, 2)};\n`, "utf-8");

const toolModule = "../../packages/figlets-mcp-server/src/tools/update-ds-primitives.js";

module.exports = (async () => {
  // Tool metadata
  delete require.cache[require.resolve(toolModule)];
  const { updateDsPrimitivesTool, handleUpdateDsPrimitives } = require(toolModule);
  assert.strictEqual(updateDsPrimitivesTool.name, "update_ds_primitives");
  assert.ok(updateDsPrimitivesTool.description.length > 0);
  assert.ok(updateDsPrimitivesTool.description.includes("semantic aliases"), "tool description should mention semantic alias updates");
  assert.ok(updateDsPrimitivesTool.inputSchema.properties.create_missing, "tool schema should expose create_missing");

  // Missing config_path → clear error
  {
    const result = await handleUpdateDsPrimitives({});
    assert.ok(result.error && /config_path/.test(result.error), "should error on missing config_path");
  }

  // Successful round trip — receiver returns a 200 with a result envelope.
  await (async () => {
    let receivedBody = null;
    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-update-primitives") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          receivedBody = JSON.parse(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            result: {
              collection: "1. Primitives",
              categories: ["color"],
              unknownCategories: [],
              report: { color: { entries: 1, updated: 1, unchanged: 0, unmatched: [], typeMismatch: [] } },
              message: "color: 1 updated, 0 unchanged"
            }
          }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      const result = await handleUpdateDsPrimitives({ config_path: configPath, categories: ["color"], create_missing: true });
      assert.ok(!result.error, "should succeed");
      assert.deepStrictEqual(result.categories, ["color"]);
      assert.strictEqual(result.collection, "1. Primitives");
      assert.strictEqual(result.report.color.updated, 1);

      // Verify what the tool actually sent to the bridge
      assert.ok(receivedBody && receivedBody.DS, "should send DS object");
      assert.deepStrictEqual(receivedBody.categories, ["color"], "should forward categories list");
      assert.strictEqual(receivedBody.createMissing, true, "should forward create_missing as createMissing");
      assert.ok(receivedBody.DS.color && Array.isArray(receivedBody.DS.color.ramps), "DS should include color.ramps");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  })();

  // 503 from bridge → user-facing error mentioning the plugin
  await (async () => {
    const mockServer = http.createServer((req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not connected" }));
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      const result = await handleUpdateDsPrimitives({ config_path: configPath });
      assert.ok(result.error && /plugin/i.test(result.error), "503 should produce a plugin-not-connected message");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  })();

  // 409 from bridge → stale plugin reload guidance without waiting for timeout
  await (async () => {
    const mockServer = http.createServer((req, res) => {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "The open Figlets Bridge plugin is out of date. Close and reopen the plugin in Figma Desktop, then try again.",
        activeSessionId: "figlets-old",
        pluginCapabilities: []
      }));
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      const result = await handleUpdateDsPrimitives({ config_path: configPath });
      assert.ok(result.error && /does not advertise|out of date/i.test(result.error), "409 should explain unavailable command");
      assert.strictEqual(result.activeSessionId, "figlets-old");
      assert.deepStrictEqual(result.pluginCapabilities, []);
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  })();

  // Receiver completely unreachable → ECONNREFUSED becomes a clear error
  {
    process.env.FIGLETS_RECEIVER_URL = "http://localhost:19999";
    try {
      const result = await handleUpdateDsPrimitives({ config_path: configPath });
      assert.ok(result.error && /receiver/i.test(result.error), "should mention receiver when unreachable");
    } finally {
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // Cleanup
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
})();
