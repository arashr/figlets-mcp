const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const codePath = path.join(repoRoot, "packages/figma-bridge-plugin/code.js");
const code = fs.readFileSync(codePath, "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  assert.ok(start !== -1, "Could not locate function " + name + " in code.js");
  let i = src.indexOf("{", start);
  assert.ok(i !== -1, "Malformed function " + name + " (no opening brace)");
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  assert.strictEqual(depth, 0, "Unbalanced braces while extracting " + name);
  return src.slice(start, i);
}

function publicNode(node) {
  return !String(node && node.name || "").startsWith("_");
}

const collectBindings = new Function(
  "figma",
  "effectStyleById",
  "_isDocPrivateNodeName",
  extractFunction(code, "_docFormatNumber")
    + "\n"
    + extractFunction(code, "_docColorSummary")
    + "\n"
    + extractFunction(code, "_docPaintStopSummary")
    + "\n"
    + extractFunction(code, "_docPaintOpacitySummary")
    + "\n"
    + extractFunction(code, "_docPaintDetailSummary")
    + "\n"
    + extractFunction(code, "_docPaintStackEntrySummary")
    + "\n"
    + extractFunction(code, "_docPaintVariableAlias")
    + "\n"
    + extractFunction(code, "_docPaintBindingRows")
    + "\n"
    + extractFunction(code, "_docIsNestedComponentInstance")
    + "\n"
    + extractFunction(code, "_collectEffectBindRows")
    + "\n"
    + extractFunction(code, "_collectBind")
    + "\nreturn _collectBind;"
)({ mixed: Symbol("mixed") }, {}, node => !publicNode(node));

const collectSlots = new Function(
  "_isDocPrivateNodeName",
  "_componentNameByKey",
  extractFunction(code, "_docIsNestedComponentInstance")
    + "\n"
    + extractFunction(code, "_cleanComponentPropertyName")
    + "\n"
    + extractFunction(code, "_slotPreferredValuesSummary")
    + "\n"
    + extractFunction(code, "_slotSettingsSummary")
    + "\n"
    + extractFunction(code, "_slotNodePropertyKey")
    + "\n"
    + extractFunction(code, "_slotChildSummary")
    + "\n"
    + extractFunction(code, "_collectSlotDocs")
    + "\nreturn _collectSlotDocs;"
)(node => !publicNode(node), { "menu-item-key": "Menu Item" });

module.exports = (async () => {
  const bindings = collectBindings({
    type: "COMPONENT",
    name: "Dropdown",
    children: [
      {
        type: "FRAME",
        name: "Menu",
        boundVariables: { fills: { id: "dropdown-surface" } },
        children: [],
      },
      {
        type: "INSTANCE",
        name: "Trigger",
        boundVariables: { fills: { id: "input-bg" } },
        children: [
          {
            type: "TEXT",
            name: "Input label",
            boundVariables: { fills: { id: "input-label" } },
            children: [],
          },
        ],
      },
      {
        type: "SLOT",
        name: "Items",
        boundVariables: { paddingTop: { id: "dropdown-slot-padding" } },
        children: [
          {
            type: "INSTANCE",
            name: "Menu Item",
            boundVariables: { fills: { id: "menu-item-bg" } },
            children: [],
          },
        ],
      },
    ],
  }, []);

  assert.deepStrictEqual(
    bindings.map(row => row.varId),
    ["dropdown-surface", "dropdown-slot-padding"],
    "parent documentation should keep parent-owned bindings but exclude bindings inherited through nested component instances"
  );

  const propertyDefinitions = {
    "Items#66:1": {
      type: "SLOT",
      description: "Dropdown options",
      preferredValues: [{ type: "COMPONENT", key: "menu-item-key" }],
      slotSettings: { minChildren: 1, maxChildren: 8, stretchChildOnInsert: true },
    },
  };
  const slots = collectSlots([
    {
      type: "COMPONENT",
      name: "State=Idle",
      children: [
        {
          type: "INSTANCE",
          name: "Trigger",
          children: [
            { type: "SLOT", name: "Leading Icon", children: [] },
            { type: "SLOT", name: "Trailing Icon", children: [] },
          ],
        },
      ],
    },
    {
      type: "COMPONENT",
      name: "State=Open",
      children: [
        {
          type: "SLOT",
          name: "Items",
          componentPropertyReferences: { slot: "Items#66:1" },
          limitViolations: [],
          children: [{ type: "INSTANCE", name: "Menu Item", children: [] }],
        },
      ],
    },
    {
      type: "COMPONENT",
      name: "State=Another Open",
      children: [
        {
          type: "SLOT",
          name: "Items",
          componentPropertyReferences: { slot: "Items#66:1" },
          limitViolations: [],
          children: [{ type: "INSTANCE", name: "Menu Item", children: [] }],
        },
      ],
    },
  ], propertyDefinitions);

  assert.strictEqual(slots.length, 1, "parent slots should be deduplicated across variants");
  assert.strictEqual(slots[0].name, "Items");
  assert.strictEqual(slots[0].defaultContent, "Menu Item (INSTANCE)");
  assert.strictEqual(slots[0].preferredValues, "COMPONENT: Menu Item");
  assert.strictEqual(slots[0].slotSettings.maxChildren, 8);
  assert.ok(
    !slots.some(slot => slot.name === "Leading Icon" || slot.name === "Trailing Icon"),
    "slots owned by a nested Input instance must not leak into Dropdown documentation"
  );

  assert.ok(
    code.includes("const _slotDocs = _collectSlotDocs(_children, compMeta.componentPropertyDefinitions);")
      && code.includes("if (_docIsNestedComponentInstance(node)) return;"),
    "slot and conditional-property discovery should use the shared nested-instance ownership boundary"
  );
})();
