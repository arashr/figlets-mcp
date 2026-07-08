const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

function writeSelectionFile(componentName = "Button") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-doc-selection-"));
  const filePath = path.join(dir, "figma-selection.json");
  fs.writeFileSync(filePath, JSON.stringify({
    selection: [{ id: "1:2", name: componentName, type: "COMPONENT" }],
    meta: { fileName: "Figlets Test", pageName: "Components" }
  }));
  return { dir, filePath };
}

function writeSelectionFileForNode(node, meta = { fileName: "Figlets Test", pageName: "Components" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-doc-selection-"));
  const filePath = path.join(dir, "figma-selection.json");
  fs.writeFileSync(filePath, JSON.stringify({
    selection: [node],
    meta
  }));
  return { dir, filePath };
}

module.exports = (async () => {
  // --- Tool metadata ---
  assert.strictEqual(generateComponentDocTool.name, "generate_component_doc");
  assert.ok(generateComponentDocTool.description.length > 0);
  assert.ok(generateComponentDocTool.inputSchema.required.indexOf("description") >= 0);
  assert.ok(generateComponentDocTool.inputSchema.required.indexOf("usage_do") >= 0);
  assert.ok(generateComponentDocTool.inputSchema.required.indexOf("usage_dont") >= 0);
  assert.strictEqual(generateComponentDocTool.inputSchema.required.indexOf("component_name"), -1);

  // --- Missing component_name and no selected component → error ---
  {
    process.env.FIGLETS_RECEIVER_URL = "http://localhost:19999";
    try {
      const result = await handleGenerateComponentDoc({});
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes("Select a COMPONENT or COMPONENT_SET"));
    } finally {
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- Successful response: receiver returns markdown payload ---
  {
    let capturedBody = "";
    const originalCwd = process.cwd();
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-doc-output-"));
    const selection = writeSelectionFile("Button");
    const server = await startMockReceiver((req, res) => {
      if (req.url === "/request-selection") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: selection.filePath }));
        return;
      }
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
            accessibilityNotes: [
              "Provide alt text for informative icons.",
              "Preserve keyboard focus behavior."
            ],
            anatomyCount: 3,
            specSheet: { page: "Page 1", frame: "Button · Spec" }
          }
        }));
      });
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    process.chdir(outputDir);
    try {
      const result = await handleGenerateComponentDoc({
        component_name: "Button",
        description: "A primary call-to-action button used to trigger the most important action on a screen.",
        usage_do: ["Use for primary CTA", "Keep the label action-oriented"],
        usage_dont: ["Don't truncate the label", "Don't use for secondary actions"],
        accessibility_notes: ["Preserve keyboard focus behavior.", "Keep the accessible name aligned with the visible label."],
        variant_descriptions: { "Type=Primary": "High-emphasis" }
      });
      assert.ok(!result.isError, `expected success, got: ${JSON.stringify(result)}`);
      const sentPayload = JSON.parse(capturedBody);
      assert.strictEqual(sentPayload.componentName, "Button");
      assert.ok(sentPayload.description.startsWith("A primary call-to-action"), "description should propagate to plugin");
      assert.deepStrictEqual(sentPayload.usageDo, ["Use for primary CTA", "Keep the label action-oriented"]);
      assert.deepStrictEqual(sentPayload.usageDont, ["Don't truncate the label", "Don't use for secondary actions"]);
      assert.deepStrictEqual(sentPayload.accessibilityNotes, ["Preserve keyboard focus behavior.", "Keep the accessible name aligned with the visible label."]);
      assert.deepStrictEqual(sentPayload.variantDescriptions, { "Type=Primary": "High-emphasis" });

      const parsed = JSON.parse(result.content[0].text);
      assert.strictEqual(parsed.componentName, "Button");
      assert.strictEqual(parsed.path, "component-specs/Button.md");
      assert.ok(parsed.markdown.startsWith("# Button"));
      assert.strictEqual(parsed.bindingsCount, 7);
      assert.strictEqual(parsed.pathWritten, true);
      const expectedWrittenPath = path.join(fs.realpathSync(outputDir), "component-specs", "Button.md");
      assert.strictEqual(parsed.writtenPath, expectedWrittenPath);
      assert.strictEqual(
        fs.readFileSync(expectedWrittenPath, "utf8"),
        "# Button\n\n> stub"
      );
      assert.deepStrictEqual(parsed.accessibilityNotes, [
        "Provide alt text for informative icons.",
        "Preserve keyboard focus behavior."
      ]);
      assert.ok(parsed.message.includes("component-specs/Button.md"));
    } finally {
      process.chdir(originalCwd);
      server.close();
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.rmSync(selection.dir, { recursive: true, force: true });
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- Selected variant component may be documented through its parent component name ---
  {
    let capturedBody = "";
    const originalCwd = process.cwd();
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-doc-output-"));
    const selection = writeSelectionFileForNode({ id: "1:9", name: "State=Sold Out", type: "COMPONENT" });
    const server = await startMockReceiver((req, res) => {
      if (req.url === "/request-selection") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: selection.filePath }));
        return;
      }
      assert.strictEqual(req.url, "/request-doc-build");
      req.on("data", (chunk) => { capturedBody += chunk.toString(); });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            componentName: "Product Card",
            markdown: "# Product Card\n\n> stub",
            path: "component-specs/Product Card.md",
            componentMeta: {
              type: "COMPONENT_SET",
              variantCount: 2,
              width: 320,
              height: 240,
              propertyCount: 1,
              documentedVariantSelection: true,
              selectedVariantName: "State=Sold Out"
            },
            selectionContext: {
              componentName: "Product Card",
              componentId: "1:9",
              componentType: "COMPONENT",
              documentedComponentId: "1:8",
              documentedComponentType: "COMPONENT_SET",
              documentedVariantSelection: true,
              selectedVariantName: "State=Sold Out"
            }
          }
        }));
      });
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    process.chdir(outputDir);
    try {
      const result = await handleGenerateComponentDoc({
        component_name: "Product Card",
        description: "A product card used to show purchasable and unavailable item states.",
        usage_do: ["Use for product listings", "Document the full variant set"],
        usage_dont: ["Don't document only one state", "Don't detach variants"]
      });
      assert.ok(!result.isError, `expected success, got: ${JSON.stringify(result)}`);
      const sentPayload = JSON.parse(capturedBody);
      assert.strictEqual(sentPayload.componentId, "1:9");
      assert.strictEqual(sentPayload.componentName, "Product Card");
      const parsed = JSON.parse(result.content[0].text);
      assert.strictEqual(parsed.componentName, "Product Card");
      assert.strictEqual(parsed.pathWritten, true);
      const expectedWrittenPath = path.join(fs.realpathSync(outputDir), "component-specs", "Product Card.md");
      assert.strictEqual(parsed.writtenPath, expectedWrittenPath);
      assert.strictEqual(
        fs.readFileSync(expectedWrittenPath, "utf8"),
        "# Product Card\n\n> stub"
      );
      assert.strictEqual(parsed.componentMeta.documentedVariantSelection, true);
      assert.strictEqual(parsed.selectionContext.selectedVariantName, "State=Sold Out");
    } finally {
      process.chdir(originalCwd);
      server.close();
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.rmSync(selection.dir, { recursive: true, force: true });
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- Plugin error path: result.error → isError true with message ---
  {
    const selection = writeSelectionFile("Foo");
    const server = await startMockReceiver((req, res) => {
      if (req.url === "/request-selection") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: selection.filePath }));
        return;
      }
      req.on("data", () => {}); req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, result: { error: "Component not found on current page: Foo" } }));
      });
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    try {
      const result = await handleGenerateComponentDoc({
        component_name: "Foo",
        description: "A missing component used to exercise plugin error handling.",
        usage_do: ["Use real components", "Select the intended component"],
        usage_dont: ["Don't pass stale names", "Don't ignore plugin errors"]
      });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes("Component not found"));
    } finally {
      server.close();
      fs.rmSync(selection.dir, { recursive: true, force: true });
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- Selection 503: preserve bridge connection details instead of asking for selection ---
  {
    let selectionAttempts = 0;
    const server = await startMockReceiver((req, res) => {
      assert.strictEqual(req.url, "/request-selection");
      selectionAttempts += 1;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Figma plugin was connected recently but is not listening for a new command yet.",
        activeSessionId: "figlets-selection-session",
        pluginRecentlySeen: true,
        pluginCapabilities: ["component-docs"]
      }));
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    try {
      const result = await handleGenerateComponentDoc({
        component_name: "Button",
        description: "A primary call-to-action button used to trigger the most important action on a screen.",
        usage_do: ["Use for primary CTA", "Keep the label action-oriented"],
        usage_dont: ["Don't truncate the label", "Don't use for secondary actions"]
      });
      assert.strictEqual(result.isError, true);
      assert.strictEqual(selectionAttempts, 3);
      assert.ok(result.content[0].text.includes("plugin is not connected"));
      assert.ok(result.content[0].text.includes("figlets-selection-session"));
      assert.ok(result.content[0].text.includes("seen recently"));
      assert.ok(!result.content[0].text.includes("Select a COMPONENT"));
    } finally {
      server.close();
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- 503: plugin not connected ---
  {
    const selection = writeSelectionFile("Button");
    const server = await startMockReceiver((req, res) => {
      if (req.url === "/request-selection") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: selection.filePath }));
        return;
      }
      req.on("data", () => {}); req.on("end", () => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "plugin not connected", activeSessionId: "figlets-test-session" }));
      });
    });
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${server.address().port}`;
    try {
      const result = await handleGenerateComponentDoc({
        component_name: "Button",
        description: "A primary call-to-action button used to trigger the most important action on a screen.",
        usage_do: ["Use for primary CTA", "Keep the label action-oriented"],
        usage_dont: ["Don't truncate the label", "Don't use for secondary actions"]
      });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes("plugin is not connected"));
      assert.ok(result.content[0].text.includes("figlets-test-session"));
    } finally {
      server.close();
      fs.rmSync(selection.dir, { recursive: true, force: true });
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }

  // --- ECONNREFUSED: receiver not running ---
  {
    process.env.FIGLETS_RECEIVER_URL = "http://localhost:19999";
    try {
      const result = await handleGenerateComponentDoc({
        component_name: "Button",
        description: "A primary call-to-action button used to trigger the most important action on a screen.",
        usage_do: ["Use for primary CTA", "Keep the label action-oriented"],
        usage_dont: ["Don't truncate the label", "Don't use for secondary actions"]
      });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes("Bridge receiver is not running"));
    } finally {
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  }
})();
