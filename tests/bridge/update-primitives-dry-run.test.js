const assert = require("assert");
const fs = require("fs");
const path = require("path");

const codePath = path.join(__dirname, "../../packages/figma-bridge-plugin/code.js");
const source = fs.readFileSync(codePath, "utf8");

function extractFunction(name) {
  const start = source.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} should exist`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

module.exports = (() => {
  const fn = extractFunction("_updateDsPrimitives");

  assert.ok(/var dryRun = !!\(payload && payload\.dryRun\);/.test(fn), "update path should accept dryRun");
  assert.ok(/wouldCreateNames/.test(fn), "dry-run report should list proposed creations");
  assert.ok(/wouldUpdate/.test(fn), "dry-run report should count proposed updates");

  const createIndex = fn.indexOf("figma.variables.createVariable");
  assert.ok(createIndex > 0, "update path should still be able to create when confirmed");
  const beforeCreate = fn.slice(Math.max(0, createIndex - 2200), createIndex);
  assert.ok(/if \(dryRun\)/.test(beforeCreate), "createVariable path should be guarded by a dry-run branch");

  const setIndex = fn.indexOf("setValueForMode");
  assert.ok(setIndex > 0, "update path should still be able to set values when confirmed");
  const beforeSet = fn.slice(Math.max(0, setIndex - 260), setIndex);
  assert.ok(/if \(dryRun\)/.test(beforeSet), "setValueForMode path should be guarded by a dry-run branch");

  const removeIndex = fn.indexOf(".remove()");
  assert.ok(removeIndex > 0, "update path should still be able to prune when confirmed");
  const beforeRemove = fn.slice(Math.max(0, removeIndex - 220), removeIndex);
  assert.ok(/if \(dryRun\)/.test(beforeRemove), "remove path should be guarded by a dry-run branch");

  assert.ok(
    /['"]primitive-typography['"]:\s*function/.test(source) && /_primitiveTypographyEntries/.test(source),
    "bridge should support primitive-typography via update_ds_primitives"
  );
  assert.ok(
    /['"]primitive-shadow['"]:\s*function/.test(source) && /_primitiveShadowEntries/.test(source),
    "bridge should support primitive-shadow via update_ds_primitives"
  );
  assert.ok(
    /:\s*\['color',\s*'spacing',\s*'color-semantics'\]/.test(fn),
    "default update_ds_primitives categories should stay color/spacing/semantics only"
  );
})();
