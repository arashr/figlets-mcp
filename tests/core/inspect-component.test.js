const assert = require("assert");
const { inspectComponentData } = require("../../packages/figlets-core/src/inspect-component.js");

{
  const mockFigmaSelection = {
    selection: [
      {
        id: "1:1",
        type: "COMPONENT_SET",
        name: "Button",
        description: "Primary button",
        componentPropertyDefinitions: {
          "Size": { type: "VARIANT", defaultValue: "Medium", variantOptions: ["Small", "Medium", "Large"] }
        },
        layoutMode: "HORIZONTAL",
        padding: { top: 10, bottom: 10, left: 20, right: 20 },
        itemSpacing: 8,
        children: [
          { id: "1:2", name: "Text", type: "TEXT" }
        ]
      }
    ]
  };

  // Test 1: Successful parsing
  const result1 = inspectComponentData(mockFigmaSelection);
  assert.strictEqual(result1.selectedNodesCount, 1);
  assert.strictEqual(result1.selection[0].name, "Button");
  assert.strictEqual(result1.selection[0].description, "Primary button");
  assert.strictEqual(result1.selection[0].autoLayout.mode, "HORIZONTAL");
  assert.strictEqual(result1.selection[0].autoLayout.padding.top, 10);
  assert.strictEqual(result1.selection[0].children.length, 1);
  assert.strictEqual(result1.selection[0].componentPropertyDefinitions["Size"].variantOptions.length, 3);

  // Test 2: Empty selection
  const result2 = inspectComponentData({ selection: [] });
  assert.strictEqual(result2.error, "No nodes are currently selected in Figma.");
}
