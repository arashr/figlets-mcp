const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createBridgeHookFile,
  installBridgeHook,
  readBridgeHookCapture,
  setBridgeHookRoute,
} = require("../helpers/bridge-hook.js");
const {
  handleInspectDsTokenGaps,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");
const {
  handleUpdateDsTokens,
} = require("../../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

function writeConfig(configPath, ds) {
  fs.writeFileSync(configPath, "const DS = " + JSON.stringify(ds, null, 2) + ";\n", "utf8");
}

function writeSnapshot(figmaDataPath, figmaData) {
  fs.writeFileSync(figmaDataPath, JSON.stringify(figmaData, null, 2), "utf8");
}

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-spacing-alias-flow-"));
  const configPath = path.join(tmp, "design-system.config.js");
  const figmaDataPath = path.join(tmp, "figma-data.json");

  const DS = {
    collections: {
      primitives: "1. Primitives",
      spacing: "4. Spacing",
    },
    spacing: {
      semantic: {
        "layout/lg": [48, 64, 96],
        "touch/comfortable": [48, 48, 40],
      },
      radius: {},
      border: {},
    },
  };

  const snapshot = {
    collections: [
      {
        id: "primitives",
        name: "1. Primitives",
        variableIds: ["p12", "p16", "p24", "p40"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "4. Spacing",
        variableIds: ["layout-lg", "touch-comfortable"],
        modes: [
          { modeId: "mobile", name: "Mobile" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
    ],
    variables: [
      { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
      { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
      { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
      { id: "p40", name: "space/40", resolvedType: "FLOAT", valuesByMode: { default: 40 } },
      {
        id: "layout-lg",
        name: "space/layout/lg",
        resolvedType: "FLOAT",
        valuesByMode: { mobile: 48, tablet: 64, desktop: 96 },
      },
      {
        id: "touch-comfortable",
        name: "space/touch/comfortable",
        resolvedType: "FLOAT",
        valuesByMode: { mobile: 48, tablet: 48, desktop: 40 },
      },
    ],
    textStyles: [],
    effectStyles: [],
  };

  writeConfig(configPath, DS);
  writeSnapshot(figmaDataPath, snapshot);

  const hookPath = createBridgeHookFile(tmp);
  const uninstallHook = installBridgeHook(hookPath);

  try {
    const inspected = handleInspectDsTokenGaps({
      config_path: configPath,
      figmaDataPath,
      categories: ["spacing-semantics"],
    });
    assert.ok(!inspected.error, inspected.error);
    assert.deepStrictEqual(inspected.repairPlan.applyInput.categories, ["spacing-semantics"]);
    const repairGaps = inspected.tokenGaps.filter(gap => gap.gapType === "spacing-alias-repair");
    assert.strictEqual(repairGaps.length, 2);
    assert.ok(
      inspected.repairPlan.designerPresentation.proposedChanges.length >= 6,
      "designer presentation should list per-mode alias targets"
    );

    const dryRun = handleUpdateDsTokens(Object.assign({}, inspected.repairPlan.previewInput, {
      figmaDataPath,
    }));
    assert.ok(!dryRun.error, dryRun.error);
    assert.ok(
      dryRun.report["spacing-semantics"].wouldUpdateVariables.some(item => item.name === "space/layout/lg"),
      "dry-run should preview layout/lg alias updates"
    );
    assert.ok(
      dryRun.report["spacing-semantics"].wouldUpdateVariables.some(item => item.name === "space/touch/comfortable"),
      "dry-run should preview touch/comfortable alias updates"
    );

    const applyCapture = path.join(tmp, "capture-spacing-alias-apply.json");
    setBridgeHookRoute(hookPath, "/request-update-tokens", {
      capturePath: applyCapture,
      json: {
        success: true,
        result: {
          dryRun: false,
          categories: ["spacing-semantics"],
          unknownCategories: [],
          report: {
            "spacing-semantics": {
              entries: 2,
              wouldCreateVariables: [],
              createdVariables: [],
              wouldUpdateVariables: [],
              updatedVariables: [
                { name: "space/layout/lg" },
                { name: "space/touch/comfortable" },
              ],
              wouldCreateStyles: [],
              createdStyles: [],
              wouldRefreshStyles: [],
              refreshedStyles: [],
              unmatched: [],
              typeMismatch: [],
              fontLoadFailures: [],
            },
          },
          message: "spacing-semantics: 2 changed",
        },
      },
    });

    const applied = await handleUpdateDsTokens(Object.assign({}, inspected.repairPlan.applyInput, {
      figmaDataPath,
    }));
    assert.ok(!applied.error, applied.error);
    assert.strictEqual(applied.dryRun, false);
    assert.deepStrictEqual(readBridgeHookCapture(applyCapture).categories, ["spacing-semantics"]);

    const aliasedSnapshot = Object.assign({}, snapshot, {
      variables: snapshot.variables.map(variable => {
        if (variable.name === "space/layout/lg") {
          return Object.assign({}, variable, {
            valuesByMode: {
              mobile: { type: "VARIABLE_ALIAS", id: "p12" },
              tablet: { type: "VARIABLE_ALIAS", id: "p16" },
              desktop: { type: "VARIABLE_ALIAS", id: "p24" },
            },
          });
        }
        if (variable.name === "space/touch/comfortable") {
          return Object.assign({}, variable, {
            valuesByMode: {
              mobile: { type: "VARIABLE_ALIAS", id: "p12" },
              tablet: { type: "VARIABLE_ALIAS", id: "p12" },
              desktop: { type: "VARIABLE_ALIAS", id: "p40" },
            },
          });
        }
        return variable;
      }),
    });
    writeSnapshot(figmaDataPath, aliasedSnapshot);

    const reinspected = handleInspectDsTokenGaps({
      config_path: configPath,
      figmaDataPath,
      categories: ["spacing-semantics"],
    });
    assert.ok(!reinspected.error, reinspected.error);
    assert.ok(
      !reinspected.tokenGaps.some(gap => gap.gapType === "spacing-alias-repair"),
      "reinspect should clear spacing alias repair gaps after apply"
    );
    assert.deepStrictEqual(reinspected.repairPlan.applyInput.categories, []);
  } finally {
    uninstallHook();
    try { fs.unlinkSync(configPath); } catch (err) {}
    try { fs.unlinkSync(figmaDataPath); } catch (err) {}
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();
