const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  handleApplySemanticNamingConsolidation,
  planSemanticNamingConsolidationFromFigmaData,
  _normalizeRenameVariables,
  _validateRenameVariables,
} = require("../../packages/figlets-mcp-server/src/tools/semantic-naming-consolidation.js");
const { createBridgeHookFile, readBridgeHookCapture, setBridgeHookRoute } = require("../helpers/bridge-hook.js");

function prim(id, name, r, g, b) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "primColl",
    valuesByMode: { primMode: { r, g, b } },
  };
}

function sem(id, name, lightVal, darkVal) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "semColl",
    valuesByMode: { lightId: lightVal, darkId: darkVal },
  };
}

function alias(id) {
  return { type: "VARIABLE_ALIAS", id };
}

const primitives = [
  prim("r700", "color/red/700", 0.55, 0.1, 0.1),
  prim("r200", "color/red/200", 0.95, 0.7, 0.7),
  prim("n50", "color/neutral/50", 0.98, 0.98, 0.98),
  prim("n950", "color/neutral/950", 0.05, 0.05, 0.05),
  prim("b700", "color/blue/700", 0.1, 0.2, 0.7),
  prim("b200", "color/blue/200", 0.7, 0.8, 0.98),
];

const semantics = [
  sem("bg-danger", "color/bg/danger", alias("r700"), alias("r200")),
  sem("bg-on-danger", "color/bg/on-danger", alias("r700"), alias("r200")),
  sem("fill-danger", "color/fill/danger", alias("r700"), alias("r200")),
  sem("text-danger", "color/text/danger", alias("n950"), alias("n50")),
  sem("text-on-danger", "color/text/on-danger", alias("n950"), alias("n50")),
  sem("icon-danger", "color/icon/danger", alias("n950"), alias("n50")),
  sem("icon-on-danger", "color/icon/on-danger", alias("r700"), alias("n50")),
  sem("bg-info", "color/bg/info", alias("b700"), alias("b200")),
  sem("fill-info", "color/fill/info", alias("b700"), alias("b200")),
  sem("valid-text", "color/text/valid-but-not-a-conflict", alias("n950"), alias("n50")),
  sem("valid-text-copy", "color/text/valid-but-not-a-conflict-copy", alias("n950"), alias("n50")),
];

