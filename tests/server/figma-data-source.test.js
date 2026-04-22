const assert = require("assert");
const path = require("path");
const {
  explainMissingFigmaBridge,
  loadFigmaDataSource
} = require("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");

const fixturePath = path.resolve(__dirname, "../../examples/detect-design-system.figma-data.json");

{
  const result = loadFigmaDataSource({ figmaData: exampleFigmaData });
  assert.strictEqual(result.kind, "inline");
  assert.strictEqual(result.target, "fixture-file");
}

{
  const result = loadFigmaDataSource({ figmaDataPath: fixturePath });
  assert.strictEqual(result.kind, "file");
  assert.strictEqual(result.meta.path, fixturePath);
}

{
  const result = loadFigmaDataSource({
    figmaDataCommand: "cat " + fixturePath
  });
  assert.strictEqual(result.kind, "command");
  assert.strictEqual(result.target, "example-file");
}

{
  const missing = explainMissingFigmaBridge();
  assert.strictEqual(missing.code, "FIGMA_BRIDGE_NOT_CONFIGURED");
  assert.ok(/figmaDataCommand/.test(missing.message));
}
