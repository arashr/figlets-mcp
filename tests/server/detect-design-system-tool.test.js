const assert = require("assert");
const path = require("path");
const { detectDesignSystemTool } = require("../../packages/figlets-mcp-server/src/tools/detect-design-system.js");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");

const fixturePath = path.resolve(__dirname, "../../examples/detect-design-system.figma-data.json");

{
  const result = detectDesignSystemTool.handler({
    figmaData: exampleFigmaData
  });

  assert.strictEqual(result.summary.collections, 2);
  assert.strictEqual(result.source, "inline");
}

{
  const result = detectDesignSystemTool.handler({
    figmaDataPath: fixturePath
  });

  assert.strictEqual(result.source, "file");
  assert.strictEqual(result.summary.capabilities.hasTextStyles, true);
}

{
  const result = detectDesignSystemTool.handler({
    figmaDataCommand: "cat " + fixturePath
  });

  assert.strictEqual(result.source, "command");
  assert.strictEqual(result.snapshot.collections[1].name, "Semantics");
}

{
  const result = detectDesignSystemTool.handler({
    snapshot: {
      target: "snapshot-input",
      collections: [],
      textStyles: [],
      effectStyles: []
    }
  });

  assert.strictEqual(result.target, "snapshot-input");
  assert.strictEqual(result.summary.collections, 0);
}

{
  // When no source is provided and no local snapshot exists, the bridge error is returned.
  // Test the error shape directly via the bridge explainer — the no-arg handler path now
  // falls back to .local/figma-data.json if it exists (written by sync_figma_data).
  const { explainMissingFigmaBridge } = require("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js");
  const error = explainMissingFigmaBridge();
  assert.strictEqual(error.code, "FIGMA_BRIDGE_NOT_CONFIGURED");
  assert.ok(error.message.length > 0);
}