const figmaData = {
  variables: primitives.concat(semantics),
  collections: [
    { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
    { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: semantics.map(v => v.id) },
  ],
};

module.exports = (async () => {
  {
    const surfaceAndOnFillSemantics = [
      sem("bg-danger", "color/bg/danger", alias("r700"), alias("r200")),
      sem("text-danger", "color/text/danger", alias("n950"), alias("n50")),
      sem("icon-danger", "color/icon/danger", alias("n950"), alias("n50")),
      sem("fill-danger", "color/fill/danger", alias("r700"), alias("r200")),
      sem("text-on-fill-danger", "color/text/on-fill-danger", alias("n50"), alias("n950")),
      sem("icon-on-fill-danger", "color/icon/on-fill-danger", alias("n50"), alias("n950")),
    ];
    const surfaceAndOnFillData = {
      variables: primitives.concat(surfaceAndOnFillSemantics),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: surfaceAndOnFillSemantics.map(v => v.id) },
      ],
    };
    const plan = planSemanticNamingConsolidationFromFigmaData(surfaceAndOnFillData, { canonicalConvention: "surface-based" });
    assert.deepStrictEqual(
      plan.repairPlan.applyInput.renameVariables,
      [],
      "surface-based consolidation should not deprecate distinct on-fill roles"
    );
  }

  {
    const plan = planSemanticNamingConsolidationFromFigmaData(figmaData, { canonicalConvention: "surface-based" });
    assert.strictEqual(plan.dryRun, true);
    assert.strictEqual(plan.repairPlan.tool, "apply_ds_semantic_naming_consolidation");
    assert.strictEqual(plan.repairPlan.applyInput.canonicalConvention, "surface-based");
    assert.ok(
      !JSON.stringify(plan.repairPlan.applyInput).includes("delete"),
      "safe apply payload must not include destructive deletes"
    );

    const renameNames = plan.repairPlan.applyInput.renameVariables.map(item => item.expectedCurrentName).sort();
    assert.deepStrictEqual(renameNames, [
      "color/bg/on-danger",
    ]);
    const bgRename = plan.repairPlan.applyInput.renameVariables.find(item => item.expectedCurrentName === "color/bg/on-danger");
    assert.strictEqual(bgRename.canonicalName, "color/bg/danger");
    assert.strictEqual(bgRename.canonicalId, "bg-danger");
    assert.strictEqual(bgRename.newName, "_deprecated/color/bg/on-danger");
    assert.strictEqual(bgRename.expectedEquivalence.status, "equivalent");
    assert.ok(bgRename.expectedEquivalence.modes.every(mode => mode.canonicalSignature === mode.duplicateSignature));
    assert.ok(bgRename.reason.includes("preserve"), "rename reason should explain ID preservation");

    assert.ok(
      plan.semanticNamingAdvisories.some(item => item.token === "color/text/on-danger" && item.kind === "ambiguous-name"),
      "ambiguous text/on-danger should remain a review advisory instead of an automatic rename"
    );
    assert.ok(
      plan.semanticNamingAdvisories.some(item => item.token === "color/icon/on-danger" && item.kind === "ambiguous-name"),
      "ambiguous icon/on-danger should remain a review advisory instead of an automatic rename"
    );

    assert.ok(
      !renameNames.includes("color/fill/info"),
      "color/fill/* should not be treated as an equal competitor to color/bg/*"
    );
    assert.ok(
      plan.repairPlan.designerPresentation.proposedChanges.some(item => item.summaryLine.includes("color/bg/on-danger")),
      "designer presentation should list exact invalid variable names"
    );
  }

  {
    const plan = planSemanticNamingConsolidationFromFigmaData(figmaData, { canonicalConvention: "role-based" });
    const renameNames = plan.repairPlan.applyInput.renameVariables.map(item => item.expectedCurrentName).sort();
    assert.deepStrictEqual(renameNames, [
      "color/bg/danger",
      "color/bg/on-danger",
    ]);
    const bgRename = plan.repairPlan.applyInput.renameVariables.find(item => item.expectedCurrentName === "color/bg/danger");
    assert.strictEqual(bgRename.canonicalName, "color/fill/danger", "role-based background consolidation should prefer existing fill/*, not invalid bg/on-*");
    const invalidBgRename = plan.repairPlan.applyInput.renameVariables.find(item => item.expectedCurrentName === "color/bg/on-danger");
    assert.strictEqual(invalidBgRename.canonicalName, "color/fill/danger", "role-based consolidation must not leave invalid bg/on-* silently unresolved");
  }

  {
    const plan = planSemanticNamingConsolidationFromFigmaData(figmaData, { canonicalConvention: "surface-based" });
    const validRename = plan.repairPlan.applyInput.renameVariables.find(item => item.expectedCurrentName === "color/bg/on-danger");
    assert.deepStrictEqual(
      _normalizeRenameVariables([Object.assign({}, validRename, { extra: true })]),
      [Object.assign({}, validRename)]
    );
    assert.strictEqual(_validateRenameVariables([validRename]), null);
    assert.ok(
      _validateRenameVariables([Object.assign({}, validRename, { newName: "_deprecated/color/anything/else" })]).includes("newName must exactly equal"),
      "server validation should reject invented compatibility names"
    );
    assert.ok(
      _validateRenameVariables([Object.assign({}, validRename, { expectedCurrentName: "space/radius/md", newName: "_deprecated/space/radius/md" })]).includes("expectedCurrentName"),
      "server validation should reject non-color semantic duplicate names"
    );
  }

  {
    const plan = planSemanticNamingConsolidationFromFigmaData(figmaData, { canonicalConvention: "surface-based" });
    const validRename = plan.repairPlan.applyInput.renameVariables.find(item => item.expectedCurrentName === "color/bg/on-danger");
    const arbitrary = await handleApplySemanticNamingConsolidation({
      canonicalConvention: "surface-based",
      renameVariables: [{
        id: "whatever",
        expectedCurrentName: "space/radius/md",
        newName: "_deprecated/space/radius/md",
        canonicalName: "space/radius/lg",
        canonicalId: "whatever-canonical",
        expectedEquivalence: validRename.expectedEquivalence,
      }],
    });
    assert.ok(arbitrary.error.includes("Invalid semantic naming consolidation payload"), "apply should reject arbitrary variable rename payloads before the bridge");
  }

  {
    const plan = planSemanticNamingConsolidationFromFigmaData(figmaData, { canonicalConvention: "surface-based" });
    const validRename = plan.repairPlan.applyInput.renameVariables.find(item => item.expectedCurrentName === "color/bg/on-danger");
    const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-semantic-naming-data-"));
    const figmaDataPath = path.join(tmpData, "figma-data.json");
    fs.writeFileSync(figmaDataPath, JSON.stringify(figmaData), "utf8");
    const inventedButSemantic = Object.assign({}, validRename, {
      id: "valid-text-copy",
      expectedCurrentName: "color/text/valid-but-not-a-conflict-copy",
      newName: "_deprecated/color/text/valid-but-not-a-conflict-copy",
      canonicalName: "color/text/valid-but-not-a-conflict",
      canonicalId: "valid-text",
    });
    const invented = await handleApplySemanticNamingConsolidation({
      canonicalConvention: "surface-based",
      renameVariables: [inventedButSemantic],
      figmaDataPath,
    });
    assert.ok(
      invented.error.includes("not present in the fresh semantic naming consolidation plan"),
      "apply should reject hand-built semantic-looking renames that were not emitted by the fresh planner"
    );
  }

  {
    const plan = planSemanticNamingConsolidationFromFigmaData(figmaData, { canonicalConvention: "surface-based" });
    const validRename = plan.repairPlan.applyInput.renameVariables.find(item => item.expectedCurrentName === "color/bg/on-danger");
    const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-semantic-naming-data-"));
    const figmaDataPath = path.join(tmpData, "figma-data.json");
    fs.writeFileSync(figmaDataPath, JSON.stringify(figmaData), "utf8");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-semantic-naming-"));
    const hookPath = createBridgeHookFile(tmp);
    const capturePath = path.join(tmp, "capture.json");
    setBridgeHookRoute(hookPath, "/request-semantic-naming-consolidation", {
      statusCode: 200,
      capturePath,
      json: {
        success: true,
        result: {
          renamed: [{ id: "bg-on-danger", from: "color/bg/on-danger", to: "_deprecated/color/bg/on-danger", canonicalName: "color/bg/danger", preservesVariableId: true }],
          skipped: [],
          unresolved: [],
          message: "1 renamed, 0 skipped, 0 unresolved.",
        },
      },
    });
    const result = await handleApplySemanticNamingConsolidation({
      canonicalConvention: "surface-based",
      renameVariables: [validRename],
      figmaDataPath,
      bridgeHookFile: hookPath,
    });
    assert.strictEqual(result.renamed.length, 1);
    assert.ok(
      result.message.includes("naming-only compatibility result"),
      "apply result should not imply the whole design system is clean"
    );
    assert.ok(
      result.verificationInstruction.includes("sync_figma_data, detect_design_system, audit_tokens, then inspect_ds_setup_gaps"),
      "apply result should tell agents to rerun the same health-check sequence"
    );
    assert.ok(
      result.verificationInstruction.includes("Report semanticNamingConflicts separately from audit token hygiene"),
      "apply result should tell agents to separate naming verification from remaining health-check findings"
    );
    const captured = readBridgeHookCapture(capturePath);
    assert.strictEqual(captured.renameVariables[0].expectedCurrentName, "color/bg/on-danger");
    assert.strictEqual(captured.renameVariables[0].newName, "_deprecated/color/bg/on-danger");
    assert.strictEqual(captured.renameVariables[0].canonicalId, "bg-danger");
    assert.strictEqual(captured.renameVariables[0].expectedEquivalence.status, "equivalent");
  }
})();
