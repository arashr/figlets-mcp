const assert = require("assert");
const {
  SEMANTIC_ALIAS_REPAIR_MODEL,
  isSpacingSemanticTokenName,
  mergedSpacingSemantic,
  planSpacingSemanticAliasRepairs,
  resolvePrimitiveAliasTarget,
  buildPrimitiveSpacingLookup,
  withEffectiveSpacingSemantic,
} = require("../../packages/figlets-mcp-server/src/tools/semantic-alias-repair.js");

const DS = {
  collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
  spacing: {
    semantic: {
      "layout/lg": [48, 64, 96],
      "touch/comfortable": [48, 48, 40],
    },
  },
};

function stepPrimitiveSnapshot() {
  return {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p05", "p12", "p16", "p24", "p32", "p40"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-lg", "touch-comfortable", "component-md"],
        modes: [
          { modeId: "mobile", name: "Mobile" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
    ],
    variables: [
      { id: "p05", name: "space/0-5", resolvedType: "FLOAT", valuesByMode: { default: 2 } },
      { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
      { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
      { id: "p32", name: "space/32", resolvedType: "FLOAT", valuesByMode: { default: 128 } },
      { id: "p40", name: "space/40", resolvedType: "FLOAT", valuesByMode: { default: 40 } },
      {
        id: "layout-lg",
        name: "space/layout/lg",
        resolvedType: "FLOAT",
        valuesByMode: { mobile: 48, tablet: 64, desktop: 96 },
      },
      {
        id: "touch-comfortable",
        name: "space/touch/comfortable",
        resolvedType: "FLOAT",
        valuesByMode: { mobile: 48, tablet: 48, desktop: 40 },
      },
    ],
  };
}

module.exports = (() => {
  assert.ok(SEMANTIC_ALIAS_REPAIR_MODEL.primitiveLookup.includes("float"));
  assert.strictEqual(isSpacingSemanticTokenName("space/layout/lg"), true);
  assert.strictEqual(isSpacingSemanticTokenName("space/12"), false);

  const snapshot = stepPrimitiveSnapshot();
  const variableMap = new Map(snapshot.variables.map(item => [item.name, item]));
  const lookup = buildPrimitiveSpacingLookup(snapshot, "1. Primitives");
  assert.deepStrictEqual(resolvePrimitiveAliasTarget(lookup, 2), { id: "p05", name: "space/0-5" });
  assert.deepStrictEqual(resolvePrimitiveAliasTarget(lookup, 48), { id: "p12", name: "space/12" });
  assert.deepStrictEqual(resolvePrimitiveAliasTarget(lookup, 64), { id: "p16", name: "space/16" });
  assert.deepStrictEqual(resolvePrimitiveAliasTarget(lookup, 96), { id: "p24", name: "space/24" });

  const stepScaleConflictSnapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p12", "p48"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-lg"],
        modes: [
          { modeId: "mobile", name: "Mobile" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
    ],
    variables: [
      { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      { id: "p48", name: "space/48", resolvedType: "FLOAT", valuesByMode: { default: 192 } },
      {
        id: "layout-lg",
        name: "space/layout/lg",
        resolvedType: "FLOAT",
        valuesByMode: { mobile: 48, tablet: 48, desktop: 48 },
      },
    ],
  };
  const conflictLookup = buildPrimitiveSpacingLookup(stepScaleConflictSnapshot, "1. Primitives");
  assert.deepStrictEqual(
    resolvePrimitiveAliasTarget(conflictLookup, 48),
    { id: "p12", name: "space/12" },
    "raw 48 must alias to step-scale space/12=48, not pixel-named space/48=192"
  );
  const conflictPlan = planSpacingSemanticAliasRepairs(
    { collections: { primitives: "1. Primitives", spacing: "4. Spacing" }, spacing: { semantic: { "layout/lg": [48, 48, 48] } } },
    stepScaleConflictSnapshot,
    new Map(stepScaleConflictSnapshot.variables.map(item => [item.name, item]))
  );
  const conflictRepair = conflictPlan.repairs.find(item => item.name === "space/layout/lg");
  assert.ok(conflictRepair, "step-scale conflict should still produce alias repairs");
  assert.ok(
    conflictRepair.updates.every(update => update.toAliasName === "space/12"),
    "all modes with raw 48 must plan alias to space/12, not space/48"
  );

  const legacyPixelNamedSnapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p48"],
        modes: [{ modeId: "default", name: "Default" }],
      },
    ],
    variables: [
      { id: "p48", name: "space/48", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
    ],
  };
  const legacyLookup = buildPrimitiveSpacingLookup(legacyPixelNamedSnapshot, "1. Primitives");
  assert.deepStrictEqual(
    resolvePrimitiveAliasTarget(legacyLookup, 48),
    { id: "p48", name: "space/48" },
    "legacy pixel-named primitive should still resolve when no value match exists"
  );

  const plan = planSpacingSemanticAliasRepairs(DS, snapshot, variableMap);
  assert.strictEqual(plan.repairs.length, 2);
  const layout = plan.repairs.find(item => item.name === "space/layout/lg");
  assert.ok(layout.updates.some(update => update.toAliasName === "space/12" && update.modeName === "Mobile"));
  assert.ok(layout.updates.some(update => update.toAliasName === "space/16" && update.modeName === "Tablet"));
  assert.ok(layout.updates.some(update => update.toAliasName === "space/24" && update.modeName === "Desktop"));

  const bootstrapDs = {
    collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
    spacing: {},
    figlets: { source: "figma-snapshot-bootstrap" },
  };
  const merged = mergedSpacingSemantic(bootstrapDs, snapshot, variableMap);
  assert.strictEqual(merged.source, "figma-snapshot-inference");
  assert.ok(merged.semantic["layout/lg"]);
  const effective = withEffectiveSpacingSemantic(bootstrapDs, snapshot, variableMap);
  const bootstrapPlan = planSpacingSemanticAliasRepairs(bootstrapDs, snapshot, variableMap, {
    effectiveDs: effective.ds,
    spacingSemanticMeta: effective.spacingSemanticMeta,
  });
  assert.strictEqual(bootstrapPlan.spacingSemanticSource, "figma-snapshot-inference");
  assert.ok(bootstrapPlan.repairs.some(item => item.name === "space/layout/lg"));

  const defaultOnlySnapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p12", "p16", "p24"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-lg"],
        modes: [{ modeId: "default", name: "Default" }],
      },
    ],
    variables: [
      { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
      { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
      {
        id: "layout-lg",
        name: "space/layout/lg",
        resolvedType: "FLOAT",
        valuesByMode: { default: 48 },
      },
    ],
  };
  const defaultOnlyPlan = planSpacingSemanticAliasRepairs(
    DS,
    defaultOnlySnapshot,
    new Map(defaultOnlySnapshot.variables.map(item => [item.name, item]))
  );
  assert.deepStrictEqual(defaultOnlyPlan.missingResponsiveModes, ["Mobile", "Tablet", "Desktop"]);

  const partialModesSnapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p32", "p40", "p48"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["stack-xl"],
        modes: [
          { modeId: "mobile", name: "Mobile" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
    ],
    variables: [
      { id: "p32", name: "space/32", resolvedType: "FLOAT", valuesByMode: { default: 32 } },
      { id: "p40", name: "space/40", resolvedType: "FLOAT", valuesByMode: { default: 40 } },
      { id: "p48", name: "space/48", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      {
        id: "stack-xl",
        name: "space/stack/xl",
        resolvedType: "FLOAT",
        valuesByMode: {
          mobile: { type: "VARIABLE_ALIAS", id: "p32" },
          tablet: 40,
          desktop: 48,
        },
      },
    ],
  };
  const partialPlan = planSpacingSemanticAliasRepairs(
    { collections: { primitives: "1. Primitives", spacing: "4. Spacing" }, spacing: { semantic: {} } },
    partialModesSnapshot,
    new Map(partialModesSnapshot.variables.map(item => [item.name, item]))
  );
  const stackRepair = partialPlan.repairs.find(item => item.name === "space/stack/xl");
  assert.ok(stackRepair, "partially aliased token should still be planned");
  assert.ok(stackRepair.updates.some(update => update.modeName === "Tablet"));
  assert.ok(stackRepair.updates.some(update => update.modeName === "Desktop"));
  assert.ok(!stackRepair.updates.some(update => update.modeName === "Mobile"));

  const pixelNamedHealthy = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p24", "p32", "p48"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-sm"],
        modes: [
          { modeId: "mobile", name: "Mobile" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
    ],
    variables: [
      { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 24 } },
      { id: "p32", name: "space/32", resolvedType: "FLOAT", valuesByMode: { default: 32 } },
      { id: "p48", name: "space/48", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      {
        id: "layout-sm",
        name: "space/layout/sm",
        resolvedType: "FLOAT",
        valuesByMode: {
          mobile: { type: "VARIABLE_ALIAS", id: "p24" },
          tablet: { type: "VARIABLE_ALIAS", id: "p32" },
          desktop: { type: "VARIABLE_ALIAS", id: "p48" },
        },
      },
    ],
  };
  const healthyPlan = planSpacingSemanticAliasRepairs(
    Object.assign({}, DS, { spacing: { semantic: { "layout/sm": [24, 32, 48] } } }),
    pixelNamedHealthy,
    new Map(pixelNamedHealthy.variables.map(item => [item.name, item]))
  );
  assert.strictEqual(healthyPlan.repairs.length, 0);
  assert.strictEqual(healthyPlan.missingPrimitives.length, 0);
  assert.ok(
    healthyPlan.alreadyAliasedHealthy.some(item => item.name === "space/layout/sm"),
    "pixel-named primitive aliases with correct values should not be missing-primitive gaps"
  );

  const allAliasedBootstrapSnapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p12", "p16", "p24"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-lg"],
        modes: [
          { modeId: "mobile", name: "Mobile" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
    ],
    variables: [
      { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
      { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
      {
        id: "layout-lg",
        name: "space/layout/lg",
        resolvedType: "FLOAT",
        valuesByMode: {
          mobile: { type: "VARIABLE_ALIAS", id: "p12" },
          tablet: { type: "VARIABLE_ALIAS", id: "p16" },
          desktop: { type: "VARIABLE_ALIAS", id: "p24" },
        },
      },
    ],
  };
  const bootstrapAliasedEffective = withEffectiveSpacingSemantic(
    bootstrapDs,
    allAliasedBootstrapSnapshot,
    new Map(allAliasedBootstrapSnapshot.variables.map(item => [item.name, item]))
  );
  assert.strictEqual(bootstrapAliasedEffective.spacingSemanticMeta.source, "figma-snapshot-resolved");
  const bootstrapAliasedPlan = planSpacingSemanticAliasRepairs(
    bootstrapDs,
    allAliasedBootstrapSnapshot,
    new Map(allAliasedBootstrapSnapshot.variables.map(item => [item.name, item])),
    {
      effectiveDs: bootstrapAliasedEffective.ds,
      spacingSemanticMeta: bootstrapAliasedEffective.spacingSemanticMeta,
    }
  );
  assert.strictEqual(bootstrapAliasedPlan.spacingSemanticSource, "figma-snapshot-resolved");
  assert.strictEqual(bootstrapAliasedPlan.repairs.length, 0);
  assert.strictEqual(bootstrapAliasedPlan.missingPrimitives.length, 0);
  assert.ok(
    bootstrapAliasedPlan.alreadyAliasedHealthy.some(item => item.name === "space/layout/lg"),
    "bootstrap file with only aliased semantics should not report missing primitives"
  );

  const duplicatedResponsiveSnapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p12"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-lg"],
        modes: [
          { modeId: "mobile", name: "Mobile" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
    ],
    variables: [
      { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      {
        id: "layout-lg",
        name: "space/layout/lg",
        resolvedType: "FLOAT",
        valuesByMode: {
          mobile: { type: "VARIABLE_ALIAS", id: "p12" },
          tablet: { type: "VARIABLE_ALIAS", id: "p12" },
          desktop: { type: "VARIABLE_ALIAS", id: "p12" },
        },
      },
    ],
  };
  const duplicatedPlan = planSpacingSemanticAliasRepairs(
    Object.assign({}, bootstrapDs, { spacing: { semantic: { "layout/lg": [48, 48, 48] } } }),
    duplicatedResponsiveSnapshot,
    new Map(duplicatedResponsiveSnapshot.variables.map(item => [item.name, item]))
  );
  assert.strictEqual(duplicatedPlan.repairs.length, 0);
  assert.strictEqual(duplicatedPlan.unvalidatedDuplicatedResponsiveModeValues.length, 1);
  assert.strictEqual(duplicatedPlan.unvalidatedDuplicatedResponsiveModeValues[0].name, "space/layout/lg");
  assert.strictEqual(duplicatedPlan.unvalidatedDuplicatedResponsiveModeValues[0].allModesSame, true);
  assert.deepStrictEqual(
    duplicatedPlan.unvalidatedDuplicatedResponsiveModeValues[0].duplicatedModes.map(mode => mode.modeName),
    ["Tablet", "Desktop"],
    "duplicated responsive values should be reported as designer-validation advisories"
  );

  const explicitlyAllowedDuplicatedPlan = planSpacingSemanticAliasRepairs(
    Object.assign({}, bootstrapDs, {
      spacing: {
        semantic: { "layout/lg": [48, 48, 48] },
        responsiveModeValidation: { allowSameValueModes: ["space/layout/lg"] },
      },
    }),
    duplicatedResponsiveSnapshot,
    new Map(duplicatedResponsiveSnapshot.variables.map(item => [item.name, item]))
  );
  assert.strictEqual(
    explicitlyAllowedDuplicatedPlan.unvalidatedDuplicatedResponsiveModeValues.length,
    0,
    "explicit config allowance should suppress same-value responsive mode advisories"
  );

  const wrongAliasSnapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p4", "p16"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-xs"],
        modes: [{ modeId: "mobile", name: "Mobile" }],
      },
    ],
    variables: [
      { id: "p4", name: "space/4", resolvedType: "FLOAT", valuesByMode: { default: 16 } },
      { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
      {
        id: "layout-xs",
        name: "space/layout/xs",
        resolvedType: "FLOAT",
        valuesByMode: {
          mobile: { type: "VARIABLE_ALIAS", id: "p16" },
        },
      },
    ],
  };
  const wrongAliasPlan = planSpacingSemanticAliasRepairs(
    Object.assign({}, DS, { spacing: { semantic: { "layout/xs": [16, 24, 32] } } }),
    wrongAliasSnapshot,
    new Map(wrongAliasSnapshot.variables.map(item => [item.name, item]))
  );
  const wrongAliasRepair = wrongAliasPlan.repairs.find(item => item.name === "space/layout/xs");
  assert.ok(wrongAliasRepair, "semantic spacing alias repair should retarget wrong primitive aliases");
  assert.strictEqual(wrongAliasRepair.updates.length, 1);
  assert.strictEqual(wrongAliasRepair.updates[0].modeName, "Mobile");
  assert.strictEqual(wrongAliasRepair.updates[0].toAliasName, "space/4");
  assert.strictEqual(wrongAliasRepair.updates[0].currentResolved, 64);

  const driftSnapshot = Object.assign({}, snapshot, {
    variables: snapshot.variables.map(item => {
      if (item.name !== "space/layout/lg") return item;
      return Object.assign({}, item, {
        valuesByMode: { mobile: 48, tablet: 24, desktop: 96 },
      });
    }),
  });
  const driftPlan = planSpacingSemanticAliasRepairs(
    DS,
    driftSnapshot,
    new Map(driftSnapshot.variables.map(item => [item.name, item]))
  );
  assert.ok(
    !driftPlan.configDrift.some(item => item.name === "space/layout/lg"),
    "raw drift with a matching primitive should become an exact alias repair"
  );
  const driftRepair = driftPlan.repairs.find(item => item.name === "space/layout/lg");
  assert.ok(driftRepair, "drifted raw spacing should be repairable when the expected primitive exists");
  assert.ok(
    driftRepair.updates.some(update => update.modeName === "Tablet" && update.toAliasName === "space/16"),
    "drifted Tablet value should be repaired directly to the expected primitive alias"
  );
})();
