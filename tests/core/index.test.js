const assert = require("assert");
const {
  detectDesignSystem,
  detectDesignSystemFromFigmaData,
  normalizeDesignSystemSnapshot,
  summarizeDesignSystem,
  variableBinding
} = require("../../packages/figlets-core/src/index.js");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");

{
  assert.strictEqual(typeof variableBinding.pickFloatVariableByValue, "function");
}

{
  const snapshot = normalizeDesignSystemSnapshot({});
  assert.strictEqual(snapshot.target, "unknown");
  assert.deepStrictEqual(snapshot.collections, []);
}

{
  const summary = summarizeDesignSystem({
    collections: [{ colorVarCount: 1, floatVarCount: 0 }],
    textStyles: [],
    effectStyles: [],
    paintStyles: [{ name: "Gradient/Brand" }]
  });

  assert.strictEqual(summary.collections, 1);
  assert.strictEqual(summary.paintStyles, 1);
  assert.strictEqual(summary.capabilities.hasPaintStyles, true);
  assert.strictEqual(summary.capabilities.hasVariables, true);
  assert.strictEqual(summary.capabilities.canAuditTokens, true);
}

{
  const detected = detectDesignSystem({
    target: "snapshot-target",
    collections: [{ colorVarCount: 0, floatVarCount: 2 }],
    textStyles: [],
    effectStyles: []
  });

  assert.strictEqual(detected.target, "snapshot-target");
  assert.strictEqual(detected.summary.capabilities.hasFloatVariables, true);
}

{
  const detected = detectDesignSystemFromFigmaData({
    target: "figma-target",
    source: "fixture",
    figmaData: "ignored",
    variables: exampleFigmaData.variables,
    collections: exampleFigmaData.collections,
    textStyles: exampleFigmaData.textStyles,
    effectStyles: exampleFigmaData.effectStyles,
    paintStyles: [{ name: "Gradient/Brand" }]
  });

  assert.strictEqual(detected.target, "figma-target");
  assert.strictEqual(detected.source, "fixture");
  assert.strictEqual(detected.summary.collections, 2);
  assert.deepStrictEqual(detected.snapshot.context.keys.paintStyles, ["Gradient/Brand"]);
}
