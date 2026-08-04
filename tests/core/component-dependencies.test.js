const assert = require("assert");

const { inspectComponentData } = require("../../packages/figlets-core/src/inspect-component.js");
const {
  collectComponentDependencies,
} = require("../../packages/figlets-core/src/component-dependencies.js");

// Components without instances keep the existing inspection response unchanged.
{
  const result = inspectComponentData({
    selection: [{ id: "1:1", type: "COMPONENT", name: "Badge", children: [] }],
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "nestedComponents"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "nestedComponentSummary"), false);
}

// Nested dependencies are deduplicated, leaf-first, and annotated from existing specs.
{
  const result = inspectComponentData({
    selection: [{
      id: "1:1",
      componentKey: "product-card-set",
      type: "COMPONENT_SET",
      name: "Product Card",
      children: [{
        id: "1:2",
        componentKey: "product-card-default",
        type: "COMPONENT",
        name: "State=Default",
        children: [{
          id: "2:1",
          type: "INSTANCE",
          name: "Card content",
          mainComponent: {
            id: "20:2",
            key: "card-default",
            name: "State=Default",
            remote: false,
            componentSet: { id: "20:1", key: "card", name: "Card", remote: false },
          },
          children: [
            {
              id: "3:1",
              type: "INSTANCE",
              name: "Leading icon",
              mainComponent: {
                id: "30:2",
                key: "icon-small",
                name: "Size=Small",
                remote: false,
                componentSet: { id: "30:1", key: "icon", name: "Icon", remote: false },
              },
              children: [],
            },
            {
              id: "3:2",
              type: "INSTANCE",
              name: "Trailing icon",
              mainComponent: {
                id: "30:3",
                key: "icon-large",
                name: "Size=Large",
                remote: false,
                componentSet: { id: "30:1", key: "icon", name: "Icon", remote: false },
              },
              children: [],
            },
          ],
        }],
      }],
    }],
    componentSpecs: [{ name: "Icon", path: "component-specs/Icon.md" }],
  });

  assert.deepStrictEqual(result.nestedComponents.map(item => item.componentName), ["Icon", "Card"]);
  assert.strictEqual(result.nestedComponents[0].relationship, "Nested dependency");
  assert.strictEqual(result.nestedComponents[0].documented, true);
  assert.strictEqual(result.nestedComponents[0].specPath, "component-specs/Icon.md");
  assert.strictEqual(result.nestedComponents[0].documentationLabel, "Existing Figlets spec");
  assert.deepStrictEqual(result.nestedComponents[0].viaComponentNames, ["Card"]);
  assert.strictEqual(result.nestedComponents[0].locations.length, 2);
  assert.strictEqual(result.nestedComponents[1].relationship, "Direct dependency");
  assert.strictEqual(result.nestedComponents[1].documented, false);
  assert.strictEqual(result.nestedComponents[1].documentationLabel, "No standalone Figlets spec");
  assert.deepStrictEqual(result.nestedComponents[1].viaComponentNames, []);
  assert.deepStrictEqual(result.nestedComponentSummary, {
    count: 2,
    documentedCount: 1,
    missingCount: 1,
    cycles: [],
    truncated: false,
    requiresDesignerChoice: true,
    message: "This component uses 2 nested components. 1 already has a Figlets spec; 1 has no standalone Figlets spec.",
  });
}

// A component that points back to the documented root is reported and never traversed recursively.
{
  const result = collectComponentDependencies({
    id: "1:1",
    componentKey: "recursive-card",
    type: "COMPONENT",
    name: "Recursive Card",
    children: [{
      id: "2:1",
      type: "INSTANCE",
      name: "Recursive Card",
      mainComponent: { id: "1:1", key: "recursive-card", name: "Recursive Card" },
      children: [],
    }],
  });
  assert.deepStrictEqual(result.dependencies, []);
  assert.strictEqual(result.cycles.length, 1);
  assert.strictEqual(result.truncated, false);

  const inspection = inspectComponentData({
    selection: [{
      id: "1:1",
      componentKey: "recursive-card",
      type: "COMPONENT",
      name: "Recursive Card",
      children: [{
        id: "2:1",
        type: "INSTANCE",
        name: "Recursive Card",
        mainComponent: { id: "1:1", key: "recursive-card", name: "Recursive Card" },
        children: [],
      }],
    }],
  });
  assert.strictEqual(inspection.nestedComponentSummary.requiresDesignerChoice, true);
  assert.strictEqual(inspection.nestedComponentSummary.cycles.length, 1);
}

// Safety limits stop large trees without turning the traversal into an open-ended loop.
{
  const result = collectComponentDependencies({
    id: "1:1",
    type: "COMPONENT",
    name: "Toolbar",
    children: [
      { id: "2:1", type: "INSTANCE", name: "Button", mainComponent: { key: "button", name: "Button" } },
      { id: "2:2", type: "INSTANCE", name: "Icon", mainComponent: { key: "icon", name: "Icon" } },
    ],
  }, { maxDependencies: 1 });
  assert.strictEqual(result.dependencies.length, 1);
  assert.strictEqual(result.truncated, true);
}
