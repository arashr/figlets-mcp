const assert = require("assert");
const path = require("path");
const { LOCAL_DIR, FIGMA_DATA_PATH, DS_CONTEXT_PATH, SELECTION_PATH } = require("../../packages/figlets-mcp-server/src/utils/paths.js");

// Test 1: all paths are strings
assert.strictEqual(typeof LOCAL_DIR, "string");
assert.strictEqual(typeof FIGMA_DATA_PATH, "string");
assert.strictEqual(typeof DS_CONTEXT_PATH, "string");
assert.strictEqual(typeof SELECTION_PATH, "string");

// Test 2: all paths live inside LOCAL_DIR
assert.ok(FIGMA_DATA_PATH.startsWith(LOCAL_DIR), "FIGMA_DATA_PATH should be inside LOCAL_DIR");
assert.ok(DS_CONTEXT_PATH.startsWith(LOCAL_DIR), "DS_CONTEXT_PATH should be inside LOCAL_DIR");
assert.ok(SELECTION_PATH.startsWith(LOCAL_DIR), "SELECTION_PATH should be inside LOCAL_DIR");

// Test 3: correct filenames
assert.strictEqual(path.basename(FIGMA_DATA_PATH), "figma-data.json");
assert.strictEqual(path.basename(DS_CONTEXT_PATH), "figma-ds-context.json");
assert.strictEqual(path.basename(SELECTION_PATH), "figma-selection.json");

// Test 4: FIGLETS_LOCAL_DIR env override is respected
{
  const original = process.env.FIGLETS_LOCAL_DIR;
  process.env.FIGLETS_LOCAL_DIR = "/tmp/test-figlets";
  // Clear require cache to pick up new env
  delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
  const overridden = require("../../packages/figlets-mcp-server/src/utils/paths.js");
  assert.strictEqual(overridden.LOCAL_DIR, "/tmp/test-figlets");
  assert.ok(overridden.FIGMA_DATA_PATH.startsWith("/tmp/test-figlets"));
  // Restore
  if (original === undefined) delete process.env.FIGLETS_LOCAL_DIR;
  else process.env.FIGLETS_LOCAL_DIR = original;
  delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
}
