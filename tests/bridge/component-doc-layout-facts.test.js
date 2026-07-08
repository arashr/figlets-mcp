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
  "_docFormatLayoutDirection",
  "_docFormatSizingBehavior",
  "_docAxisValue",
  "_docAutoLayoutAxisSizing",
  "_docNodeSizingBehavior",
  "_docAxisConstraintSummary",
  "_docAxisSizeSummary",
  "_docFormatNodeSize",
  "_docFormatPadding",
  "_docFormatLayoutSpacing",
  "_docFormatLayoutAlignment",
  "_docHasLayoutFacts",
  "_docImageFillSummary",
  "_docCornerRadiusSummary",
];

const helpers = new Function(
  helperNames.map(name => extractFunction(code, name)).join("\n") +
    "\nreturn { _docFormatLayoutDirection, _docNodeSizingBehavior, _docAxisConstraintSummary, _docAxisSizeSummary, _docFormatNodeSize, _docFormatLayoutSpacing, _docFormatLayoutAlignment, _docHasLayoutFacts, _docImageFillSummary, _docCornerRadiusSummary };"
)();

module.exports = (async () => {
  const root = {
    layoutMode: "VERTICAL",
    width: 328,
    height: 420,
    layoutSizingHorizontal: "FILL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "FIXED",
    minHeight: 320,
    maxHeight: 640,
    paddingTop: 12,
    paddingRight: 16,
    paddingBottom: 20,
    paddingLeft: 16,
    itemSpacing: 8,
    clipsContent: true,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "CENTER",
  };

  assert.strictEqual(helpers._docFormatLayoutDirection(root.layoutMode), "Vertical");
  assert.strictEqual(helpers._docNodeSizingBehavior(root, "width", true), "Fill parent");
  assert.strictEqual(helpers._docNodeSizingBehavior(root, "height", true), "Hug content");
  assert.strictEqual(helpers._docAxisConstraintSummary(root, "height"), "min 320px; max 640px");
  assert.strictEqual(
    helpers._docAxisSizeSummary(root, "height", true),
    "Hug content; min 320px; max 640px; current 420px",
    "hug/fill/fixed behavior should be prioritized before constraints and current pixel measurement"
  );
  assert.strictEqual(
    helpers._docFormatNodeSize(root, true),
    "width Fill parent; current 328px; height Hug content; min 320px; max 640px; current 420px",
    "root component size should prioritize Figma sizing behavior, then min/max, then current measurement"
  );
  assert.strictEqual(
    helpers._docFormatLayoutSpacing(root),
    "padding 12/16/20/16px; gap 8px; clips content",
    "auto-layout padding, gap, and clipping should be documented directly from Figma"
  );
  assert.strictEqual(helpers._docFormatLayoutAlignment(root), "primary MIN; counter CENTER");

  const child = {
    width: 296,
    height: 180,
    layoutSizingHorizontal: "FILL",
    layoutSizingVertical: "FIXED",
    fills: [{ type: "IMAGE", visible: true, scaleMode: "FILL" }],
    cornerRadius: 8,
  };
  assert.strictEqual(
    helpers._docFormatNodeSize(child, false),
    "width Fill parent; current 296px; height Fixed; current 180px",
    "child layer size should include Figma fill/fixed behavior"
  );
  assert.strictEqual(helpers._docImageFillSummary(child), "Image fill: FILL (fills frame; crop/cover behavior)");
  assert.strictEqual(helpers._docCornerRadiusSummary(child), "8px radius");
  assert.ok(helpers._docHasLayoutFacts(child), "fill-parent child sizing should count as a layout fact");

  assert.ok(
    code.includes("## Layout") &&
      code.includes("['Variant', 'Width', 'Height']") &&
      code.includes("_docAxisSizeSummary(_children[i], 'height', true)") &&
      code.includes("['Element', 'Direction', 'Size', 'Spacing / Clipping', 'Alignment', 'Notes']") &&
      code.includes("layoutSizingHorizontal") &&
      code.includes("return 'Image fill' + (mode ? ': ' + mode : '');"),
    "component markdown should include Figma-backed sizing behavior and layout facts"
  );

  assert.ok(
    !code.includes("object-fit") &&
      !code.includes("<article>") &&
      !code.includes("BEM"),
    "component docs should not invent markup, CSS object-fit, or class naming contracts"
  );
})();
