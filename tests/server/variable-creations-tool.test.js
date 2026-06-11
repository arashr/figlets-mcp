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
  planDsVariableCreationsFromFigmaData,
  handleApplyDsVariableCreations,
  _validateVariableCreationsAgainstSnapshot,
} = require("../../packages/figlets-mcp-server/src/tools/variable-creations.js");

function variable(id, name, type, collectionId, valuesByMode) {
  return { id, name, resolvedType: type, variableCollectionId: collectionId, valuesByMode };
}

module.exports = (async () => {
  const figmaData = {
    variables: [
      variable("n50", "color/neutral/50", "COLOR", "prim", { value: { r: 0.98, g: 0.98, b: 0.98 } }),
      variable("n950", "color/neutral/950", "COLOR", "prim", { value: { r: 0.05, g: 0.05, b: 0.05 } }),
      variable("space4", "space/4", "FLOAT", "spacing", { mobile: 16 }),
    ],
    collections: [
      { id: "prim", name: "1. Primitives", modes: [{ modeId: "value", name: "Value" }], variableIds: ["n50", "n950"] },
      { id: "color", name: "2. Color", modes: [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }], variableIds: [] },
      { id: "spacing", name: "4. Spacing", modes: [{ modeId: "mobile", name: "Mobile" }], variableIds: ["space4"] },
    ],
  };

  const plan = planDsVariableCreationsFromFigmaData(figmaData, {
    variables: [
      {
        name: "color/text/custom",
        collection: "2. Color",
        type: "COLOR",
        values: {
          Light: { alias: "color/neutral/950" },
          Dark: { alias: "color/neutral/50" },
        },
      },
      {
        name: "space/custom",
        collection: "4. Spacing",
        type: "FLOAT",
        values: { Mobile: 24 },
      },
      {
        name: "color/text/bad",
        collection: "2. Color",
        type: "COLOR",
        values: { Light: { alias: "space/4" } },
      },
    ],
  });

  assert.strictEqual(plan.repairPlan.counts.ready, 2);
  assert.strictEqual(plan.repairPlan.counts.blocked, 1);
  assert.ok(
    plan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.summaryLine.includes("color/text/custom") &&
      change.summaryLine.includes("Light -> color/neutral/950")
    ),
    "designer preview should list exact aliases"
  );
  assert.ok(
    plan.repairPlan.designerPresentation.blocked.some(item =>
      item.token === "color/text/bad" &&
      item.errors.some(error => error.includes("not COLOR"))
    ),
    "planner should block alias targets with the wrong variable type"
  );

  const applyInput = plan.repairPlan.applyInput;
  assert.strictEqual(
    _validateVariableCreationsAgainstSnapshot(applyInput.variableCreations, figmaData),
    null,
    "fresh planner payload should validate against the same snapshot"
  );
  assert.ok(
    _validateVariableCreationsAgainstSnapshot(applyInput.variableCreations, {
      variables: figmaData.variables.concat([
        variable("existing", "color/text/custom", "COLOR", "color", {}),
      ]),
      collections: figmaData.collections,
    }).includes("already exists"),
    "stale apply validation should fail if the variable now exists"
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-variable-creations-"));
  const snapPath = path.join(tmp, "figma-data.json");
  const hookPath = createBridgeHookFile(tmp);
  const capturePath = path.join(tmp, "figma-operations-capture.json");
  fs.writeFileSync(snapPath, JSON.stringify(figmaData), "utf8");
  const uninstall = installBridgeHook(hookPath);
  setBridgeHookRoute(hookPath, "/request-figma-operations", {
    capturePath,
    json: {
      success: true,
      result: {
        applied: [{ kind: "create_variable", name: "color/text/custom", collection: "2. Color", type: "COLOR" }],
        skipped: [],
        unresolved: [],
        message: "1 variable created.",
      },
    },
  });

  try {
    const result = await handleApplyDsVariableCreations({
      figmaDataPath: snapPath,
      variableCreations: [applyInput.variableCreations[0]],
    });
    assert.ok(!result.error, result.error);
    assert.strictEqual(result.created.length, 1);
    assert.ok(result.verificationInstruction.includes("sync_figma_data"));
    const body = readBridgeHookCapture(capturePath);
    assert.deepStrictEqual(body.operations, [{
      kind: "create_variable",
      name: applyInput.variableCreations[0].name,
      collection: applyInput.variableCreations[0].collection,
      collectionId: applyInput.variableCreations[0].collectionId,
      type: applyInput.variableCreations[0].type,
      modeValues: applyInput.variableCreations[0].modeValues,
    }]);
  } finally {
    uninstall();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
