const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Isolated temp dir so these tests never touch .local/
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-detect-tool-test-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/bridges/figma-data-source.js",
  "../../packages/figlets-mcp-server/src/tools/detect-design-system.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });

const { handleDetectDesignSystem } = require("../../packages/figlets-mcp-server/src/tools/detect-design-system.js");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");
const fixturePath = path.resolve(__dirname, "../../examples/detect-design-system.figma-data.json");

try {
  {
    // inline figmaData: compact result, no snapshot key
    const result = handleDetectDesignSystem({ figmaData: exampleFigmaData });
    assert.strictEqual(result.summary.collections, 2);
    assert.ok(!result.snapshot, "compact result should not include snapshot");
  }

  {
    // file path: collections and textStyles are returned as compact arrays
    const result = handleDetectDesignSystem({ figmaDataPath: fixturePath });
    assert.strictEqual(result.summary.capabilities.hasTextStyles, true);
    assert.ok(Array.isArray(result.collections), "should have compact collections");
    assert.ok(Array.isArray(result.textStyles), "should have textStyles names");
    assert.ok(!result.snapshot, "compact result should not include snapshot");
  }

  {
    // no args: defaults to the active file-scoped snapshot written by sync_figma_data
    const fileKey = "local_active_detect";
    const fileDir = path.join(TEMP_DIR, fileKey);
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(path.join(TEMP_DIR, "active-file.json"), JSON.stringify({ fileKey }), "utf8");
    fs.writeFileSync(path.join(fileDir, "figma-data.json"), JSON.stringify(exampleFigmaData), "utf8");
    const result = handleDetectDesignSystem({});
    assert.ok(!result.error, "active file-scoped snapshot should be used by default");
    assert.strictEqual(result.source.kind, "active-file-snapshot");
    assert.strictEqual(result.source.fileKey, fileKey);
    assert.strictEqual(result.saved, path.join(fileDir, "figma-ds-context.json"));
    assert.ok(fs.existsSync(result.saved), "context should be saved beside the active snapshot");
  }

  {
    // command: collections parsed correctly
    const result = handleDetectDesignSystem({ figmaDataCommand: "cat " + fixturePath });
    const semantics = result.collections.find(c => c.name === "Semantics");
    assert.ok(semantics, "should find Semantics collection in compact result");
  }

  {
    // error path: no data source available
    const { explainMissingFigmaBridge } = require("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js");
    const error = explainMissingFigmaBridge();
    assert.strictEqual(error.code, "FIGMA_BRIDGE_NOT_CONFIGURED");
    assert.ok(error.message.length > 0);
  }

} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
}
