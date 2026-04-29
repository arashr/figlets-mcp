const assert = require("assert");
const http = require("http");

const {
  generateComponentDocTool,
  handleGenerateComponentDoc
} = require("../../packages/figlets-mcp-server/src/tools/generate-component-doc.js");

function startMockReceiver(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve(server));
  });
}

module.exports = (async () => {
  // --- Tool metadata ---
  assert.strictEqual(generateComponentDocTool.name, "generate_component_doc");
  assert.ok(generateComponentDocTool.description.length > 0);
  assert.ok(generateComponentDocTool.inputSchema.required.indexOf("component_name") >= 0);

  // --- Missing component_name → error ---
  {
    const result = await handleGenerateComponentDoc({});
    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("component_name is required"));
  }

  // --- Successful response: receiver returns markdown payload ---
  {
    let capturedBody = "";
    const server = await startMockReceiver((req, res) => {
      assert.strictEqual(req.url, "/request-doc-build");
      assert.strictEqual(req.method, "POST");
      req.on("data", (chunk) => { capturedBody += chunk.toString(); });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            componentName: "Button",
            markdown: "# Button\n\n> stub",
            path: "component-specs/Button.md",
            componentMeta: { type: "COMPONENT_SET", variantCount: 4, width: 120, height: 40, propertyCount: 2 },
            bindingsCount: 7,
            anatomyCount: 3,
            specSheet: { page: "Page 1", frame: "Button · Spec" }
          }
        }));
      });
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    try {
      const result = await handleGenerateComponentDoc({
        component_name: "Button",
        description: "A primary call-to-action button used to trigger the most important action on a screen.",
        usage_do: ["Use for primary CTA"],
        usage_dont: ["Don't truncate the label"],
        variant_descriptions: { "Type=Primary": "High-emphasis" }
      });
      assert.ok(!result.isError, `expected success, got: ${JSON.stringify(result)}`);
      const sentPayload = JSON.parse(capturedBody);
      assert.strictEqual(sentPayload.componentName, "Button");
      assert.ok(sentPayload.description.startsWith("A primary call-to-action"), "description should propagate to plugin");
      assert.deepStrictEqual(sentPayload.usageDo, ["Use for primary CTA"]);
      assert.deepStrictEqual(sentPayload.usageDont, ["Don't truncate the label"]);
      assert.deepStrictEqual(sentPayload.variantDescriptions, { "Type=Primary": "High-emphasis" });

      const parsed = JSON.parse(result.content[0].text);
      assert.strictEqual(parsed.componentName, "Button");
      assert.strictEqual(parsed.path, "component-specs/Button.md");
      assert.ok(parsed.markdown.startsWith("# Button"));
      assert.strictEqual(parsed.bindingsCount, 7);
      assert.ok(parsed.message.includes("component-specs/Button.md"));
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- Plugin error path: result.error → isError true with message ---
  {
    const server = await startMockReceiver((req, res) => {
      req.on("data", () => {}); req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, result: { error: "Component not found on current page: Foo" } }));
      });
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    try {
      const result = await handleGenerateComponentDoc({ component_name: "Foo" });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes("Component not found"));
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- 503: plugin not connected ---
  {
    const server = await startMockReceiver((req, res) => {
      req.on("data", () => {}); req.on("end", () => {
        res.writeHead(503); res.end("plugin not connected");
      });
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    try {
      const result = await handleGenerateComponentDoc({ component_name: "Button" });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes("plugin is not connected"));
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- ECONNREFUSED: receiver not running ---
  {
    process.env.FIGLETS_RECEIVER_URL = "http://localhost:19999";
    try {
      const result = await handleGenerateComponentDoc({ component_name: "Button" });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes("Bridge receiver is not running"));
    } finally {
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }
})();
