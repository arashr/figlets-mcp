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
  "_docNormalizePartName",
  "_docIsSlotLike",
  "_docPaintsVisible",
  "_docNodeHasVisiblePaint",
  "_docNodeHasEffect",
  "_docNodeHasTextContent",
  "_docPublicChildCount",
  "_docMeaningfulPartName",
  "_docWrapperishPartName",
  "_classifyComponentDocAnatomyNode",
];

const classify = new Function(
  helperNames.map(name => extractFunction(code, name)).join("\n") +
    "\nreturn _classifyComponentDocAnatomyNode;"
)();

function node(type, name, options) {
  const opts = options || {};
  return Object.assign({
    type,
    name,
    children: [],
    fills: [],
    strokes: [],
    effects: [],
    visible: true,
  }, opts);
}

function child(name) {
  return node("TEXT", name || "Label", { characters: "Label" });
}

module.exports = (async () => {
  const contentWrapper = node("FRAME", "Content", {
    layoutMode: "VERTICAL",
    children: [child("Title"), child("Subtitle")],
  });
  assert.deepStrictEqual(
    classify(contentWrapper, 1),
    { document: false, traverse: true, reason: "layout wrapper name" },
    "generic content wrappers should be promoted through instead of documented"
  );

  const pluralContentsWrapper = node("FRAME", "Contents", {
    layoutMode: "VERTICAL",
    children: [child("Card Title"), child("Card Description")],
  });
  assert.deepStrictEqual(
    classify(pluralContentsWrapper, 1),
    { document: false, traverse: true, reason: "layout wrapper name" },
    "plural Contents wrappers from real card components should also be promoted through"
  );

  const singleChildShell = node("FRAME", "Layer", {
    layoutMode: "HORIZONTAL",
    children: [child("Label")],
  });
  assert.deepStrictEqual(
    classify(singleChildShell, 1),
    { document: false, traverse: true, reason: "single-child layout wrapper" },
    "unstyled one-child shells should be skipped"
  );

  const visibleContainer = node("FRAME", "Container", {
    children: [child("Label")],
    fills: [{ type: "SOLID", visible: true, color: { r: 1, g: 1, b: 1 } }],
  });
  assert.deepStrictEqual(
    classify(visibleContainer, 1),
    { document: true, traverse: true, reason: "visible" },
    "wrapper-ish names with visible styling should remain documented surfaces"
  );

  const slotFrame = node("FRAME", "Leading Slot", {
    layoutMode: "HORIZONTAL",
    children: [child("Icon")],
  });
  assert.deepStrictEqual(
    classify(slotFrame, 1),
    { document: true, traverse: true, reason: "slot" },
    "slot-named frames should be meaningful component parts, not wrapper noise"
  );

  const figmaSlot = node("SLOT", "Content", {
    children: [child("Default Icon")],
  });
  assert.deepStrictEqual(
    classify(figmaSlot, 1),
    { document: true, traverse: false, reason: "slot" },
    "native Figma SLOT nodes should be documented and should stop traversal"
  );
})();
