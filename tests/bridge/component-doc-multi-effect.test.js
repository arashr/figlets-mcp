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

const effectHelpers = [
  "_docFormatNumber",
  "_docColorSummary",
  "_docEffectDetailSummary",
  "_docEffectStackEntrySummary",
  "_docEffectStackSummary",
  "_docVisibleEffectCount",
  "_docEffectsDetailSummary",
  "_docEffectSummary",
  "_collectEffectBindRows",
].map(name => extractFunction(code, name)).join("\n");

const helpers = new Function(
  effectHelpers
    + "\nreturn { stack: _docEffectStackSummary, summary: _docEffectSummary, bindings: _collectEffectBindRows };"
)();

module.exports = (async () => {
  const effects = [
    {
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      offset: { x: 0, y: 1 },
      radius: 2,
      spread: 0,
      boundVariables: {
        color: { id: "shadow-key" },
        radius: { id: "shadow-radius" },
        offsetY: { id: "shadow-offset-y" },
      },
    },
    {
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 0.36, g: 0.51, b: 0.15, a: 1 },
      offset: { x: 0, y: 0 },
      radius: 0,
      spread: 4,
      boundVariables: { color: { id: "focus-ring" } },
    },
    {
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 1, g: 1, b: 1, a: 1 },
      offset: { x: 0, y: 0 },
      radius: 0,
      spread: 2,
    },
  ];

  const stack = helpers.stack(effects);
  assert.ok(
    stack.includes("Figma effect 1/3: DROP_SHADOW color rgba(0, 0, 0, 0.2)")
      && stack.includes("offset-y 1px, blur 2px, spread 0px")
      && stack.includes("Figma effect 2/3: DROP_SHADOW color #5c8226")
      && stack.includes("offset-y 0px, blur 0px, spread 4px")
      && stack.includes("Figma effect 3/3: DROP_SHADOW color #ffffff")
      && stack.includes("spread 2px"),
    "the ordered effect stack should preserve every shadow's color and geometry"
  );
  assert.strictEqual(
    helpers.summary({ effects }, {}),
    "Effects: " + stack,
    "variant visual facts should expose the complete indexed effect stack"
  );

  const rows = [];
  helpers.bindings(effects, "State=Focus", rows);
  assert.deepStrictEqual(
    rows.map(row => row.property),
    [
      "Effect 1 DROP_SHADOW color",
      "Effect 1 DROP_SHADOW radius",
      "Effect 1 DROP_SHADOW offsetY",
      "Effect 2 DROP_SHADOW color",
    ],
    "bound effect fields should retain the effect index they belong to"
  );
  assert.ok(
    rows[0].effectDetails.includes("Figma effect 1/3")
      && rows[3].effectDetails.includes("Figma effect 2/3"),
    "bound effect rows should carry the complete geometry of their corresponding effect"
  );
  assert.ok(
    stack.includes("Figma effect 3/3") && !rows.some(row => row.property.startsWith("Effect 3 ")),
    "unbound effects should remain visible in the full stack even though they have no token row"
  );

  const bindingKey = new Function(
    extractFunction(code, "_bindingKey") + "\nreturn _bindingKey;"
  )();
  assert.strictEqual(
    bindingKey({ node: "State=Focus", property: "Effect 1 DROP_SHADOW color" }),
    bindingKey({ node: "State=Focus", property: "Effect DROP_SHADOW color" }),
    "the first indexed effect should compare against a single-effect default"
  );

  assert.ok(
    code.includes("if (allResolved[i].paintDetails || allResolved[i].effectDetails) _pushSpecBinding(allResolved[i]);")
      && code.includes("'effects: ' + _effectsForSpec + '\\n'"),
    "machine-readable SPEC metadata should retain multi-effect token bindings and complete effect stacks"
  );
})();
