const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-inspect-tool-test-"));

const selectionData = {
  selection: [
    {
      id: "101:1",
      type: "COMPONENT_SET",
      name: "Button",
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
      padding: { top: 12, right: 16, bottom: 12, left: 16 },
      componentPropertyDefinitions: {
        size: { type: "VARIANT", defaultValue: "md" }
      },
      children: [
        { id: "101:2", type: "TEXT", name: "label" }
      ]
    }
  ]
};

const selectionPath = path.join(TEMP_DIR, "figma-selection.json");
fs.writeFileSync(selectionPath, JSON.stringify(selectionData), "utf-8");

const toolModule = "../../packages/figlets-mcp-server/src/tools/inspect-component.js";

{
  const { inspectComponentTool } = require(toolModule);
  assert.ok(inspectComponentTool.inputSchema.properties.project_path);
  assert.ok(inspectComponentTool.inputSchema.properties.component_id);
  assert.ok(inspectComponentTool.description.includes("bounded nested-component dependency summary"));
}

async function runTests() {
  // --- successful inspection ---
  await (async () => {
    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-selection") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: selectionPath }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve(toolModule)];
      const { handleInspectComponent } = require(toolModule);
      const result = await handleInspectComponent();
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.selectedNodesCount, 1, "should report one selected node");
      assert.strictEqual(data.selection[0].name, "Button", "should include component name");
      assert.ok(data.selection[0].autoLayout, "should include autoLayout for HORIZONTAL layout");
      assert.strictEqual(data.selection[0].autoLayout.itemSpacing, 8, "should preserve itemSpacing");
      assert.ok(data.selection[0].componentPropertyDefinitions, "should preserve componentPropertyDefinitions");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // --- nested inspection recognizes existing project-scoped component specs ---
  await (async () => {
    const projectPath = path.join(TEMP_DIR, "nested-project");
    const componentSpecsPath = path.join(projectPath, "component-specs");
    const nestedSelectionPath = path.join(TEMP_DIR, "figma-selection-nested.json");
    fs.mkdirSync(componentSpecsPath, { recursive: true });
    fs.writeFileSync(path.join(componentSpecsPath, "Icon.md"), "# Icon\n\n> Existing spec.", "utf8");
    fs.writeFileSync(nestedSelectionPath, JSON.stringify({
      selection: [{
        id: "201:1",
        type: "COMPONENT",
        name: "Icon Button",
        children: [{
          id: "201:2",
          type: "INSTANCE",
          name: "Icon",
          mainComponent: { id: "301:1", key: "icon", name: "Icon" },
          children: []
        }]
      }]
    }), "utf8");

    let requestPayload = null;
    const mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => { body += chunk.toString(); });
      req.on("end", () => {
        requestPayload = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: nestedSelectionPath }));
      });
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${mockServer.address().port}`;
    try {
      delete require.cache[require.resolve(toolModule)];
      const { handleInspectComponent } = require(toolModule);
      const result = await handleInspectComponent({
        project_path: projectPath,
        component_id: "201:1"
      });
      const data = JSON.parse(result.content[0].text);
      assert.deepStrictEqual(requestPayload, { componentId: "201:1" });
      assert.strictEqual(data.nestedComponentSummary.count, 1);
      assert.strictEqual(data.nestedComponentSummary.documentedCount, 1);
      assert.strictEqual(data.nestedComponents[0].specPath, "component-specs/Icon.md");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // --- 503 from bridge causes error throw ---
  await (async () => {
    const mockServer = http.createServer((req, res) => {
      res.writeHead(503);
      res.end("plugin not connected");
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve(toolModule)];
      const { handleInspectComponent } = require(toolModule);
      let threw = false;
      try {
        await handleInspectComponent();
      } catch (err) {
        threw = true;
        assert.ok(/503/.test(err.message) || /failed/i.test(err.message), "error message should indicate failure");
      }
      assert.ok(threw, "should throw when bridge returns 503");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // --- empty selection returns error shape ---
  await (async () => {
    const emptySelectionPath = path.join(TEMP_DIR, "figma-selection-empty.json");
    fs.writeFileSync(emptySelectionPath, JSON.stringify({ selection: [] }), "utf-8");

    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-selection") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: emptySelectionPath }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve(toolModule)];
      const { handleInspectComponent } = require(toolModule);
      const result = await handleInspectComponent();
      const data = JSON.parse(result.content[0].text);
      assert.ok(data.error, "should return error when nothing is selected");
      assert.ok(/selected/i.test(data.error), "error should mention selection");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  // --- shared bridge helper failure mapping is surfaced ---
  await (async () => {
    const missingHookPath = path.join(TEMP_DIR, "missing-bridge-hook.json");
    process.env.FIGLETS_BRIDGE_HOOK_FILE = missingHookPath;

    try {
      delete require.cache[require.resolve(toolModule)];
      const { handleInspectComponent } = require(toolModule);
      let threw = false;
      try {
        await handleInspectComponent();
      } catch (err) {
        threw = true;
        assert.ok(
          err.message.includes("FIGLETS_BRIDGE_HOOK_FILE is set but the hook file does not exist"),
          `error should come from shared bridge request helper, got: ${err.message}`
        );
      }
      assert.ok(threw, "should throw shared helper bridge-hook error");
    } finally {
      delete process.env.FIGLETS_BRIDGE_HOOK_FILE;
    }
  })();
}

module.exports = runTests().finally(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete require.cache[require.resolve(toolModule)];
  delete process.env.FIGLETS_RECEIVER_URL;
});
