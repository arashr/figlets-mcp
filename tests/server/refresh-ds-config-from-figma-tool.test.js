const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  refreshDsConfigFromFigmaTool,
  handleRefreshDsConfigFromFigma,
  refreshDsConfigFromFigmaData,
} = require("../../packages/figlets-mcp-server/src/tools/refresh-ds-config-from-figma.js");

function colorVar(id, name, valuesByMode, variableCollectionId = "primitives") {
  return { id, name, resolvedType: "COLOR", variableCollectionId, valuesByMode };
}

const figmaData = {
  collections: [
    {
      id: "primitives",
      name: "Primitives",
      variableIds: ["p-cobalt-500", "p-cobalt-600", "p-blue-800", "p-blue-100"],
      modes: [{ modeId: "default", name: "Default" }],
    },
    {
      id: "semantics",
      name: "Color / Semantics",
      variableIds: ["s-info-bg", "s-info-text"],
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
    },
  ],
  variables: [
    colorVar("p-cobalt-500", "color/cobalt/500", { default: { r: 0.1, g: 0.2, b: 0.3 } }),
    colorVar("p-cobalt-600", "color/cobalt/600", { default: { r: 0.2, g: 0.3, b: 0.4 } }),
    colorVar("p-blue-800", "color/blue/800", { default: { r: 0.01, g: 0.02, b: 0.03 } }),
    colorVar("p-blue-100", "color/blue/100", { default: { r: 0.9, g: 0.92, b: 0.96 } }),
    colorVar("s-info-bg", "color/surface/info", {
      light: { type: "VARIABLE_ALIAS", id: "p-cobalt-500" },
      dark: { type: "VARIABLE_ALIAS", id: "p-cobalt-600" },
    }, "semantics"),
    colorVar("s-info-text", "color/on-surface/info", {
      light: { type: "VARIABLE_ALIAS", id: "p-blue-800" },
      dark: { type: "VARIABLE_ALIAS", id: "p-blue-100" },
    }, "semantics"),
    colorVar("p-new", "color/cobalt/700", { default: { r: 0.7, g: 0.7, b: 0.7 } }),
  ],
};

function makeDs() {
  return {
    color: {
      brand: [{ name: "cobalt", hex: "#000000", role: "primary" }],
      ramps: [{
        folder: "color/cobalt",
        steps: [
          [500, 0, 0, 0],
          [600, 0, 0, 0],
        ],
      }],
      semantics: {
        pairs: [{
          bg: "color/surface/info",
          text: "color/on-surface/info",
          Light: { bg: "color/old/500", text: "color/old/900" },
          Dark: { bg: "color/old/600", text: "color/old/100" },
        }]
      }
    }
  };
}

module.exports = (() => {
  assert.strictEqual(refreshDsConfigFromFigmaTool.name, "refresh_ds_config_from_figma");

  const result = refreshDsConfigFromFigmaData(makeDs(), figmaData);
  assert.strictEqual(result.changes.length, 7);
  assert.strictEqual(result.ds.color.brand[0].hex, "#1A334D");
  assert.deepStrictEqual(result.ds.color.ramps[0].steps, [
    [500, 0.1, 0.2, 0.3],
    [600, 0.2, 0.3, 0.4],
  ]);
  assert.deepStrictEqual(result.ds.color.semantics.pairs[0].Light, {
    bg: "color/cobalt/500",
    text: "color/blue/800",
  });
  assert.deepStrictEqual(result.ds.color.semantics.pairs[0].Dark, {
    bg: "color/cobalt/600",
    text: "color/blue/100",
  });
  assert.ok(
    !result.ds.color.ramps[0].steps.some(row => row[0] === 700),
    "refresh should not add ramp rows that exist only in Figma"
  );
  assert.strictEqual(
    result.ds.color.semantics.pairs.length,
    1,
    "refresh should not create semantic pairs that only exist in Figma"
  );

  {
    const noSemanticFields = makeDs();
    delete noSemanticFields.color.semantics.pairs[0].Light;
    delete noSemanticFields.color.semantics.pairs[0].Dark;
    const noFieldsResult = refreshDsConfigFromFigmaData(noSemanticFields, figmaData);
    assert.ok(
      !("Light" in noFieldsResult.ds.color.semantics.pairs[0]),
      "refresh should not create missing semantic Light fields"
    );
    assert.ok(
      !("Dark" in noFieldsResult.ds.color.semantics.pairs[0]),
      "refresh should not create missing semantic Dark fields"
    );
  }

  {
    const missingKnownRampStep = makeDs();
    missingKnownRampStep.color.ramps[0].steps.push([800, 0, 0, 0]);
    const missingResult = refreshDsConfigFromFigmaData(missingKnownRampStep, figmaData);
    assert.ok(
      missingResult.skipped.some(row => row.kind === "ramp-step" && row.name === "color/cobalt/800"),
      "refresh should report configured ramp rows missing from Figma instead of deleting them"
    );
    assert.ok(
      missingResult.ds.color.ramps[0].steps.some(row => row[0] === 800),
      "refresh should not delete config ramp rows missing from Figma"
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-refresh-config-"));
  const configPath = path.join(tmp, "design-system.config.js");
  const snapshotPath = path.join(tmp, "figma-data.json");
  fs.writeFileSync(configPath, "const DS = " + JSON.stringify(makeDs(), null, 2) + ";\n", "utf8");
  fs.writeFileSync(snapshotPath, JSON.stringify(figmaData, null, 2), "utf8");

  try {
    const dryRun = handleRefreshDsConfigFromFigma({ config_path: configPath, figmaDataPath: snapshotPath, dry_run: true });
    assert.strictEqual(dryRun.dryRun, true);
    assert.strictEqual(dryRun.summary.changedCount, 7);
    assert.ok(fs.readFileSync(configPath, "utf8").includes("#000000"), "dry run should not write config");

    const applied = handleRefreshDsConfigFromFigma({ config_path: configPath, figmaDataPath: snapshotPath });
    assert.strictEqual(applied.dryRun, false);
    assert.strictEqual(applied.summary.changedCount, 7);
    const updated = fs.readFileSync(configPath, "utf8");
    assert.ok(updated.includes("#1A334D"), "apply should write refreshed brand hex");
    assert.ok(updated.includes("color/blue/800"), "apply should write refreshed semantic alias refs");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
