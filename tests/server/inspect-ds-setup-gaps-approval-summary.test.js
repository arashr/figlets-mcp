/**
 * BNN-43: designer approval summaries must list exact proposed setup repairs,
 * not only aggregate counts, while keeping repairPlan.applyInput machine-ready.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  inspectDsSetupGapsFromFigmaData,
  handleInspectDsSetupGaps,
  _buildRepairPlan,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");
const { handleFigletsWorkflowGuide } = require("../../packages/figlets-mcp-server/src/tools/agent-interface.js");
const { DESIGNER_FLOW_HARD_RULES } = require("../../packages/figlets-mcp-server/src/agent-interface/workflows.js");

function prim(id, name, r, g, b) {
  return {
    id, name, resolvedType: "COLOR", variableCollectionId: "primColl",
    valuesByMode: { primMode: { r, g, b } },
  };
}
function sem(id, name, lightVal, darkVal) {
  const valuesByMode = {};
  if (lightVal !== undefined) valuesByMode.lightId = lightVal;
  if (darkVal !== undefined) valuesByMode.darkId = darkVal;
  return { id, name, resolvedType: "COLOR", variableCollectionId: "semColl", valuesByMode };
}
function alias(id) { return { type: "VARIABLE_ALIAS", id }; }

const primitives = [
  prim("n0", "color/neutral/0", 1.00, 1.00, 1.00),
  prim("n50", "color/neutral/50", 0.98, 0.98, 0.98),
  prim("n300", "color/neutral/300", 0.78, 0.78, 0.78),
  prim("n950", "color/neutral/950", 0.05, 0.05, 0.05),
];

const contrastSemantics = [
  sem("contrastBg", "color/surface/danger", alias("n50"), alias("n950")),
  sem("contrastFg", "color/on-surface/danger", alias("n300"), alias("n0")),
  sem("orphanFg", "color/on-surface/info", alias("n950"), alias("n50")),
];

const contrastSnapshot = {
  variables: primitives.concat(contrastSemantics),
  collections: [
    { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
    { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: contrastSemantics.map(v => v.id) },
  ],
};

function universalIconFixture() {
  const pairs = [];
  for (const role of ["alpha", "beta", "gamma", "delta"]) {
    pairs.push({
      id: `bg-${role}`, name: `color/surface/${role}`, resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: alias("n50"), darkId: alias("n950") },
    });
    pairs.push({
      id: `fg-${role}`, name: `color/on-surface/${role}`, resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: alias("n950"), darkId: alias("n50") },
    });
  }
  return {
    variables: primitives.concat(pairs),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: pairs.map(v => v.id) },
    ],
  };
}

module.exports = (() => {
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-bnn43-contrast-"));
    const snapPath = path.join(tmp, "figma-data.json");
    fs.writeFileSync(snapPath, JSON.stringify(contrastSnapshot), "utf8");
    const prevLocal = process.env.FIGLETS_LOCAL_DIR;
    const prevFig = process.env.FIGLETS_FIGMA_DATA_PATH;
    process.env.FIGLETS_LOCAL_DIR = tmp;
    process.env.FIGLETS_FIGMA_DATA_PATH = snapPath;
    try {
      const handled = handleInspectDsSetupGaps({ figmaDataPath: snapPath });
      assert.ok(!handled.error);
      const plan = handled.repairPlan;
      const presentation = plan.designerPresentation;
      const ready = presentation.proposedChanges.readyToApply;

      assert.ok(ready.length >= 1, "should expose at least one ready-to-apply change line");
      const contrastReAlias = ready.find(change =>
        change.token === "color/on-surface/danger"
        && change.action === "re-alias"
        && change.modes.some(mode => mode.mode === "Light" && mode.from === "color/neutral/300" && mode.target === "color/neutral/950")
      );
      assert.ok(contrastReAlias, "should include exact contrast re-alias details");
      assert.strictEqual(contrastReAlias.reason, "contrast fix");
      assert.ok(
        presentation.sections.some(section => section.title === "What will change (ready to apply)"),
        "should include a What will change section"
      );
      assert.ok(
        presentation.sections.find(section => section.title === "What will change (ready to apply)").items
          .some(line => line.includes("color/on-surface/danger") && line.includes("color/neutral/300")),
        "section items should mirror exact repair lines"
      );
      assert.ok(
        presentation.sections.some(section => section.title === "Needs your call (not in apply payload)"),
        "missing-background decisions should be separated from apply-ready changes"
      );
      assert.ok(
        !ready.some(change => change.token === "color/on-surface/info"),
        "needs-designer-decision tokens must not appear in ready-to-apply list"
      );
      assert.deepStrictEqual(
        plan.applyInput.aliasUpdates.find(update => update.token === "color/on-surface/danger"),
        {
          token: "color/on-surface/danger",
          mode: "Light",
          newAliasTarget: "color/neutral/950",
          expectedCurrentAlias: "color/neutral/300",
        },
        "structured apply payload must remain unchanged"
      );
      assert.ok(
        plan.agentInstruction.includes("proposedChanges.readyToApply"),
        "agent instruction should require exact change listing before approval"
      );
    } finally {
      if (prevLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocal;
      else delete process.env.FIGLETS_LOCAL_DIR;
      if (prevFig !== undefined) process.env.FIGLETS_FIGMA_DATA_PATH = prevFig;
      else delete process.env.FIGLETS_FIGMA_DATA_PATH;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const universal = inspectDsSetupGapsFromFigmaData(universalIconFixture());
    const plan = _buildRepairPlan(universal);
    const ready = plan.designerPresentation.proposedChanges.readyToApply;
    const optional = plan.designerPresentation.proposedChanges.optional;

    assert.strictEqual(ready.length, 4, "should list each required icon role creation");
    assert.strictEqual(optional.length, 4, "should list each optional border role separately");
    assert.ok(
      ready.every(change => change.action === "create role" && change.token.startsWith("color/icon/")),
      "ready changes should be icon role creations"
    );
    assert.ok(
      optional.every(change => change.action === "create role" && change.token.startsWith("color/border/")),
      "optional changes should be border role creations"
    );
    assert.ok(
      ready.some(change =>
        change.token === "color/icon/alpha"
        && change.modes.some(mode => mode.mode === "Light" && mode.target === "color/neutral/950")
      ),
      "ready line should include per-mode alias targets"
    );
    assert.ok(
      optional.some(change =>
        change.token === "color/border/alpha"
        && change.modes.some(mode => mode.mode === "Light" && mode.target === "color/neutral/300")
      ),
      "optional line should include per-mode alias targets"
    );
    assert.deepStrictEqual(
      plan.applyInput.roleRepairs.map(repair => repair.name).sort(),
      ["color/icon/alpha", "color/icon/beta", "color/icon/delta", "color/icon/gamma"],
      "applyInput should still carry exact role repair payloads"
    );
  }

  {
    const guide = handleFigletsWorkflowGuide({ workflow_id: "health-check" });
    const approveStep = guide.workflow.steps.find(step => step.id === "approve-repairs");
    assert.ok(approveStep.designerMessage.includes("each exact proposed change"));
    assert.ok(guide.presentationRule.includes("What will change"));
    assert.ok(DESIGNER_FLOW_HARD_RULES.designerPresentationRule.includes("proposedChanges"));
  }
})();
