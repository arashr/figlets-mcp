const assert = require("assert");
const { auditTokens } = require("../../packages/figlets-core/src/audit-tokens.js");

const ALIAS = (id) => ({ type: "VARIABLE_ALIAS", id });

const mockData = {
  collections: [
    { id: "col:1", name: "Primitives", variableIds: ["var:1", "var:2", "var:3"] },
    { id: "col:2", name: "Semantics", variableIds: ["var:4", "var:5", "var:6"] }
  ],
  variables: [
    // col:1 — raw non-primitive colors (should be unaliased, consistent path tokens)
    {
      id: "var:1",
      name: "color/brand/primary",
      resolvedType: "COLOR",
      valuesByMode: { "mode:1": { r: 1, g: 0, b: 0, a: 1 } }
    },
    {
      id: "var:2",
      name: "color/brand/secondary",
      resolvedType: "COLOR",
      valuesByMode: { "mode:1": { r: 0, g: 0, b: 1, a: 1 } }
    },
    // col:1 — duplicate value (same as var:1)
    {
      id: "var:3",
      name: "color/brand/accent",
      resolvedType: "COLOR",
      valuesByMode: { "mode:1": { r: 1, g: 0, b: 0, a: 1 } }
    },
    // col:2 — semantic tokens aliased to primitives (should NOT appear in unaliased)
    {
      id: "var:4",
      name: "color/action/default",
      resolvedType: "COLOR",
      valuesByMode: { "mode:1": ALIAS("var:1") }
    },
    {
      id: "var:5",
      name: "color/action/hover",
      resolvedType: "COLOR",
      valuesByMode: { "mode:1": ALIAS("var:2") }
    },
    // col:2 — mixed naming: camelCase in a mostly consistent collection
    {
      id: "var:6",
      name: "color/action/primaryColor",
      resolvedType: "COLOR",
      valuesByMode: { "mode:1": ALIAS("var:1") }
    }
  ]
};

{
  // Test 1: empty input
  const result = auditTokens({ variables: [], collections: [] });
  assert.ok(result.error, "Should return error for empty variables");
}

{
  // Test 2: unaliased variables are detected
  const result = auditTokens(mockData);
  assert.strictEqual(result.summary.totalVariables, 6);
  const unaliasedNames = result.unaliased.map(v => v.name);
  assert.ok(unaliasedNames.includes("color/brand/primary"), "primary should be unaliased");
  assert.ok(unaliasedNames.includes("color/brand/secondary"), "secondary should be unaliased");
  // aliased tokens should NOT appear in unaliased
  assert.ok(!unaliasedNames.includes("color/action/default"), "aliased token should not be in unaliased");
}

{
  // Test 3: duplicate values are detected
  const result = auditTokens(mockData);
  assert.ok(result.duplicates.length >= 1, "Should detect at least one duplicate value group");
  const dup = result.duplicates.find(d =>
    d.variables.includes("color/brand/primary") && d.variables.includes("color/brand/accent")
  );
  assert.ok(dup, "primary and accent share the same red value and should be grouped as duplicates");
}

{
  // Test 4: summary counts are correct
  const result = auditTokens(mockData);
  assert.strictEqual(result.summary.unaliasedCount, 3); // var:1, var:2, var:3 are all raw
  assert.ok(result.summary.duplicateValueGroups >= 1);
}

{
  // Test 6: numeric primitive ramps are inventory, not unaliased defects.
  const primitiveRamp = {
    collections: [{ id: "p", name: "Primitives", variableIds: ["p1", "p2", "s1", "t1"] }],
    variables: [
      { id: "p1", name: "color/neutral/100", resolvedType: "COLOR", valuesByMode: { m: { r: 1, g: 1, b: 1, a: 1 } } },
      { id: "p2", name: "color/neutral-variant/100", resolvedType: "COLOR", valuesByMode: { m: { r: 1, g: 1, b: 1, a: 1 } } },
      { id: "s1", name: "space/0_5", resolvedType: "FLOAT", valuesByMode: { m: 2 } },
      { id: "t1", name: "type/size/md", resolvedType: "FLOAT", valuesByMode: { m: 16 } },
    ]
  };
  const result = auditTokens(primitiveRamp);
  assert.strictEqual(result.summary.unaliasedCount, 0);
  assert.strictEqual(result.summary.rawPrimitiveCount, 4);
  assert.strictEqual(result.summary.collectionNamingIssues, 0, "numeric leaves and kebab path segments should not look like mixed naming");
  assert.strictEqual(result.summary.duplicateValueGroups, 0, "cross-ramp primitive coincidences should not be issue duplicates");
  assert.ok(result.summary.informationalDuplicateValueGroups >= 1, "cross-ramp primitive coincidences remain available as info");
}

{
  // Test 5: works with real-world style data where all values are aliased
  const allAliased = {
    collections: [{ id: "c1", name: "Semantics", variableIds: ["v1", "v2"] }],
    variables: [
      { id: "v1", name: "color/bg", resolvedType: "COLOR", valuesByMode: { m1: ALIAS("p1") } },
      { id: "v2", name: "color/fg", resolvedType: "COLOR", valuesByMode: { m1: ALIAS("p2") } }
    ]
  };
  const result = auditTokens(allAliased);
  assert.strictEqual(result.summary.unaliasedCount, 0, "All aliased — no unaliased issues");
  assert.strictEqual(result.summary.duplicateValueGroups, 0, "No raw values to duplicate");
}
