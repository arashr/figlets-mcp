const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { handleInspectDsSetupGaps } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

// Same shape as the accessible-aliases test: light=green/50 vs source FG=green/300
// fails WCAG 4.5, so the inspector must report an upgraded Light alias and a
// kept Dark alias before any apply step runs.
function makeSnapshot() {
  function prim(id, name, r, g, b) {
    return { id, name, resolvedType: "COLOR", variableCollectionId: "primColl",
      valuesByMode: { primMode: { r, g, b } } };
  }
  function sem(id, name, l, d) {
    return { id, name, resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: l }, darkId: { type: "VARIABLE_ALIAS", id: d } } };
  }
  const primitives = [
    prim("g50",  "color/green/50",  0.94, 0.99, 0.95),
    prim("g100", "color/green/100", 0.86, 0.97, 0.89),
    prim("g200", "color/green/200", 0.73, 0.93, 0.79),
    prim("g300", "color/green/300", 0.55, 0.87, 0.65),
    prim("g500", "color/green/500", 0.13, 0.67, 0.33),
    prim("g700", "color/green/700", 0.06, 0.40, 0.20),
    prim("g800", "color/green/800", 0.04, 0.30, 0.15),
    prim("g950", "color/green/950", 0.01, 0.13, 0.06),
    prim("n50",  "color/neutral/50",  0.98, 0.98, 0.98),
    prim("n950", "color/neutral/950", 0.05, 0.05, 0.05),
  ];
  const semantics = [
    sem("sBg", "color/surface/success-variant", "g50", "g950"),
    sem("sFg", "color/on-surface/success", "g300", "g200"),
  ];
  return {
    variables: primitives.concat(semantics),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: semantics.map(v => v.id) },
    ],
  };
}

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-inspect-planned-"));
  const snapPath = path.join(tmp, "figma-data.json");
  fs.writeFileSync(snapPath, JSON.stringify(makeSnapshot()), "utf8");
  const prevLocal = process.env.FIGLETS_LOCAL_DIR;
  const prevFig = process.env.FIGLETS_FIGMA_DATA_PATH;
  process.env.FIGLETS_LOCAL_DIR = tmp;
  process.env.FIGLETS_FIGMA_DATA_PATH = snapPath;
  try {
    const result = handleInspectDsSetupGaps({ figmaDataPath: snapPath });
    assert.ok(!result.error, "inspect should succeed");
    assert.strictEqual(result.semanticGaps.length, 1);
    const gap = result.semanticGaps[0];
    assert.strictEqual(gap.recommended, "color/on-surface/success-variant");
    assert.ok(gap.plannedAliases, "inspector must surface plannedAliases for the designer to approve");
    assert.ok(/^color\/green\/(700|800|900|950)$/.test(gap.plannedAliases.Light),
      "Light alias must be upgraded off green/300, got " + gap.plannedAliases.Light);
    assert.strictEqual(gap.plannedAliases.Dark, "color/green/200",
      "Dark alias should match the passing source step");
    assert.strictEqual(gap.plannedUpgrades.Light, true, "Light must be flagged as upgraded for contrast");
    assert.strictEqual(gap.plannedUpgrades.Dark, false, "Dark passed without upgrade");
  } finally {
    if (prevLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocal;
    else delete process.env.FIGLETS_LOCAL_DIR;
    if (prevFig !== undefined) process.env.FIGLETS_FIGMA_DATA_PATH = prevFig;
    else delete process.env.FIGLETS_FIGMA_DATA_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
