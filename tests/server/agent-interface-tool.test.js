const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-agent-interface-test-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/agent-interface/workflows.js",
  "../../packages/figlets-mcp-server/src/tools/agent-interface.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });

const {
  DESIGNER_FLOW_HARD_RULES,
  WORKFLOWS,
  MUTATING_TOOLS,
  getStartGuide,
  getWorkflowGuide,
  routeIntent,
} = require("../../packages/figlets-mcp-server/src/agent-interface/workflows.js");

const {
  figletsStartTool,
  figletsRouteIntentTool,
  figletsWorkflowGuideTool,
  handleFigletsStart,
  handleFigletsRouteIntent,
  handleFigletsWorkflowGuide,
} = require("../../packages/figlets-mcp-server/src/tools/agent-interface.js");

function allSteps() {
  return WORKFLOWS.flatMap(workflow => (workflow.steps || []).map(step => ({ workflow, step })));
}

try {
  {
    assert.ok(figletsStartTool.description.includes("not custom scripts"));
    assert.ok(figletsRouteIntentTool.description.includes("before any design-system review scripting"));
    assert.ok(figletsWorkflowGuideTool.description.includes("named Figlets tools/scripts only"));
  }

  {
    const start = getStartGuide();
    assert.strictEqual(start.environment.command, "figlets-mcp");
    assert.strictEqual(start.environment.localDir, TEMP_DIR);
    assert.strictEqual(start.environment.activeFileKnown, false);
    assert.strictEqual(start.responseContract.openingFormat, "capability-menu");
    assert.ok(start.responseContract.useVerbatimWhenPossible.includes("generic help"));
    assert.strictEqual(start.responseContract.mode, "designer-facing");
    assert.ok(start.responseContract.designSystemReviewRule.includes("Use Figlets workflow tools/scripts only"));
    assert.ok(start.responseContract.bulkUpdateRule.includes("Bulk design-system updates"));
    assert.ok(start.responseContract.bulkUpdateRule.includes("product/tool gap"));
    assert.ok(start.responseContract.nextAction.includes("For a concrete initial goal, route it before replying"));
    assert.strictEqual(start.hardRules.reviewMustUseFigletsWorkflow, true);
    assert.strictEqual(start.hardRules.bulkDesignSystemUpdatesAreInScope, true);
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("apply_ds_setup_repairs")));
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("update_ds_primitives")));
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("qa_binding_audit")));
    assert.ok(start.hardRules.appliesTo.includes("design-system review"));
    assert.ok(start.hardRules.forbiddenUnlessDesignerExplicitlyAsksOutOfBounds.some(item => item.includes("custom scripts")));
    assert.ok(start.hardRules.forbiddenUnlessDesignerExplicitlyAsksOutOfBounds.some(item => item.includes("figma-data.json")));
    assert.ok(start.safety.some(item => item.includes("must use the Figlets workflow")));
    assert.ok(start.safety.some(item => item.includes("bulk design-system repairs")));
    assert.ok(start.designerResponse.startsWith("# Figlets"));
    assert.ok(start.designerResponse.includes("A focused toolkit for checking, repairing, showcasing, documenting, and exporting Figma design systems."));
    assert.ok(!start.designerResponse.includes("Hi, I'm Figlets"));
    assert.ok(start.designerResponse.includes("| What you can ask for | What I'll do |"));
    assert.ok(start.designerResponse.includes("Check my design system"));
    assert.ok(!start.designerResponse.includes("Fix setup gaps"));
    assert.ok(!start.designerResponse.includes("Plugin / MCP server code"));
    assert.ok(!start.designerResponse.includes("Edit repo files"));
    assert.ok(start.designerResponse.includes("I'll inspect first"));
    assert.ok(!start.designerResponse.includes("What would you like to do first?"));
    assert.ok(start.capabilityMenu.every(item => item.workflowId && item.label && item.description));
    assert.ok(start.forbiddenDesignerMenuItems.includes("Plugin / MCP server code"));
    assert.ok(start.forbiddenDesignerMenuItems.includes("Edit repo files"));
    assert.ok(start.scope.figletsDoesNotMean.some(item => item.includes("generic Figma create")));
    assert.ok(start.scope.figletsDoes.some(item => item.includes("Structured bulk design-system updates")));
    assert.ok(start.scope.figletsDoesNotMean.some(item => item.includes("plugin code")));
    assert.ok(start.scope.figletsDoesNotMean.some(item => item.includes("figma-console")));
    assert.ok(!start.capabilities.some(item => item.id === "setup-gap-qa"));
  }

  {
    const route = routeIntent("review my design system using Figlets");
    assert.strictEqual(route.workflow.id, "health-check");
    assert.ok(route.message.includes("Use Figlets workflow tools/scripts only"));
    assert.strictEqual(route.hardRules.reviewMustUseFigletsWorkflow, true);
    assert.strictEqual(route.selectionPrompt, null);
    assert.ok(route.designerResponse.startsWith("# Figlets"));
    assert.ok(route.designerResponse.includes("I'll review your design system using the Figlets health check."));
    assert.ok(route.designerResponse.includes("1. Sync the current Figma file"));
    assert.ok(!route.designerResponse.includes("| What you can ask for |"));
  }

  {
    const route = routeIntent("help me choose what to do");
    assert.ok(route.selectionPrompt, "ambiguous or generic requests should expose a structured selection prompt");
    assert.strictEqual(route.selectionPrompt.type, "single-choice");
    assert.ok(route.selectionPrompt.choices.length >= 3);
    assert.ok(route.selectionPrompt.choices.some(choice => choice.id === "health-check"));
    assert.ok(route.selectionPrompt.choices.some(choice => choice.id === "build-showcase"));
    assert.ok(route.selectionPrompt.message.includes("Choose one:"));
    assert.strictEqual(route.designerResponse, route.selectionPrompt.message);
  }

  {
    const route = routeIntent("Please generate docs for this Button component.");
    assert.strictEqual(route.workflow.id, "component-docs");
  }

  {
    const guide = getWorkflowGuide("health-check");
    const tools = guide.steps.map(step => step.tool).filter(Boolean);
    assert.deepStrictEqual(tools, [
      "sync_figma_data",
      "detect_design_system",
      "audit_tokens",
      "inspect_ds_setup_gaps",
      "apply_ds_setup_repairs",
      "inspect_ds_setup_gaps",
    ]);
    assert.ok(guide.summary.includes("semantic setup"));
    assert.ok(guide.steps.some(step => step.id === "semantic-setup-qa" && step.kind === "read"));
    assert.ok(guide.steps.some(step => step.id === "approve-repairs" && step.kind === "confirmation" && step.designerMessage.includes("bulk repair plan")));
    assert.ok(guide.steps.some(step => step.tool === "apply_ds_setup_repairs" && step.requiresApproval === true && step.designerMessage.includes("bulk-safe")));
    assert.ok(!guide.next.includes("setup-gap-qa"));
  }

  {
    assert.strictEqual(DESIGNER_FLOW_HARD_RULES.reviewMustUseFigletsWorkflow, true);
    assert.ok(
      DESIGNER_FLOW_HARD_RULES.missingCapabilityResponse.includes("product/tool gap"),
      "hard rules should tell weaker agents not to invent a script when Figlets output is missing data"
    );
    const handled = handleFigletsWorkflowGuide({ workflow_id: "health-check" });
    assert.strictEqual(handled.hardRules.reviewMustUseFigletsWorkflow, true);
    assert.strictEqual(handled.hardRules.bulkDesignSystemUpdatesAreInScope, true);
    assert.ok(handled.message.includes("use the named Figlets tools/scripts only"));
    assert.ok(handled.message.includes("structured bulk repair payloads"));
  }

  {
    const guide = getWorkflowGuide("build-showcase");
    assert.strictEqual(guide.id, "build-showcase");
    assert.ok(guide.steps.some(step => step.tool === "build_ds_showcase" && step.requiresApproval === true));
    assert.ok(guide.next.includes("export-design-md"));
  }

  {
    for (const { workflow, step } of allSteps()) {
      if (step.kind === "write" || MUTATING_TOOLS.has(step.tool)) {
        assert.strictEqual(
          step.requiresApproval,
          true,
          `${workflow.id}.${step.id} mutates Figma and must require approval`
        );
      }
    }
  }

  {
    for (const workflow of WORKFLOWS) {
      const steps = workflow.steps || [];
      assert.ok(steps.length > 0, `${workflow.id} should have steps`);
      const first = steps[0];
      assert.ok(
        first.kind === "read" || first.kind === "confirmation",
        `${workflow.id} should start with read-only work or designer confirmation`
      );
    }
  }

  {
    const publicPayload = JSON.stringify({
      start: handleFigletsStart(),
      route: handleFigletsRouteIntent({ intent: "export design.md" }),
      guide: handleFigletsWorkflowGuide({ workflow_id: "export-design-md" }),
    });
    assert.ok(!/\/(Users|home)\/[^"\\/]+/.test(publicPayload), "Agent Interface should not hardcode developer-local home paths");
  }

} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
}
