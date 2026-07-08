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

const helperNames = [
  "_docFormatNumber",
  "_docVisibleEffectCount",
  "_docColorSummary",
  "_docEffectDetailSummary",
  "_docEffectsDetailSummary",
  "_docEffectSummary",
];

const helpers = new Function(
  helperNames.map(name => extractFunction(code, name)).join("\n") +
    "\nreturn { _docColorSummary, _docEffectSummary };"
)();

module.exports = (async () => {
  const style = {
    id: "effect-hover",
    name: "elevation/4",
    effects: [
      {
        type: "DROP_SHADOW",
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.16 },
        offset: { x: 0, y: 4 },
        radius: 12,
        spread: 0,
      },
      {
        type: "DROP_SHADOW",
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 0 },
        radius: 20,
        spread: 0,
      },
    ],
  };
  assert.strictEqual(helpers._docColorSummary({ r: 0, g: 0, b: 0, a: 0.16 }), "rgba(0, 0, 0, 0.16)");
  assert.strictEqual(
    helpers._docEffectSummary({ effectStyleId: "effect-hover" }, { "effect-hover": style }),
    "Effect style: elevation/4; DROP_SHADOW color rgba(0, 0, 0, 0.16), alpha 0.16, offset-x 0px, offset-y 4px, blur 12px, spread 0px | DROP_SHADOW color rgba(0, 0, 0, 0.1), alpha 0.1, offset-x 0px, offset-y 0px, blur 20px, spread 0px",
    "effect summaries should preserve shadow alpha and zero offset-y values from Figma"
  );

  assert.ok(
    code.includes("const _allEffectStyles = _ds.effectStyles || [];") &&
      code.includes("const effectStyleById = {};") &&
      code.includes("node.effectStyleId") &&
      code.includes("property: 'Effect style'") &&
      code.includes("effect.boundVariables") &&
      code.includes("_collectEffectBindRows(effectStyleById[node.effectStyleId].effects"),
    "component docs should collect effect style references and effect variable bindings"
  );

  assert.ok(
    code.includes("const _variantChangeRows = [];") &&
      code.includes("_rootVisualState(variant)") &&
      code.includes("_resolveBindingRows(_collectBind(variant, []))") &&
      code.includes("### Variant changes") &&
      code.includes("['Variant', 'Target', 'Property', 'Value', 'Default']"),
    "component docs should include Figma-backed per-variant visual/token deltas"
  );

  assert.ok(
    code.includes("const _interactionRows = [];") &&
      code.includes("Array.isArray(node.reactions)") &&
      code.includes("### Prototype interactions") &&
      code.includes("['Variant', 'Element', 'Trigger', 'Action', 'Transition']"),
    "component docs should include Figma prototype reactions when they exist"
  );

  assert.ok(
    code.includes("['Node', 'Property', 'Token', 'Collection / Modes', 'Resolved Value']") &&
      code.includes("_resolvedVariableValueSummary") &&
      code.includes("_variableContext(b.varId)") &&
      code.includes("mode.name + ': ' + val") &&
      code.includes("breakpoint pixel thresholds"),
    "token binding docs should include collection/mode context, per-mode resolved values, and avoid inventing breakpoint widths"
  );

  assert.ok(
    code.includes("['Slot', 'Min', 'Max', 'Preferred Only', 'Stretch Child', 'Preferred Values', 'Default Content', 'Limit Violations']") &&
      code.includes("settings.allowPreferredValuesOnly ? 'Yes' : 'No'") &&
      code.includes("settings.stretchChildOnInsert ? 'Yes' : 'No'"),
    "slot docs should expose concrete Figma slot enforcement and stretch flags"
  );

  assert.ok(
    code.includes("description: d.description || ''"),
    "component property descriptions should be copied from Figma when present"
  );

  assert.ok(
    !code.includes("<article>") &&
      !code.includes("object-fit") &&
      !code.includes("card__"),
    "component docs should not invent semantic HTML, CSS properties, or class names"
  );
})();
