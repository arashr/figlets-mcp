const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  CONFIRMATION_PHRASE,
  buildBrokenDsFixturePlan,
  buildFixtureConfig,
  writeFixtureConfig,
} = require("../../packages/figlets-mcp-server/src/dev/broken-ds-fixture.js");

const first = buildBrokenDsFixturePlan({ seed: "same-seed" });
const second = buildBrokenDsFixturePlan({ seed: "same-seed" });
assert.deepStrictEqual(first, second, "fixture plan should be deterministic for a seed");
assert.strictEqual(first.confirmation, CONFIRMATION_PHRASE);
assert.strictEqual(first.reset, true);
assert.ok(first.gaps.removeVariables.includes("space/radius/md") || first.gaps.removeVariables.includes("space/border/default"));
assert.ok(first.gaps.removeVariables.some(name => /^color\//.test(name)), "plan should remove semantic color companions");
assert.deepStrictEqual(first.gaps.removeTextStyles, ["type/body/md"]);
assert.deepStrictEqual(first.gaps.trimCollectionModes, [{ collectionName: "4. Spacing", keepModeNames: ["Mobile"] }]);
assert.strictEqual(first.gaps.createBindingAuditTargets, true);
assert.deepStrictEqual(
  first.gaps.createSemanticNamingConflicts,
  [
    { source: "color/bg/danger", target: "color/bg/on-danger", kind: "invalid-on-background" },
    { source: "color/surface/info", target: "color/surface/on-info", kind: "invalid-on-background" },
  ],
  "fixture should seed BNN-45 semantic naming conflicts for manual health-check smoke"
);

const different = buildBrokenDsFixturePlan({ seed: "different-seed" });
assert.notDeepStrictEqual(first.gaps.removeVariables, different.gaps.removeVariables, "different seeds should vary the broken variable set");

const config = buildFixtureConfig({ seed: "config-seed" });
assert.strictEqual(config.project.name, "BNN-37 Broken DS Fixture config-seed");
assert.deepStrictEqual(config.breakpoints.modes, ["Mobile", "Tablet", "Desktop"]);
assert.strictEqual(config.collections.spacing, "4. Spacing");
assert.ok(config.color.brand.length >= 2);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-broken-fixture-"));
const configPath = path.join(tmp, "design-system.config.js");
const written = writeFixtureConfig(configPath, { seed: "write-seed" });
assert.strictEqual(written.configPath, configPath);
assert.ok(fs.readFileSync(configPath, "utf8").includes("BNN-37 Broken DS Fixture write-seed"));
fs.rmSync(tmp, { recursive: true, force: true });
