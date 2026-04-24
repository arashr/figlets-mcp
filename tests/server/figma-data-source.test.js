const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  explainMissingFigmaBridge,
  loadFigmaDataSource
} = require("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");

const fixturePath = path.resolve(__dirname, "../../examples/detect-design-system.figma-data.json");
const localSnapshotPath = path.resolve(__dirname, "../../.local/figma-data.json");

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

{
  // Falls back to .local/figma-data.json when no source is explicitly provided
  // This test only runs if the local snapshot exists (i.e. after a sync)
  if (fs.existsSync(localSnapshotPath)) {
    const result = loadFigmaDataSource({});
    assert.strictEqual(result.kind, "local-snapshot", "should fall back to local snapshot");
    assert.ok(result.figmaData && typeof result.figmaData === "object", "should load valid JSON");
    assert.ok(result.meta.path.endsWith("figma-data.json"), "meta should include the snapshot path");
  }
}
