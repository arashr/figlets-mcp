const assert = require("assert");
const {
  analyzeCollections,
  analyzeDesignSystemData,
  buildDesignSystemContext,
  resolveVariableValue,
  toHex
} = require("../../packages/figlets-core/src/analyze-design-system.js");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

{
  const variablesById = new Map(exampleFigmaData.variables.map(variable => [variable.id, variable]));
  assert.strictEqual(resolveVariableValue(variablesById.get("v1"), variablesById).r, 0.231);
  assert.strictEqual(resolveVariableValue(variablesById.get("v4"), variablesById).r, 0.231);
  assert.strictEqual(resolveVariableValue(variablesById.get("v5"), variablesById), 16);
}

{
  assert.strictEqual(toHex({ r: 0.231, g: 0.51, b: 0.964 }), "#3b82f6");
}

{
  const collections = analyzeCollections(exampleFigmaData.variables, exampleFigmaData.collections);
  assert.strictEqual(collections.length, 2);
  assert.strictEqual(collections[0].name, "Primitives");
  assert.strictEqual(collections[0].isPrimitive, true);
  assert.strictEqual(collections[1].name, "Semantics");
  assert.strictEqual(collections[1].isAlias, true);
  assert.strictEqual(collections[1].crossAliasCount, 2);
  assert.deepStrictEqual(collections[0].topLevelGroups, ["color", "space", "typography"]);
}

{
  const context = buildDesignSystemContext(
    exampleFigmaData.variables,
    exampleFigmaData.collections,
    exampleFigmaData.textStyles,
    exampleFigmaData.effectStyles
  );

  assert.strictEqual(context.counts.variables, 5);
  assert.strictEqual(context.typographyStrategy, "text-styles");
  assert.strictEqual(context.indexes.colorVarByHex["#3b82f6"].name, "color/brand/500");
  assert.strictEqual(context.indexes.spacingVarByValue[16].name, "spacing/component/md");
}

{
  const analyzed = analyzeDesignSystemData(clone(exampleFigmaData));
  assert.strictEqual(analyzed.target, "fixture-file");
  assert.strictEqual(analyzed.collections.length, 2);
  assert.strictEqual(analyzed.context.keys.collections[1], "Semantics");
}
