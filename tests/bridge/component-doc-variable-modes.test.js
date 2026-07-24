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

const groupModes = new Function(
  extractFunction(code, "_docComparableVariableModeValue")
  + "\n"
  + extractFunction(code, "_docVariableChangesAcrossModes")
  + "\n"
  + extractFunction(code, "_docComponentVariableModeGroups")
  + "\nreturn _docComponentVariableModeGroups;"
)();

module.exports = (async () => {
  const buttonCollection = {
    id: "button-modes",
    name: "Button",
    defaultModeId: "primary",
    modes: [
      { modeId: "primary", name: "Primary" },
      { modeId: "secondary", name: "Secondary" },
      { modeId: "ghost", name: "Ghost" },
      { modeId: "danger", name: "Danger" },
    ],
  };
  const spacingCollection = {
    id: "spacing",
    name: "Spacing",
    defaultModeId: "desktop",
    modes: [{ modeId: "desktop", name: "Desktop" }],
  };
  const unrelatedButtonCollection = {
    id: "unrelated-button-modes",
    name: "Component / Button",
    defaultModeId: "primary",
    modes: [
      { modeId: "primary", name: "Primary" },
      { modeId: "secondary", name: "Secondary" },
      { modeId: "ghost", name: "Ghost" },
      { modeId: "danger", name: "Danger" },
    ],
  };
  const variables = {
    fill: {
      id: "fill",
      name: "button/container",
      variableCollectionId: "button-modes",
      valuesByMode: {
        primary: "#primary",
        secondary: "#secondary",
        ghost: "#ghost",
        danger: "#danger",
      },
    },
    label: {
      id: "label",
      name: "button/label",
      variableCollectionId: "button-modes",
      valuesByMode: {
        primary: "#light",
        secondary: "#dark",
        ghost: "#dark",
        danger: "#light",
      },
    },
    gap: {
      id: "gap",
      name: "space/component/button",
      variableCollectionId: "spacing",
      valuesByMode: { desktop: 12 },
    },
    unrelatedFocus: {
      id: "unrelatedFocus",
      name: "button/focus",
      variableCollectionId: "unrelated-button-modes",
      valuesByMode: {
        primary: "#focus",
        secondary: "#focus",
        ghost: "#focus",
        danger: "#focus",
      },
    },
  };
  const groups = groupModes(
    [
      { node: "Button", property: "Fill", varId: "fill" },
      { node: "Button", property: "Fill", varId: "fill" },
      { node: "Label", property: "Fill", varId: "label" },
      { node: "Button", property: "itemSpacing", varId: "gap" },
      { node: "Input Focused", property: "Effect DROP_SHADOW color", varId: "unrelatedFocus" },
    ],
    variables,
    {
      "button-modes": buttonCollection,
      spacing: spacingCollection,
      "unrelated-button-modes": unrelatedButtonCollection,
    }
  );

  assert.strictEqual(
    groups.length,
    1,
    "only bound multi-mode collections that actually change a visual value should become component mode groups"
  );
  assert.strictEqual(groups[0].collectionName, "Button");
  assert.deepStrictEqual(
    groups[0].modes.map(mode => mode.name),
    ["Primary", "Secondary", "Ghost", "Danger"]
  );
  assert.deepStrictEqual(
    groups[0].bindings.map(binding => `${binding.variableName}:${binding.node}:${binding.property}`),
    ["button/container:Button:Fill", "button/label:Label:Fill"],
    "mode facts should deduplicate identical bindings but preserve distinct visual bindings"
  );
  assert.ok(
    !groups.some(group => group.collectionName === "Component / Button"),
    "an invariant cross-component token such as button/focus must not create irrelevant mode previews"
  );

  assert.ok(
    code.includes("figma.variables.getVariableCollectionByIdAsync") &&
      code.includes("_allComponentRawBinds") &&
      code.includes("_docVariableChangesAcrossModes(") &&
      code.includes("_docComponentVariableModeGroups(") &&
      code.includes("_defaultV.resolvedVariableModes"),
    "component docs should discover local or remote multi-mode collections bound across the full component set"
  );

  assert.ok(
    code.includes("_mkLabel(doc, 'VARIABLE MODES')") &&
      code.includes("Section C · Variable Modes") &&
      code.includes("Variable Mode Collection · ") &&
      code.includes("Mode Visuals · ") &&
      code.includes("instance.setExplicitVariableModeForCollection(") &&
      code.includes("for (let variantIndex = 0; variantIndex < _children.length; variantIndex++)") &&
      code.includes("_mkComponentVisualPreview("),
    "the Figma spec sheet should render every component variant under every bound variable mode"
  );

  assert.ok(
    code.includes("## Variable Modes") &&
      code.includes("['Collection', 'Mode', 'Current', 'Bound token values', 'Figma spec preview']") &&
      code.includes("variable-modes: ") &&
      code.includes("variableModeCollectionCount") &&
      code.includes("variableModeCount") &&
      code.includes("variableModes: _variableModeGroups.map"),
    "Markdown, component metadata, and the embedded SPEC block should expose variable modes"
  );
})();
