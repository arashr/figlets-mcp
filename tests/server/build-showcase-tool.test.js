const assert = require("assert");
const http = require("http");

// ── Test: build_ds_showcase tool talks to the receiver correctly ──────────────
// Uses a mock receiver — no real Figma plugin needed.

async function runTests() {
  // Test 1: 200 → compact sections response
  await (async () => {
    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-showcase") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          assert.deepStrictEqual(JSON.parse(body), { numericFallback: null });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            result: { sections: ["Colors", "Typography", "Spacing"], layout: "horizontal, 100px gap between Figma sections" }
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
      delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/build-showcase.js")];
      const { handleBuildShowcase } = require("../../packages/figlets-mcp-server/src/tools/build-showcase.js");
      const result = await handleBuildShowcase();
      assert.ok(!result.isError, "should succeed");
      const data = JSON.parse(result.content[0].text);
      assert.deepStrictEqual(data.sections, ["Colors", "Typography", "Spacing"]);
      assert.ok(data.message.includes("3 section(s)"), `expected 3 sections in message, got: ${data.message}`);
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // Test 1b: optional numeric fallback policy is forwarded
  await (async () => {
    const expectedFallback = { radius: "ceil", border: "floor", maxDistance: 8 };
    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-showcase") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          assert.deepStrictEqual(JSON.parse(body), { numericFallback: expectedFallback });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, result: { sections: ["Spacing"] } }));
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
      delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/build-showcase.js")];
      const { handleBuildShowcase } = require("../../packages/figlets-mcp-server/src/tools/build-showcase.js");
      const result = await handleBuildShowcase({ numericFallback: expectedFallback });
      assert.ok(!result.isError, "should succeed");
      const data = JSON.parse(result.content[0].text);
      assert.deepStrictEqual(data.sections, ["Spacing"]);
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // Test 2: 503 → plugin not connected error
  await (async () => {
    const mockServer = http.createServer((req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Figma plugin is not connected or listening." }));
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/build-showcase.js")];
      const { handleBuildShowcase } = require("../../packages/figlets-mcp-server/src/tools/build-showcase.js");
      const result = await handleBuildShowcase();
      assert.ok(result.isError, "should be an error");
      assert.ok(result.content[0].text.includes("plugin is not connected"), "should mention plugin");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // Test 3: ECONNREFUSED → receiver not running
  await (async () => {
    process.env.FIGLETS_RECEIVER_URL = "http://localhost:19999";
    delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/build-showcase.js")];
    const { handleBuildShowcase } = require("../../packages/figlets-mcp-server/src/tools/build-showcase.js");
    try {
      await handleBuildShowcase();
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err.message.includes("receiver is not running") || err.message.includes("ECONNREFUSED"), `unexpected error: ${err.message}`);
    }
  })();

  delete process.env.FIGLETS_RECEIVER_URL;
  console.log("build-showcase-tool tests passed");
}

runTests().catch(err => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
