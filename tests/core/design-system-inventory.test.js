const assert = require("assert");

const {
  designSystemInventory,
  emptyDesignSystemMessage,
  emptyDesignSystemPrompt,
} = require("../../packages/figlets-core/src/design-system-inventory.js");

{
  const inventory = designSystemInventory({});
  assert.strictEqual(inventory.isEmpty, true);
  assert.strictEqual(inventory.state, "empty-file");
  assert.strictEqual(inventory.designSystemArtifactCount, 0);
  assert.strictEqual(inventory.foundationCollectionCount, 0);
  assert.ok(emptyDesignSystemPrompt(inventory).includes("set up a new design-system foundation"));
  assert.ok(emptyDesignSystemMessage(inventory).includes("No variables or variable collections"));
}

{
  const inventory = designSystemInventory({
    collections: [{ name: "4. Spacing" }],
    variables: [],
    textStyles: [],
    effectStyles: [],
  });
  assert.strictEqual(inventory.isEmpty, true);
  assert.strictEqual(inventory.state, "empty-foundation-shell");
  assert.strictEqual(inventory.hasFoundationShell, true);
  assert.strictEqual(inventory.designSystemArtifactCount, 0);
  assert.strictEqual(inventory.foundationCollectionCount, 1);
  assert.ok(emptyDesignSystemPrompt(inventory).includes("foundation collections but no design-system variables"));
  assert.ok(emptyDesignSystemMessage(inventory).includes("Foundation collections exist"));
}

{
  const inventory = designSystemInventory({
    collections: [{ name: "Color" }],
    variables: [
      { name: "color/bg/default", resolvedType: "COLOR" },
      { name: "motion/duration/standard", resolvedType: "TIMING" },
      { name: "motion/easing/standard", resolvedType: "EASING" },
    ],
    textStyles: [],
    effectStyles: [],
    capabilities: {
      variableResolvedTypes: ["BOOLEAN", "COLOR", "EASING", "FLOAT", "STRING", "TIMING"],
    },
  });
  assert.strictEqual(inventory.isEmpty, false);
  assert.strictEqual(inventory.state, "has-token-artifacts");
  assert.strictEqual(inventory.designSystemArtifactCount, 3);
  assert.strictEqual(inventory.counts.variableTypes.COLOR, 1);
  assert.strictEqual(inventory.counts.variableTypes.TIMING, 1);
  assert.strictEqual(inventory.counts.variableTypes.EASING, 1);
  assert.deepStrictEqual(inventory.capabilities.variableResolvedTypes, ["BOOLEAN", "COLOR", "EASING", "FLOAT", "STRING", "TIMING"]);
  assert.strictEqual(emptyDesignSystemPrompt(inventory), null);
  assert.strictEqual(emptyDesignSystemMessage(inventory), null);
}

{
  const inventory = designSystemInventory({
    collections: [],
    variables: [],
    textStyles: [],
    effectStyles: [],
    paintStyles: [{ name: "Gradient/Brand" }],
  });
  assert.strictEqual(inventory.isEmpty, false);
  assert.strictEqual(inventory.state, "has-token-artifacts");
  assert.strictEqual(inventory.counts.paintStyles, 1);
  assert.strictEqual(inventory.designSystemArtifactCount, 1);
}
