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
  planDsFigmaOperationsFromFigmaData,
  handleApplyDsFigmaOperations,
  _validateApprovedOperations,
} = require("../../packages/figlets-mcp-server/src/tools/figma-operations.js");

function variable(id, name, type, collectionId, valuesByMode) {
  return { id, name, resolvedType: type, variableCollectionId: collectionId, valuesByMode };
}

function alias(id) {
  return { type: "VARIABLE_ALIAS", id };
}

module.exports = (async () => {
  const variables = [
    variable("n50", "color/neutral/50", "COLOR", "prim", { value: { r: 0.98, g: 0.98, b: 0.98 } }),
    variable("n950", "color/neutral/950", "COLOR", "prim", { value: { r: 0.05, g: 0.05, b: 0.05 } }),
    variable("text-existing", "color/text/existing", "COLOR", "color", { light: alias("n50"), dark: alias("n950") }),
    variable("text-old", "color/text/old", "COLOR", "color", { light: alias("n950"), dark: alias("n50") }),
    variable("text-delete", "color/text/delete-me", "COLOR", "color", { light: alias("n50"), dark: alias("n950") }),
    variable("fill-danger", "color/fill/danger", "COLOR", "color", { light: alias("n50"), dark: alias("n950") }),
    variable("space-stack", "space/stack/md", "FLOAT", "spacing", { mobile: 16, tablet: 20 }),
    variable("obsolete-var", "obsolete/token", "FLOAT", "obsolete", { only: 1 }),
  ];
  const figmaData = {
    variables,
    collections: [
      { id: "prim", name: "1. Primitives", modes: [{ modeId: "value", name: "Value" }], variableIds: ["n50", "n950"] },
      { id: "color", name: "2. Color", modes: [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }], variableIds: ["text-existing", "text-old", "text-delete", "fill-danger"] },
      { id: "spacing", name: "4. Spacing", modes: [{ modeId: "mobile", name: "Mobile" }, { modeId: "tablet", name: "Tablet" }], variableIds: ["space-stack"] },
      { id: "obsolete", name: "Delete Me", modes: [{ modeId: "only", name: "Only" }], variableIds: ["obsolete-var"] },
      { id: "oldColl", name: "Old Collection", modes: [{ modeId: "only", name: "Only" }], variableIds: [] },
    ],
    textStyles: [
      { id: "txt-body", name: "type/body/md", fontName: { family: "Inter", style: "Regular" }, fontSize: 16, lineHeight: { unit: "PIXELS", value: 24 }, letterSpacing: { unit: "PIXELS", value: 0 }, description: "" },
      { id: "txt-old", name: "type/old", fontName: { family: "Inter", style: "Regular" }, fontSize: 12, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PIXELS", value: 0 }, description: "" },
      { id: "txt-delete", name: "type/delete-me", fontName: { family: "Inter", style: "Regular" }, fontSize: 12, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PIXELS", value: 0 }, description: "" },
    ],
    effectStyles: [
      { id: "eff-0", name: "elevation/0", effects: [], description: "" },
      { id: "eff-old", name: "elevation/old", effects: [], description: "" },
      { id: "eff-delete", name: "elevation/delete-me", effects: [], description: "" },
    ],
  };

  const plan = planDsFigmaOperationsFromFigmaData(figmaData, {
    operations: [
      { kind: "create_collection", name: "New Collection", modes: ["Mobile", "Desktop"] },
      { kind: "rename_collection", collection: "Old Collection", newName: "Renamed Collection" },
      { kind: "delete_collection", collection: "Delete Me" },
      { kind: "create_mode", collection: "2. Color", mode: "High Contrast" },
      { kind: "rename_mode", collection: "2. Color", mode: "Dark", newName: "Night" },
      { kind: "delete_mode", collection: "4. Spacing", mode: "Tablet" },
      {
        kind: "create_variable",
        name: "color/text/custom",
        collection: "2. Color",
        type: "COLOR",
        values: { Light: { alias: "color/neutral/950" }, Dark: { alias: "color/neutral/50" } },
      },
      {
        kind: "update_variable",
        name: "color/text/existing",
        values: { Light: { alias: "color/neutral/950" } },
      },
      { kind: "rename_variable", name: "color/text/old", newName: "color/text/renamed" },
      { kind: "delete_variable", name: "color/text/delete-me" },
      { kind: "create_variable", name: "bad/type", collection: "2. Color", type: "COLOR", values: { Light: { alias: "space/stack/md" } } },
    ],
  });

  assert.strictEqual(plan.repairPlan.counts.ready, 10);
  assert.strictEqual(plan.repairPlan.counts.blocked, 1);
  assert.strictEqual(plan.repairPlan.counts.destructive, 3);
  assert.ok(
    plan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.summaryLine.includes("Create collection New Collection")
    ),
    "planner should preview collection creation"
  );
  assert.ok(
    plan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.summaryLine.includes("Update color/text/existing")
    ),
    "planner should preview variable value updates"
  );
  assert.ok(
    plan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.destructive && change.summaryLine.includes("Delete variable color/text/delete-me")
    ),
    "planner should mark destructive variable deletes"
  );
  assert.ok(
    plan.repairPlan.designerPresentation.blocked.some(item =>
      item.errors.some(error => error.includes("not COLOR"))
    ),
    "wrong-type alias operations should be blocked"
  );

  const applyInput = {
    operations: plan.repairPlan.applyInput.operations.filter(operation =>
      ["create_variable", "update_variable", "rename_variable", "delete_variable", "create_mode"].includes(operation.kind)
    ),
  };
  assert.strictEqual(
    _validateApprovedOperations(applyInput.operations, figmaData),
    null,
    "fresh approved operations should validate against the same snapshot"
  );
  const staleData = Object.assign({}, figmaData, {
    variables: figmaData.variables.map(item =>
      item.id === "text-existing"
        ? Object.assign({}, item, { valuesByMode: { light: alias("n950"), dark: alias("n950") } })
        : item
    ),
  });
  assert.ok(
    _validateApprovedOperations(applyInput.operations, staleData).includes("changed since approval"),
    "stale value updates should be rejected before bridge apply"
  );

  const highLevelPlan = planDsFigmaOperationsFromFigmaData(figmaData, {
    operations: [
      { kind: "update_variable_metadata", name: "color/text/existing", metadata: { description: "Primary body text", scopes: ["TEXT_FILL"] } },
      { kind: "create_text_style", name: "type/display/lg", properties: { fontName: { family: "Inter", style: "Regular" }, fontSize: 48, lineHeight: { unit: "PIXELS", value: 56 }, letterSpacing: { unit: "PIXELS", value: 0 } } },
      { kind: "update_text_style", name: "type/body/md", properties: { fontSize: 17 } },
      { kind: "rename_text_style", name: "type/old", newName: "type/renamed" },
      { kind: "delete_text_style", name: "type/delete-me" },
      { kind: "create_effect_style", name: "elevation/brand", properties: { effects: [] } },
      { kind: "update_effect_style", name: "elevation/0", properties: { description: "Flat elevation" } },
      { kind: "rename_effect_style", name: "elevation/old", newName: "elevation/renamed" },
      { kind: "delete_effect_style", name: "elevation/delete-me" },
      { kind: "bind_node_variable", nodeId: "12:34", property: "fontSize", variable: "space/stack/md" },
      { kind: "unbind_node_variable", nodeId: "12:34", property: "fontSize" },
      { kind: "bind_node_paint_variable", nodeId: "12:34", paintProperty: "fills", paintIndex: 0, variable: "color/neutral/950" },
      { kind: "unbind_node_paint_variable", nodeId: "12:34", paintProperty: "fills", paintIndex: 0 },
      { kind: "bind_node_text_style", nodeId: "12:34", style: "type/body/md" },
      { kind: "unbind_node_text_style", nodeId: "12:34" },
      { kind: "bind_node_effect_style", nodeId: "12:34", style: "elevation/0" },
      { kind: "unbind_node_effect_style", nodeId: "12:34" },
      { kind: "update_collection_metadata", collection: "2. Color", metadata: { hiddenFromPublishing: true } },
      { kind: "duplicate_variable", name: "color/text/existing", newName: "color/text/copy" },
      { kind: "move_variable", name: "space/stack/md", collection: "4. Spacing", newName: "space/stack/moved", deleteOriginal: true },
      { kind: "deprecate_variable", name: "color/text/old", message: "Use color/text/renamed." },
      { kind: "retarget_variable_aliases", from: "color/neutral/50", to: "color/neutral/950", deleteOld: true },
      { kind: "create_effect_style", name: "elevation/bad" },
    ],
  });

  assert.strictEqual(highLevelPlan.repairPlan.counts.ready, 22);
  assert.strictEqual(highLevelPlan.repairPlan.counts.blocked, 1);
  assert.strictEqual(highLevelPlan.repairPlan.counts.destructive, 4);
  assert.ok(
    highLevelPlan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.summaryLine.includes("Create text style type/display/lg")
    ),
    "planner should preview text style creation"
  );
  assert.ok(
    highLevelPlan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.summaryLine.includes("Bind fills[0] on node 12:34")
    ),
    "planner should preview exact node paint bindings"
  );
  assert.ok(
    highLevelPlan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.destructive && change.summaryLine.includes("Retarget")
    ),
    "planner should mark destructive lifecycle replace/delete operations"
  );
  assert.ok(
    highLevelPlan.repairPlan.designerPresentation.blocked.some(item =>
      item.errors.some(error => error.includes("properties.effects"))
    ),
    "effect style creation without effects should be blocked"
  );
  assert.strictEqual(
    _validateApprovedOperations(highLevelPlan.repairPlan.applyInput.operations, figmaData),
    null,
    "expanded high-level operations should validate against a fresh snapshot"
  );
  const staleStyleData = Object.assign({}, figmaData, {
    textStyles: figmaData.textStyles.map(style =>
      style.id === "txt-body"
        ? Object.assign({}, style, { fontSize: 18 })
        : style
    ),
  });
  assert.ok(
    _validateApprovedOperations(highLevelPlan.repairPlan.applyInput.operations, staleStyleData).includes("style type/body/md changed since approval"),
    "stale style updates should be rejected before bridge apply"
  );

  const suspiciousRenamePlan = planDsFigmaOperationsFromFigmaData(figmaData, {
    operations: [
      { kind: "rename_variable", name: "color/fill/danger", newName: "color/fill/fill-danger" },
    ],
  });
  assert.strictEqual(suspiciousRenamePlan.repairPlan.counts.ready, 1);
  assert.strictEqual(suspiciousRenamePlan.repairPlan.counts.warnings, 1);
  assert.ok(
    suspiciousRenamePlan.repairPlan.designerPresentation.proposedChanges[0].warnings.some(warning =>
      warning.includes("repeats the fill segment") &&
      warning.includes("plan_ds_semantic_naming_consolidation")
    ),
    "duplicate semantic segment renames should be called out before approval"
  );
  assert.ok(
    suspiciousRenamePlan.repairPlan.agentInstruction.includes("do not use it to invent semantic naming migrations"),
    "generic operations guidance should preserve the semantic naming planner boundary"
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-figma-operations-"));
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
        applied: applyInput.operations.map(operation => ({ kind: operation.kind })),
        skipped: [],
        unresolved: [],
        message: `${applyInput.operations.length} operations applied.`,
      },
    },
  });

  try {
    const result = await handleApplyDsFigmaOperations({
      figmaDataPath: snapPath,
      operations: applyInput.operations,
    });
    assert.ok(!result.error, result.error);
    assert.strictEqual(result.applied.length, applyInput.operations.length);
    assert.ok(result.verificationInstruction.includes("sync_figma_data"));
    const body = readBridgeHookCapture(capturePath);
    assert.deepStrictEqual(body.operations, applyInput.operations);
  } finally {
    uninstall();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
