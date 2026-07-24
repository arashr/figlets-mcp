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
  assert.strictEqual(result.summary.totalVariables, 0, "empty synced files should return an empty audit summary");
  assert.strictEqual(result.emptyDesignSystem.isEmpty, true, "empty synced files should be reported as an empty design-system state");
  assert.deepStrictEqual(result.unaliased, []);
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
    collections: [{ id: "p", name: "Primitives", variableIds: ["p1", "p2", "s1", "s2", "sfull", "t1", "r1", "b1"] }],
    variables: [
      { id: "p1", name: "color/neutral/100", resolvedType: "COLOR", valuesByMode: { m: { r: 1, g: 1, b: 1, a: 1 } } },
      { id: "p2", name: "color/neutral-variant/100", resolvedType: "COLOR", valuesByMode: { m: { r: 1, g: 1, b: 1, a: 1 } } },
      { id: "s1", name: "space/0_5", resolvedType: "FLOAT", valuesByMode: { m: 2 } },
      { id: "s2", name: "space/0-5", resolvedType: "FLOAT", valuesByMode: { m: 3 } },
      { id: "sfull", name: "space/full", resolvedType: "FLOAT", valuesByMode: { m: 9999 } },
      { id: "t1", name: "type/size/md", resolvedType: "FLOAT", valuesByMode: { m: 16 } },
      { id: "r1", name: "radius/md", resolvedType: "FLOAT", valuesByMode: { m: 8 } },
      { id: "b1", name: "border/width/default", resolvedType: "FLOAT", valuesByMode: { m: 1 } },
    ]
  };
  const result = auditTokens(primitiveRamp);
  assert.strictEqual(result.summary.unaliasedCount, 0);
  assert.strictEqual(result.summary.rawPrimitiveCount, 8);
  assert.ok(
    !result.unaliased.some(row => row.name === "space/0-5"),
    "fractional primitive steps with hyphens (space/0-5) are inventory, not unaliased defects"
  );
  assert.ok(
    !result.unaliased.some(row => row.name === "space/full"),
    "full radius primitive (space/full) is inventory, not an unaliased semantic defect"
  );
  assert.ok(
    !result.unaliased.some(row => row.name === "radius/md"),
    "standalone radius primitives are inventory, not unaliased semantic defects"
  );
  assert.ok(
    !result.unaliased.some(row => row.name === "border/width/default"),
    "standalone border width primitives are inventory, not unaliased semantic defects"
  );
  assert.strictEqual(result.summary.collectionNamingIssues, 0, "numeric leaves and kebab path segments should not look like mixed naming");
  assert.strictEqual(result.summary.duplicateValueGroups, 0, "cross-ramp primitive coincidences should not be issue duplicates");
  assert.ok(result.summary.informationalDuplicateValueGroups >= 1, "cross-ramp primitive coincidences remain available as info");
}

{
  const partialSpacing = {
    collections: [{ id: "s", name: "4. Spacing", variableIds: ["v1"] }],
    variables: [{
      id: "v1",
      name: "space/stack/xl",
      resolvedType: "FLOAT",
      valuesByMode: {
        m1: { type: "VARIABLE_ALIAS", id: "p1" },
        m2: 40,
        m3: 48,
      },
    }],
  };
  const result = auditTokens(partialSpacing);
  assert.strictEqual(result.summary.unaliasedCount, 0, "not all modes raw — should not count as fully unaliased");
  assert.strictEqual(result.summary.partiallyUnaliasedCount, 1);
  assert.strictEqual(result.partiallyUnaliased[0].name, "space/stack/xl");
}

{
  const variables = [
    { id: "key-color", name: "color/shadow/key" },
    { id: "ambient-color", name: "color/shadow/ambient" },
    { id: "xs-offset", name: "elevation/xs/offset-y" },
    { id: "xs-radius", name: "elevation/xs/radius" },
    { id: "sm-offset", name: "elevation/sm/offset-y" },
    { id: "sm-radius", name: "elevation/sm/radius" },
    { id: "ambient-2-radius", name: "shadow/ambient/2/radius" },
  ];
  const effectStyles = [
    {
      id: "style-0",
      name: "elevation/0",
      effects: [],
    },
    {
      id: "style-1",
      name: "elevation/1",
      effects: [{
        type: "DROP_SHADOW",
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 1 },
        radius: 2,
        spread: 0,
        boundVariables: {
          color: ALIAS("key-color"),
        },
      }],
    },
    {
      id: "style-2",
      name: "elevation/2",
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 0, y: 4 },
          radius: 8,
          spread: 0,
          boundVariables: {
            color: ALIAS("key-color"),
            offsetY: ALIAS("sm-offset"),
            radius: ALIAS("sm-radius"),
          },
        },
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.08 },
          offset: { x: 0, y: 0 },
          radius: 8,
          spread: 0,
          boundVariables: {
            color: ALIAS("ambient-color"),
          },
        },
      ],
    },
    {
      id: "unrelated",
      name: "effects/focus-ring",
      effects: [{
        type: "DROP_SHADOW",
        offset: { x: 0, y: 0 },
        radius: 2,
      }],
    },
  ];

  const result = auditTokens({ variables, collections: [], effectStyles });
  assert.strictEqual(result.summary.rawEffectStyleBindingCount, 3);
  assert.deepStrictEqual(
    result.rawEffectStyleBindings.map(issue => [
      issue.styleName,
      issue.effectIndex,
      issue.property,
      issue.rawValue,
      issue.expectedVariable,
      issue.expectedVariableExists,
    ]),
    [
      ["elevation/1", 0, "offsetY", 1, "elevation/xs/offset-y", true],
      ["elevation/1", 0, "radius", 2, "elevation/xs/radius", true],
      ["elevation/2", 1, "radius", 8, "shadow/ambient/2/radius", true],
    ],
    "elevation styles should report raw key and ambient shadow properties while ignoring bound fields and unrelated styles"
  );
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
