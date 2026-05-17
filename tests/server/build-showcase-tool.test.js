const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Test: build_ds_showcase tool talks to the receiver correctly ──────────────
// Uses a mock receiver — no real Figma plugin needed.

async function runTests() {
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-showcase-tool-"));
  process.env.FIGLETS_LOCAL_DIR = localDir;

  function freshBuildShowcase() {
    for (const mod of [
      "../../packages/figlets-mcp-server/src/tools/build-showcase.js",
      "../../packages/figlets-mcp-server/src/utils/ensure-ds-config.js",
      "../../packages/figlets-mcp-server/src/utils/paths.js",
      "../../packages/figlets-mcp-server/src/bridges/figma-data-source.js",
    ]) {
      try { delete require.cache[require.resolve(mod)]; } catch (_) {}
    }
    return require("../../packages/figlets-mcp-server/src/tools/build-showcase.js");
  }

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
      const { handleBuildShowcase } = freshBuildShowcase();
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
      const { handleBuildShowcase } = freshBuildShowcase();
      const result = await handleBuildShowcase({ numericFallback: expectedFallback });
      assert.ok(!result.isError, "should succeed");
      const data = JSON.parse(result.content[0].text);
      assert.deepStrictEqual(data.sections, ["Spacing"]);
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // Test 1c: active file config forwards semantic pair relationships, not just collection names.
  await (async () => {
    const fileKey = "file_semantics";
    const scopedDir = path.join(localDir, fileKey);
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, "active-file.json"), JSON.stringify({ fileKey, updatedAt: "now" }));
    fs.writeFileSync(path.join(scopedDir, "design-system.config.js"), [
      "const DS = {",
      "  collections: { primitives: '1. Primitives', color: '2. Color' },",
      "  color: { contrastAlgorithm: 'wcag', semantics: { pairs: [",
      "    { bg: 'color/bg/default', text: 'color/text/default', Light: { bg: 'color/neutral/50', text: 'color/neutral/950' }, Dark: { bg: 'color/neutral/950', text: 'color/neutral/50' } }",
      "  ] } }",
      "};"
    ].join("\n"));

    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-showcase") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.DS.collections.color, "2. Color");
          assert.strictEqual(parsed.DS.color.contrastAlgorithm, "wcag");
          assert.strictEqual(parsed.DS.color.semantics.pairs[0].bg, "color/bg/default");
          assert.strictEqual(parsed.DS.color.semantics.pairs[0].text, "color/text/default");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, result: { sections: ["Colors"] } }));
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
      const { handleBuildShowcase } = freshBuildShowcase();
      const result = await handleBuildShowcase();
      assert.ok(!result.isError, "should succeed");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // Test 1d: missing active config is bootstrapped from the synced snapshot before showcase.
  await (async () => {
    const fileKey = "file_imported";
    const scopedDir = path.join(localDir, fileKey);
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, "active-file.json"), JSON.stringify({ fileKey, updatedAt: "now" }));
    fs.writeFileSync(path.join(scopedDir, "figma-data.json"), JSON.stringify({
      fileKey,
      fileName: "Imported DS",
      collections: [
        { id: "prim", name: "Primitives", modes: [{ modeId: "m", name: "Default" }], variableIds: ["n100", "n900"] },
        { id: "color", name: "Color", modes: [{ modeId: "l", name: "Light" }, { modeId: "d", name: "Dark" }], variableIds: ["bg", "fg", "icon"] },
      ],
      variables: [
        { id: "n100", name: "color/neutral/100", resolvedType: "COLOR", variableCollectionId: "prim", valuesByMode: { m: { r: 0.95, g: 0.95, b: 0.95 } } },
        { id: "n900", name: "color/neutral/900", resolvedType: "COLOR", variableCollectionId: "prim", valuesByMode: { m: { r: 0.05, g: 0.05, b: 0.05 } } },
        { id: "bg", name: "color/surface/brand", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n100" }, d: { type: "VARIABLE_ALIAS", id: "n900" } } },
        { id: "fg", name: "color/on-surface/brand", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n900" }, d: { type: "VARIABLE_ALIAS", id: "n100" } } },
        { id: "icon", name: "color/icon/brand", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n900" }, d: { type: "VARIABLE_ALIAS", id: "n100" } } },
      ],
    }, null, 2));

    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-showcase") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.DS.collections.color, "Color");
          assert.strictEqual(parsed.DS.color.semantics.pairs[0].bg, "color/surface/brand");
          assert.strictEqual(parsed.DS.color.semantics.pairs[0].icon, "color/icon/brand");
          assert.ok(fs.existsSync(path.join(scopedDir, "design-system.config.js")));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, result: { sections: ["Colors"] } }));
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
      const { handleBuildShowcase } = freshBuildShowcase();
      const result = await handleBuildShowcase();
      assert.ok(!result.isError, "should succeed");
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.config.created, true);
      assert.strictEqual(data.config.sourceMode, "config-backed");
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
      const { handleBuildShowcase } = freshBuildShowcase();
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
    const { handleBuildShowcase } = freshBuildShowcase();
    try {
      await handleBuildShowcase();
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err.message.includes("receiver is not running") || err.message.includes("ECONNREFUSED"), `unexpected error: ${err.message}`);
    }
  })();

  delete process.env.FIGLETS_RECEIVER_URL;
  delete process.env.FIGLETS_LOCAL_DIR;
  console.log("build-showcase-tool tests passed");
}

if (require.main === module) {
  runTests().catch(err => {
    console.error("FAIL:", err.message);
    process.exit(1);
  });
} else {
  module.exports = runTests();
}
