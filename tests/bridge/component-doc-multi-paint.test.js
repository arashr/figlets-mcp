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

const paintHelpers = [
  "_docFormatNumber",
  "_docColorSummary",
  "_docPaintStopSummary",
  "_docPaintOpacitySummary",
  "_docPaintDetailSummary",
  "_docPaintStackEntrySummary",
  "_docPaintVariableAlias",
  "_docPaintBindingRows",
].map(name => extractFunction(code, name)).join("\n");

const getPaintHelpers = new Function(
  paintHelpers
    + "\nreturn { bindingRows: _docPaintBindingRows, stackEntry: _docPaintStackEntrySummary };"
)();

const solid = (color, extras = {}) => ({
  type: "SOLID",
  color,
  visible: extras.visible === undefined ? true : extras.visible,
  opacity: extras.opacity === undefined ? 1 : extras.opacity,
  blendMode: extras.blendMode || "NORMAL",
});

module.exports = (async () => {
  const multiFillNode = {
    name: "State=Hover",
    fills: [
      solid({ r: 0.96, g: 0.96, b: 0.96 }),
      solid({ r: 0, g: 0, b: 0, a: 0.08 }, { opacity: 0.5, blendMode: "MULTIPLY" }),
    ],
    boundVariables: {
      fills: [{ id: "surface" }, { id: "hover-scrim" }],
    },
  };
  const fillRows = getPaintHelpers.bindingRows(multiFillNode, "fills", "Fill");
  assert.deepStrictEqual(fillRows.map(row => row.property), ["Fill 1", "Fill 2"]);
  assert.deepStrictEqual(fillRows.map(row => row.varId), ["surface", "hover-scrim"]);
  assert.ok(
    fillRows[1].paintDetails.includes("Figma fill 2/2")
      && fillRows[1].paintDetails.includes("rgba(0, 0, 0, 0.08)")
      && fillRows[1].paintDetails.includes("opacity 50%")
      && fillRows[1].paintDetails.includes("blend MULTIPLY")
      && fillRows[1].paintDetails.includes("visible"),
    "multi-fill rows should retain Figma order and paint composition details"
  );

  const reorderedFillNode = {
    name: "State=Focus",
    fills: [
      {
        ...solid({ r: 0, g: 0, b: 0, a: 0.08 }),
        boundVariables: { color: { id: "hover-scrim" } },
      },
      {
        ...solid({ r: 0.96, g: 0.96, b: 0.96 }),
        boundVariables: { color: { id: "surface" } },
      },
    ],
    // Figma can retain this node-level array in an older order after paints move.
    boundVariables: {
      fills: [{ id: "surface" }, { id: "hover-scrim" }],
    },
  };
  const reorderedRows = getPaintHelpers.bindingRows(reorderedFillNode, "fills", "Fill");
  assert.deepStrictEqual(
    reorderedRows.map(row => row.varId),
    ["hover-scrim", "surface"],
    "per-paint aliases should remain attached to their paint when Figma's node-level alias order is stale"
  );

  const singleFillRows = getPaintHelpers.bindingRows({
    name: "State=Default",
    fills: [solid({ r: 1, g: 1, b: 1 })],
    boundVariables: { fills: [{ id: "surface" }] },
  }, "fills", "Fill");
  assert.strictEqual(singleFillRows[0].property, "Fill");
  assert.strictEqual(singleFillRows[0].paintDetails, "");

  const strokeRows = getPaintHelpers.bindingRows({
    name: "Outlined",
    strokes: [
      solid({ r: 0, g: 0, b: 0 }),
      solid({ r: 1, g: 0, b: 0 }, { visible: false }),
    ],
    boundVariables: { strokes: [{ id: "border" }, { id: "focus-border" }] },
  }, "strokes", "Stroke");
  assert.deepStrictEqual(strokeRows.map(row => row.property), ["Stroke 1", "Stroke 2"]);
  assert.ok(strokeRows[1].paintDetails.includes("hidden"));

  const visibleFillSummary = new Function(
    "figma",
    "paintStyleById",
    "varById",
    "_docImageFillSummary",
    "_toHex",
    paintHelpers
      + "\n"
      + extractFunction(code, "_visibleFillSummary")
      + "\nreturn _visibleFillSummary;"
  )(
    { mixed: Symbol("mixed") },
    {},
    {
      surface: { name: "color/bg/default" },
      "hover-scrim": { name: "color/scrim/hover" },
    },
    () => "",
    (r, g, b) => `rgb(${r},${g},${b})`
  );
  const stackSummary = visibleFillSummary(multiFillNode);
  assert.ok(
    stackSummary.indexOf("color/bg/default") < stackSummary.indexOf("color/scrim/hover")
      && stackSummary.includes("Figma fill 1/2")
      && stackSummary.includes("Figma fill 2/2"),
    "variant visual facts should describe the complete ordered fill stack"
  );
  const reorderedSummary = visibleFillSummary(reorderedFillNode);
  assert.ok(
    reorderedSummary.indexOf("color/scrim/hover") < reorderedSummary.indexOf("color/bg/default"),
    "variant visual facts should use each paint's own alias rather than a stale node-level alias position"
  );
  assert.strictEqual(
    visibleFillSummary({
      fills: [solid({ r: 1, g: 1, b: 1 })],
      boundVariables: { fills: [{ id: "surface" }] },
    }),
    "color/bg/default",
    "ordinary single-fill output should remain unchanged"
  );

  const bindingKey = new Function(
    extractFunction(code, "_bindingKey") + "\nreturn _bindingKey;"
  )();
  assert.strictEqual(
    bindingKey({ node: "State=Hover", property: "Fill 1" }),
    bindingKey({ node: "State=Hover", property: "Fill" }),
    "the first indexed fill should compare against a single-fill default"
  );

  assert.ok(
    code.includes("const allResolved = _resolveBindingRows(_allComponentRawBinds);")
      && code.includes("if (allResolved[i].paintDetails || allResolved[i].effectDetails) _pushSpecBinding(allResolved[i]);"),
    "machine-readable SPEC metadata should include multi-paint bindings from non-default variants"
  );
})();
