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
  "_docPaintStopSummary",
  "_docPaintOpacitySummary",
  "_docPaintDetailSummary",
  "_docPaintsDetailSummary",
  "_docPaintStyleSummary",
  "_docBooleanVisibleWhen",
  "_docBooleanVisibilitySummary",
  "_docRelativeBoundsSummary",
  "_docBoundsArea",
  "_docBoundsIntersectionArea",
  "_docPlacementSummary",
  "_docEffectDetailSummary",
  "_docEffectsDetailSummary",
  "_docEffectOutset",
  "_docEffectsOutset",
  "_docEffectSummary",
  "_docVariantPreviewOutset",
];

const helpers = new Function(
  helperNames.map(name => extractFunction(code, name)).join("\n") +
    "\nreturn { _docColorSummary, _docPaintDetailSummary, _docPaintStyleSummary, _docBooleanVisibleWhen, _docBooleanVisibilitySummary, _docRelativeBoundsSummary, _docPlacementSummary, _docEffectSummary, _docVariantPreviewOutset };"
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
  assert.strictEqual(
    helpers._docVariantPreviewOutset(
      { effectStyleId: "effect-focus", effects: [] },
      {
        "effect-focus": {
          effects: [
            { type: "DROP_SHADOW", visible: true, offset: { x: 0, y: 0 }, radius: 0, spread: 2 },
            { type: "DROP_SHADOW", visible: true, offset: { x: 0, y: 0 }, radius: 28, spread: 4 },
          ],
        },
      }
    ),
    32,
    "variant showcase previews should reserve space for focus-ring and shadow outsets"
  );

  assert.strictEqual(
    helpers._docPaintStyleSummary({
      id: "paint-brand-glow",
      name: "gradient/brand-glow",
      paints: [
        {
          type: "GRADIENT_LINEAR",
          visible: true,
          gradientStops: [
            { position: 0, color: { r: 0.2, g: 0.45, b: 1, a: 1 } },
            { position: 1, color: { r: 0.95, g: 0.3, b: 0.65, a: 0.72 } },
          ],
        },
      ],
    }),
    "Paint style: gradient/brand-glow; GRADIENT_LINEAR stops 0% #3373ff -> 100% rgba(242, 77, 166, 0.72)",
    "paint style summaries should preserve gradient type, stops, colors, and alpha for implementation"
  );

  assert.strictEqual(
    helpers._docPaintDetailSummary({
      type: "SOLID",
      visible: true,
      color: { r: 0.07, g: 0.07, b: 0.07, a: 1 },
      opacity: 0.45,
    }),
    "SOLID #121212 opacity 45%",
    "paint summaries should preserve Figma paint opacity for overlays"
  );

  const root = { absoluteBoundingBox: { x: 100, y: 200, width: 320, height: 316 } };
  const imageNode = {
    name: "Image",
    absoluteBoundingBox: { x: 100, y: 200, width: 320, height: 200 },
  };
  const overlayNode = {
    absoluteBoundingBox: { x: 100, y: 200, width: 320, height: 200 },
  };
  const badgeNode = {
    absoluteBoundingBox: { x: 340, y: 216, width: 64, height: 24 },
  };
  assert.strictEqual(helpers._docBooleanVisibleWhen(false, false), true);
  assert.strictEqual(helpers._docBooleanVisibilitySummary(false, false), "false: hidden; true: visible");
  assert.strictEqual(helpers._docRelativeBoundsSummary(overlayNode, root), "x 0px, y 0px, w 320px, h 200px");
  assert.strictEqual(
    helpers._docPlacementSummary(overlayNode, root, [{ name: "Image", node: imageNode }]),
    "covers Image",
    "conditional overlay notes should say which visible part the layer covers"
  );
  assert.strictEqual(
    helpers._docPlacementSummary(badgeNode, root, [{ name: "Image", node: imageNode }]),
    "top-right within Image",
    "conditional badge notes should include placement relative to the visible part"
  );

  assert.ok(
    code.includes("const _allEffectStyles = _ds.effectStyles || [];") &&
      code.includes("const _allPaintStyles = _ds.paintStyles || [];") &&
      code.includes("const effectStyleById = {};") &&
      code.includes("const paintStyleById = {};") &&
      code.includes("node.effectStyleId") &&
      code.includes("node.fillStyleId") &&
      code.includes("node.strokeStyleId") &&
      code.includes("property: 'Effect style'") &&
      code.includes("property: 'Fill style'") &&
      code.includes("property: 'Stroke style'") &&
      code.includes("effect.boundVariables") &&
      code.includes("_collectEffectBindRows(effectStyleById[node.effectStyleId].effects"),
    "component docs should collect paint/effect style references and effect variable bindings"
  );

  assert.ok(
    code.includes("context: 'Paint style'") &&
      code.includes("_docPaintStyleSummary(style)") &&
      code.includes("remoteStyle.type === 'PAINT' || remoteStyle.type === 'FILL'") &&
      code.includes("return paintStyleById[node.fillStyleId].name") &&
      code.includes("Stroke style: "),
    "component docs should resolve local or library paint styles into implementation-visible markdown facts"
  );

  assert.ok(
    code.includes("refs.visible") &&
      code.includes("def.type === 'BOOLEAN'") &&
      code.includes("## Boolean Property Behavior") &&
      code.includes("## Conditional Layers") &&
      code.includes("['Property', 'When false', 'When true']") &&
      code.includes("['Property', 'Layer', 'Visibility', 'Bounds', 'Styling', 'Notes']") &&
      code.includes("_mkLabel(doc, 'BOOLEAN PROPERTY BEHAVIOR')") &&
      code.includes("_mkTable(doc, 'Boolean Property Behavior Table')") &&
      code.includes("_mkBooleanPreviewRow(doc, _booleanBehaviorRows[i])") &&
      code.includes("Boolean Property Preview · ") &&
      code.includes("Boolean Preview States") &&
      code.includes("Boolean Preview Bounds") &&
      code.includes("const previewHeight = Math.ceil((typeof _defaultV.height === 'number' ? _defaultV.height : 240) + pad * 2)") &&
      code.includes("col.primaryAxisSizingMode = 'FIXED'") &&
      code.includes("shell.resize(previewWidth, previewHeight)") &&
      code.includes("wrap.resize(1280, previewHeight + 112)") &&
      code.includes("states.resize(1, previewHeight + 72)") &&
      code.includes("instance.setProperties(payload)") &&
      code.includes("_mkBooleanPreviewState(states, row, false)") &&
      code.includes("_mkBooleanPreviewState(states, row, true)") &&
      code.includes("_mkLabel(doc, 'CONDITIONAL LAYERS')") &&
      code.includes("_mkTable(doc, 'Conditional Layers Table')") &&
      code.includes("Conditional ' + row.property + ': ' + row.visibility"),
    "component docs should document boolean-controlled conditional layer visibility, bounds, styling, anatomy notes, and false/true previews in markdown and the Figma spec sheet"
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
    code.includes("Variant Preview Bounds") &&
      code.includes("_docVariantPreviewOutset(_v, effectStyleById)") &&
      code.includes("_previewShell.clipsContent = false") &&
      code.includes("_vf.fills = []; _vf.clipsContent = false") &&
      code.includes("_previewPad = _previewOutset > 0 ? _previewOutset + 4 : 0"),
    "Figma spec-sheet variant previews should reserve layout space for out-of-bounds focus rings and shadows"
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
      code.includes("replace(/\\|/g, '\\\\|')") &&
      code.includes("breakpoint pixel thresholds"),
    "token binding docs should include collection/mode context, per-mode resolved values, valid markdown escaping, and avoid inventing breakpoint widths"
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
