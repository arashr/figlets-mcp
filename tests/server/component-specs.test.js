const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { discoverComponentSpecs } = require("../../packages/figlets-mcp-server/src/utils/component-specs.js");

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-component-specs-"));
const specsDir = path.join(projectDir, "component-specs");
fs.mkdirSync(specsDir);

try {
  fs.writeFileSync(path.join(specsDir, "Icon.md"), "# Icon\n\n> Existing icon documentation.", "utf8");
  fs.writeFileSync(path.join(specsDir, "fallback-name.md"), "> No heading.", "utf8");
  fs.mkdirSync(path.join(specsDir, "icon "));
  fs.writeFileSync(path.join(specsDir, "icon ", " down.md"), "# icon / down\n\n> Nested path.", "utf8");

  const result = discoverComponentSpecs(projectDir);
  assert.deepStrictEqual(result.specs.map(spec => ({ name: spec.name, path: spec.path })), [
    { name: "fallback-name", path: "component-specs/fallback-name.md" },
    { name: "icon / down", path: "component-specs/icon / down.md" },
    { name: "Icon", path: "component-specs/Icon.md" },
  ]);
  assert.ok(result.specs.every(spec => typeof spec.content === "string"));

  fs.writeFileSync(path.join(specsDir, "Duplicate.md"), "# Icon\n", "utf8");
  assert.throws(
    () => discoverComponentSpecs(projectDir),
    /Multiple component specs resolve to "Icon"/,
  );
} finally {
  fs.rmSync(projectDir, { recursive: true, force: true });
}
