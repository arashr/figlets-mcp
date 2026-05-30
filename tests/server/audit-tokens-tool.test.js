const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-audit-tool-test-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/tools/audit-tokens.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (e) {} });

const { handleAuditTokens } = require("../../packages/figlets-mcp-server/src/tools/audit-tokens.js");

const figmaData = {
  variables: [
    // primitive color — unaliased, raw value
    { id: "v1", name: "color/brand/500", resolvedType: "COLOR", valuesByMode: { m1: { r: 0.2, g: 0.4, b: 0.8, a: 1 } } },
    // semantic color — aliased, should NOT appear as unaliased
    { id: "v2", name: "color/bg/brand", resolvedType: "COLOR", valuesByMode: { m1: { type: "VARIABLE_ALIAS", id: "v1" } } },
    // duplicate float values
    { id: "v3", name: "space/4", resolvedType: "FLOAT", valuesByMode: { m1: 16 } },
    { id: "v4", name: "space/md", resolvedType: "FLOAT", valuesByMode: { m1: 16 } }
  ],
  collections: [
    { id: "c1", name: "Primitives", variableIds: ["v1", "v2"] },
    { id: "c2", name: "Spacing", variableIds: ["v3", "v4"] }
  ]
};

try {
  // missing snapshot throws
  assert.throws(
    () => handleAuditTokens({}),
    /not found/i,
    "should throw when snapshot is missing"
  );

  // write snapshot to temp dir
  const dataPath = path.join(TEMP_DIR, "figma-data.json");
  fs.writeFileSync(dataPath, JSON.stringify(figmaData), "utf-8");

  {
    // default path resolves to temp dir
    const result = handleAuditTokens({});
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.summary.totalVariables, 4, "should count all variables");
    // primitive raw values are inventory, not unaliased defects
    assert.strictEqual(data.summary.unaliasedCount, 1, "semantic raw float should count as unaliased");
    assert.strictEqual(data.summary.rawPrimitiveCount, 2, "primitive color and numeric spacing are inventory");
    // space/4 and space/md share the same value in one domain — review, not cross-domain info
    assert.strictEqual(data.summary.duplicateValueGroups, 1, "should detect same-domain duplicate value group");
    assert.ok(data.duplicates[0].variables.includes("space/4"), "should name duplicate variables");
    assert.ok(data.duplicates[0].variables.includes("space/md"), "should name duplicate variables");
    // v2 is aliased — must NOT appear in unaliased list
    const unaliasedNames = data.unaliased.map(u => u.name);
    assert.ok(!unaliasedNames.includes("color/bg/brand"), "aliased variable must not appear as unaliased");
  }

  {
    // explicit custom path
    const result = handleAuditTokens({ figmaDataPath: dataPath });
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.summary.totalVariables, 4, "custom path should return same result");
  }

  {
    const configPath = path.join(TEMP_DIR, "design-system.config.js");
    const repairableDataPath = path.join(TEMP_DIR, "figma-data-spacing-repair.json");
    const repairableData = {
      collections: [
        {
          id: "primitives",
          name: "1. Primitives",
          variableIds: ["p48"],
          modes: [{ modeId: "default", name: "Default" }],
        },
        {
          id: "spacing",
          name: "4. Spacing",
          variableIds: ["layout-lg"],
          modes: [{ modeId: "mobile", name: "Mobile" }],
        },
      ],
      variables: [
        { id: "p48", name: "space/48", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
        {
          id: "layout-lg",
          name: "space/layout/lg",
          resolvedType: "FLOAT",
          valuesByMode: { mobile: 48 },
        },
      ],
    };
    fs.writeFileSync(configPath, "const DS = " + JSON.stringify({
      collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
      spacing: { semantic: { "layout/lg": [48, 64, 96] } },
    }, null, 2) + ";\n", "utf8");
    fs.writeFileSync(repairableDataPath, JSON.stringify(repairableData), "utf-8");

    const result = handleAuditTokens({ figmaDataPath: repairableDataPath });
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.semanticAliasRepairModel, "audit should expose semantic alias repair model");
    assert.ok(data.repairGuidance, "repairable raw semantic spacing should include repair guidance");
    assert.ok(
      data.repairableUnaliased.some(row => row.name === "space/layout/lg"),
      "repairable unaliased spacing semantics should be separated from manual follow-up"
    );
    assert.ok(
      !data.manualFollowUpUnaliased.some(row => row.name === "space/layout/lg"),
      "repairable spacing semantics should not remain in manual follow-up bucket"
    );
  }

  {
    // non-existent custom path throws
    assert.throws(
      () => handleAuditTokens({ figmaDataPath: "/tmp/figlets-test-nonexistent-99999.json" }),
      /not found/i,
      "should throw for a missing custom path"
    );
  }

} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (e) {} });
}
