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
  figletsHealthCheckTool,
  handleFigletsStart,
  handleFigletsRouteIntent,
  handleFigletsWorkflowGuide,
  handleFigletsHealthCheck,
} = require("../../packages/figlets-mcp-server/src/tools/agent-interface.js");

function allSteps() {
  return WORKFLOWS.flatMap(workflow => (workflow.steps || []).map(step => ({ workflow, step })));
}

try {
  {
    assert.ok(figletsStartTool.description.includes("not custom scripts"));
    assert.ok(figletsRouteIntentTool.description.includes("before any design-system review scripting"));
    assert.ok(figletsWorkflowGuideTool.description.includes("named Figlets tools/scripts only"));
    assert.ok(figletsHealthCheckTool.description.includes("Read-only Agent Interface health check"));
    assert.ok(figletsHealthCheckTool.description.includes("setup intake and proposal boundaries"));
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
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("optionalApplyInput")));
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("missingCapabilityNotes")));
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("update_ds_primitives")));
    assert.ok(
      start.hardRules.supportedBulkUpdateSurfaces.some(item =>
        item.includes("update_ds_primitives") && item.includes("color-semantics")
      ),
      "bulk surfaces should list update_ds_primitives categories including color-semantics"
    );
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("update_ds_tokens")));
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("apply_ds_foundation_repairs")));
    assert.ok(start.hardRules.supportedBulkUpdateSurfaces.some(item => item.includes("qa_binding_audit")));
    assert.ok(Array.isArray(start.hardRules.bulkRepairRouting) && start.hardRules.bulkRepairRouting.length >= 4);
    assert.ok(start.hardRules.bulkRepairRouting.some(item => item.includes("repairPlan.applyInput")));
    assert.ok(start.hardRules.bulkRepairRouting.some(item => item.includes("pass that exact object")));
    assert.ok(start.hardRules.bulkRepairRouting.some(item => item.includes("Never replace setup repair aliases with counts")));
    assert.ok(start.hardRules.bulkRepairRouting.some(item => item.includes("schema validation rejects")));
    assert.strictEqual(start.hardRules.setupRepairPayloadHandoff.source, "inspect_ds_setup_gaps.repairPlan.applyInput");
    assert.strictEqual(start.hardRules.setupRepairPayloadHandoff.preserveAliases, true);
    assert.ok(start.hardRules.setupRepairPayloadHandoff.invalidPayloadRecovery.includes("rerun inspect_ds_setup_gaps"));
    assert.ok(start.hardRules.bulkRepairRouting.some(item => item.includes("fixableNow")));
    assert.ok(start.responseContract.bulkUpdateRule.includes("inspect_ds_token_gaps"));
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
    const route = routeIntent("add missing typography and spacing tokens");
    assert.strictEqual(route.workflow.id, "token-gap-completion");
  }

  {
    const posterGalleryIntent =
      "using figlets set up a new design system with multiple vibrant colors as backgrounds and some matching vibrant colors to pair with them as foreground. The ds is called Poster Gallery.";
    const route = routeIntent(posterGalleryIntent);
    assert.strictEqual(route.workflow.id, "new-ds-setup");
    assert.ok(route.intakeContract);
    assert.ok(route.intakeContract.firstResponseRule.includes("intake questions"));
    assert.ok(route.intakeContract.doNotDraftBeforeIntake.some(item => /palette|proposal/i.test(item)));
    assert.ok(route.message.includes("do not draft a full proposal"));
    assert.ok(route.designerResponse.includes("start by asking"));
    assert.ok(route.designerResponse.includes("won't draft"));
    assert.ok(route.designerResponse.includes("not a proposal to approve"));
    assert.ok(!route.designerResponse.includes("1. I'll compute and preview"));
  }

  {
    const negativeRoutes = [
      ["using figlets build a token showcase for vibrant colors", "build-showcase"],
      ["using figlets export DESIGN.md for background colors", "export-design-md"],
      ["using figlets check foreground contrast in my design system", "health-check"],
      ["using figlets add missing background/foreground color roles", "health-check"],
    ];
    for (const [intent, expectedWorkflowId] of negativeRoutes) {
      const route = routeIntent(intent);
      assert.strictEqual(
        route.workflow.id,
        expectedWorkflowId,
        `intent should route to ${expectedWorkflowId}: ${intent}`
      );
    }
  }

  {
    const guide = getWorkflowGuide("new-ds-setup");
    assert.ok(guide.intakeContract);
    assert.ok(guide.intakeContract.requiredTopics.length >= 8);
    assert.ok(guide.steps.some(step => step.id === "collect-answers" && step.requiredBeforeTool === "prepare_ds_config"));
    assert.ok(guide.steps.some(step => step.id === "optional-design-md-intake" && step.optional === true && step.designerMessage.includes("just drop it in")));
    assert.ok(guide.errors.some(item => item.includes("Do not invent missing brand colors")));
    const handled = handleFigletsWorkflowGuide({ workflow_id: "new-ds-setup" });
    assert.ok(handled.intakeContract);
    assert.ok(handled.intakePresentationRule.includes("intake questions"));
    assert.ok(handled.message.includes("do not draft a full proposal"));
  }

  {
    const health = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        workflowId: "new-ds-setup",
        goal: "set up Poster Gallery design system",
      },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        setupIntakeCompleted: false,
        proposalDraftedBeforeIntake: true,
      },
    });
    assert.strictEqual(health.status, "blocked");
    const proposal = health.checks.find(check => check.id === "setup_proposal_boundary");
    assert.strictEqual(proposal.status, "fail");
    assert.ok(proposal.nextAction.includes("targeted intake questions"));
    assert.strictEqual(health.nextAction.type, "ask_user");
  }

  {
    const health = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        workflowId: "new-ds-setup",
        goal: "set up Poster Gallery design system",
      },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        setupIntakeCompleted: false,
      },
      requestedAction: {
        tool: "prepare_ds_config",
        kind: "read",
      },
    });
    assert.strictEqual(health.status, "blocked");
    const intake = health.checks.find(check => check.id === "setup_intake_boundary");
    assert.strictEqual(intake.status, "fail");
    assert.ok(intake.nextAction.includes("Ask targeted setup intake questions"));
    assert.strictEqual(health.nextAction.type, "ask_user");
  }

  {
    const guide = getWorkflowGuide("token-gap-completion");
    assert.ok(guide.steps.some(step => step.tool === "inspect_ds_token_gaps"));
    assert.ok(guide.steps.some(step => step.tool === "update_ds_tokens" && step.options && step.options.dry_run === true));
    assert.ok(guide.steps.some(step => step.tool === "update_ds_primitives" && step.options && step.options.dry_run === true));
    assert.ok(guide.steps.some(step => step.tool === "update_ds_tokens" && step.requiresApproval === true));
    assert.ok(guide.steps.some(step => step.tool === "update_ds_primitives" && step.requiresApproval === true));
    assert.ok(guide.steps.some(step => step.tool === "apply_ds_foundation_repairs" && step.requiresApproval === true));
    const approveStep = guide.steps.find(step => step.id === "approve-token-plan");
    assert.ok(approveStep.designerMessage.includes("not permission to write"));
    assert.ok(guide.approvalContract && guide.approvalContract.goalPhraseIsNotApproval === true);

    const route = routeIntent("complete missing config-backed tokens");
    assert.strictEqual(route.workflow.id, "token-gap-completion");
    assert.ok(route.designerResponse.includes("will not change Figma until you explicitly approve"));
    assert.ok(route.designerResponse.includes("not approval to write"));

    const handled = handleFigletsWorkflowGuide({ workflow_id: "token-gap-completion" });
    assert.ok(handled.approvalContract);
    assert.ok(handled.message.includes("dry_run:false"));
    assert.ok(handled.message.includes("Routing goal phrases are not approval"));
  }

  {
    const qaGuide = getWorkflowGuide("qa-binding-audit");
    assert.ok(qaGuide.steps.some(step => step.designerMessage.includes("fixableNow")));
    assert.ok(qaGuide.errors.some(item => item.includes("needsExistingToken")));
    const handled = handleFigletsWorkflowGuide({ workflow_id: "qa-binding-audit" });
    assert.ok(handled.bulkRepairRouting.length >= 4);
    assert.ok(handled.presentationRule.includes("byFixability"));
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
      "plan_ds_semantic_naming_consolidation",
      "apply_ds_semantic_naming_consolidation",
    ]);
    const verifyStep = guide.steps.find(step => step.id === "verify-health-check");
    assert.deepStrictEqual(verifyStep.tools, ["sync_figma_data", "detect_design_system", "audit_tokens", "inspect_ds_setup_gaps"]);
    assert.ok(guide.summary.includes("semantic setup"));
    assert.ok(guide.steps.some(step => step.id === "semantic-setup-qa" && step.kind === "read"));
    assert.ok(guide.steps.some(step => step.id === "approve-repairs" && step.kind === "confirmation" && step.designerMessage.includes("each exact proposed change")));
    assert.ok(guide.steps.some(step => step.tool === "apply_ds_setup_repairs" && step.requiresApproval === true && step.designerMessage.includes("repairPlan.applyInput")));
    assert.ok(guide.steps.some(step => step.tool === "apply_ds_setup_repairs" && step.designerMessage.includes("preserving each aliases object unchanged")));
    assert.ok(guide.steps.some(step => step.tool === "plan_ds_semantic_naming_consolidation" && step.kind === "read"));
    assert.ok(guide.steps.some(step => step.tool === "apply_ds_semantic_naming_consolidation" && step.requiresApproval === true && step.designerMessage.includes("preserve variable IDs")));
    assert.ok(verifyStep.designerMessage.includes("same read-only health-check sequence"));
    assert.ok(verifyStep.designerMessage.includes("sync_figma_data, detect_design_system, audit_tokens, then inspect_ds_setup_gaps"));
    assert.ok(verifyStep.designerMessage.includes("will not call the file clean"));
    assert.ok(!guide.next.includes("setup-gap-qa"));
  }

  {
    assert.strictEqual(DESIGNER_FLOW_HARD_RULES.reviewMustUseFigletsWorkflow, true);
    assert.ok(
      DESIGNER_FLOW_HARD_RULES.missingCapabilityResponse.includes("product/tool gap"),
      "hard rules should tell weaker agents not to invent a script when Figlets output is missing data"
    );
    assert.ok(
      DESIGNER_FLOW_HARD_RULES.designerPresentationRule.includes("repairPlan.designerPresentation"),
      "hard rules should keep designer-facing summaries human-readable"
    );
    const handled = handleFigletsWorkflowGuide({ workflow_id: "health-check" });
    assert.strictEqual(handled.hardRules.reviewMustUseFigletsWorkflow, true);
    assert.strictEqual(handled.hardRules.bulkDesignSystemUpdatesAreInScope, true);
    assert.ok(handled.message.includes("use the named Figlets tools/scripts only"));
    assert.ok(handled.message.includes("bulkRepairRouting"));
    assert.ok(handled.message.includes("structured repairPlan payloads"));
    assert.ok(handled.presentationRule.includes("designerPresentation"));
    assert.ok(handled.presentationRule.includes("What will change"));
    assert.ok(handled.presentationRule.includes("Avoid technical verification matrices"));
  }

  {
    const health = handleFigletsHealthCheck({});
    assert.strictEqual(health.boundaries.readOnly, true);
    assert.strictEqual(health.boundaries.figmaMutationAllowed, false);
    assert.strictEqual(health.boundaries.hostSpecificBehavior, false);
    assert.strictEqual(health.status, "needs_input");
    assert.strictEqual(health.nextAction.tool, "figlets_start");
    assert.ok(health.checks.some(check => check.id === "designer_mode_entrypoint"));
  }

  {
    const health = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        goal: "review my design system",
      },
      workflowState: {
        figletsStartCalled: false,
        routeIntentCalled: false,
        workflowGuideCalled: false,
      },
    });
    assert.strictEqual(health.status, "blocked");
    assert.ok(health.blockingReasons.some(reason => reason.includes("figlets_start")));
    const entrypoint = health.checks.find(check => check.id === "designer_mode_entrypoint");
    assert.strictEqual(entrypoint.status, "fail");
    assert.strictEqual(entrypoint.recommendedTool, "figlets_start");
    const routing = health.checks.find(check => check.id === "concrete_goal_routing");
    assert.strictEqual(routing.status, "fail");
  }

  {
    const health = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        workflowId: "health-check",
      },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        completedTools: ["sync_figma_data"],
        pendingWriteTool: "apply_ds_setup_repairs",
        approvalStatus: "needed",
      },
      requestedAction: {
        tool: "apply_ds_setup_repairs",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
      },
    });
    assert.strictEqual(health.status, "blocked");
    const sequence = health.checks.find(check => check.id === "workflow_tool_sequence");
    assert.strictEqual(sequence.status, "warn");
    assert.strictEqual(sequence.recommendedTool, "detect_design_system");
    const approval = health.checks.find(check => check.id === "approval_boundary");
    assert.strictEqual(approval.status, "fail");
    assert.ok(approval.nextAction.includes("approve"));
  }

  {
    const health = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        workflowId: "token-gap-completion",
      },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        approvalStatus: "granted",
      },
      requestedAction: {
        tool: "update_ds_tokens",
        kind: "write",
        payloadSource: "hand_authored",
      },
    });
    assert.strictEqual(health.status, "blocked");
    const payload = health.checks.find(check => check.id === "repair_payload_source");
    assert.strictEqual(payload.status, "fail");
    assert.ok(payload.message.includes("structured Figlets repairPlan payloads"));
  }

  {
    const health = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "token-gap-completion" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        completedTools: ["sync_figma_data", "inspect_ds_token_gaps", "update_ds_tokens"],
        pendingWriteTool: "update_ds_tokens",
        approvalStatus: "needed",
      },
      requestedAction: {
        tool: "update_ds_tokens",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
      },
    });
    assert.strictEqual(health.status, "blocked");
    const approval = health.checks.find(check => check.id === "approval_boundary");
    assert.strictEqual(approval.status, "fail");
    assert.ok(approval.nextAction.includes("approve"));
  }

  {
    const health = handleFigletsHealthCheck({
      context: { mode: "designer" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
      },
      repairPlanState: {
        hasMissingCapabilityNotes: true,
      },
    });
    assert.strictEqual(health.status, "warning");
    const productGap = health.checks.find(check => check.id === "product_gap_response");
    assert.strictEqual(productGap.status, "warn");
    assert.ok(productGap.nextAction.includes("product/tool gap"));
  }

  {
    const health = handleFigletsHealthCheck({
      context: {
        mode: "developer",
        host: { mcpSessionFreshness: "stale_suspected" },
      },
    });
    assert.strictEqual(health.status, "warning");
    const stale = health.checks.find(check => check.id === "stale_host_suspicion");
    assert.strictEqual(stale.status, "warn");
    assert.ok(stale.nextAction.includes("fresh stdio"));
  }

  {
    const guide = getWorkflowGuide("build-showcase");
    assert.strictEqual(guide.id, "build-showcase");
    assert.ok(guide.steps.some(step => step.tool === "build_ds_showcase" && step.requiresApproval === true));
    assert.ok(guide.next.includes("export-design-md"));
  }

  {
    for (const { workflow, step } of allSteps()) {
      if (step.kind === "write") {
        assert.strictEqual(
          step.requiresApproval,
          true,
          `${workflow.id}.${step.id} mutates Figma and must require approval`
        );
      }
      if (step.kind === "read" && step.tool && MUTATING_TOOLS.has(step.tool)) {
        assert.strictEqual(
          step.options && step.options.dry_run,
          true,
          `${workflow.id}.${step.id} should dry-run ${step.tool} during read-only workflow steps`
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
      health: handleFigletsHealthCheck({ context: { mode: "designer" } }),
    });
    assert.ok(!/\/(Users|home)\/[^"\\/]+/.test(publicPayload), "Agent Interface should not hardcode developer-local home paths");
  }

} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
}
