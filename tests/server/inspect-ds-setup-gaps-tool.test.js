const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  inspectDsSetupGapsTool,
  handleInspectDsSetupGaps,
  inspectDsSetupGapsFromFigmaData,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

function colorVar(id, name, valuesByMode = {}) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "color-coll",
    valuesByMode,
  };
}

const figmaData = {
  variables: [
    colorVar("p-blue-800", "color/blue/800"),
    colorVar("p-blue-100", "color/blue/100"),
    colorVar("p-red-800", "color/red/800"),
    colorVar("p-red-100", "color/red/100"),
    colorVar("v-info-bg", "color/surface/info-variant"),
    colorVar("v-info-fg", "color/on-surface/info", {
      light: { type: "VARIABLE_ALIAS", id: "p-blue-800" },
      dark: { type: "VARIABLE_ALIAS", id: "p-blue-100" },
    }),
    colorVar("v-danger-bg", "color/surface/danger-variant"),
    colorVar("v-danger-fg", "color/on-surface/danger", {
      light: { type: "VARIABLE_ALIAS", id: "p-red-800" },
      dark: { type: "VARIABLE_ALIAS", id: "p-red-100" },
    }),
    colorVar("v-brand-bg", "color/surface/brand-variant"),
    colorVar("v-brand-fg", "color/on-surface/brand-variant"),
    colorVar("v-fill", "color/fill/info-variant"),
    colorVar("v-bg-subtle", "color/bg/accent-subtle"),
    colorVar("v-text-accent", "color/text/accent"),
  ],
  collections: [{
    id: "color-coll",
    name: "Color / Semantics",
    modes: [
      { modeId: "light", name: "Light" },
      { modeId: "dark", name: "Dark" },
    ],
  }],
};

module.exports = (() => {
  assert.strictEqual(inspectDsSetupGapsTool.name, "inspect_ds_setup_gaps");
  assert.ok(/without mutating/.test(inspectDsSetupGapsTool.description));

  const result = inspectDsSetupGapsFromFigmaData(figmaData);
  assert.strictEqual(result.summary.semanticGapCount, 3);
  assert.strictEqual(result.summary.proposedCount, 3);
  assert.strictEqual(result.summary.unresolvedCount, 0);

  const byBg = Object.fromEntries(result.semanticGaps.map(gap => [gap.bg, gap]));

  assert.strictEqual(
    byBg["color/surface/info-variant"].recommended,
    "color/on-surface/info-variant",
    "surface variants should propose matching on-surface variants"
  );
  assert.strictEqual(
    byBg["color/surface/info-variant"].source,
    "color/on-surface/info",
    "variant foreground should copy aliases from the nearest base foreground"
  );
  assert.deepStrictEqual(
    byBg["color/surface/info-variant"].sourceAliases,
    { Light: "color/blue/800", Dark: "color/blue/100" },
    "report should expose copied alias targets for designer review"
  );

  assert.ok(!byBg["color/surface/brand-variant"], "existing companion should not be reported as a gap");
  assert.ok(!byBg["color/fill/info-variant"], "fill variables should never trigger foreground companion inference");
  assert.strictEqual(
    byBg["color/bg/accent-subtle"].recommended,
    "color/text/accent-subtle",
    "role-based bg tokens should preserve text-family naming style"
  );
  assert.strictEqual(
    byBg["color/bg/accent-subtle"].source,
    "color/text/accent",
    "role-based subtle tokens should copy from the base text token"
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-setup-gaps-"));
  const snapshotPath = path.join(tmpDir, "figma-data.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(figmaData, null, 2), "utf8");
  try {
    const handled = handleInspectDsSetupGaps({ figmaDataPath: snapshotPath });
    assert.ok(!handled.error, "handler should read an explicit snapshot path");
    assert.strictEqual(handled.summary.semanticGapCount, 3);
    assert.strictEqual(handled.source.path, snapshotPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();
