const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Use an isolated temp dir so this test never touches the real .local/
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-ds-test-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

// Clear cached modules that capture FIGLETS_LOCAL_DIR at load time
const toClear = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/bridges/figma-data-source.js",
  "../../packages/figlets-mcp-server/src/tools/detect-design-system.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });

const { DS_CONTEXT_PATH } = require("../../packages/figlets-mcp-server/src/utils/paths.js");
const { handleDetectDesignSystem } = require("../../packages/figlets-mcp-server/src/tools/detect-design-system.js");

const FIXTURE = path.resolve(__dirname, "../../examples/detect-design-system.figma-data.json");

try {
  const result = handleDetectDesignSystem({ figmaDataPath: FIXTURE });

  // Test 1: DS context was saved to disk
  assert.ok(fs.existsSync(DS_CONTEXT_PATH), `DS context should be saved to ${DS_CONTEXT_PATH}`);

  // Test 2: saved file has the right shape (collections, context indexes, typographyStrategy)
  const saved = JSON.parse(fs.readFileSync(DS_CONTEXT_PATH, "utf-8"));
  assert.ok(saved.context, "saved context should have a context object");
  assert.ok(saved.context.indexes, "saved context should have indexes");
  assert.ok(typeof saved.context.typographyStrategy === "string", "saved context should have typographyStrategy");
  assert.ok(Array.isArray(saved.collections), "saved context should have collections array");

  // Test 3: agent response has no raw snapshot or variable arrays
  assert.ok(!result.snapshot, "agent result should NOT include raw snapshot");
  assert.ok(!result.variables, "agent result should NOT include raw variables");

  // Test 4: agent response has compact summary
  assert.ok(result.summary, "agent result should have summary");
  assert.strictEqual(typeof result.typographyStrategy, "string", "agent result should have typographyStrategy");
  assert.ok(Array.isArray(result.collections), "agent result should have collections array");
  assert.ok(result.collections.every(c => typeof c.name === "string"), "each collection should have a name");
  assert.ok(result.collections.every(c => typeof c.variables === "number"), "each collection should have variable count");
  assert.ok(Array.isArray(result.textStyles), "agent result should have textStyles array");
  assert.ok(Array.isArray(result.effectStyles), "agent result should have effectStyles array");

  // Test 5: saved path is reported back
  assert.strictEqual(result.saved, DS_CONTEXT_PATH, "saved path should match DS_CONTEXT_PATH");

} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
}
