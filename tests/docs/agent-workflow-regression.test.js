"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-agent-workflow-regression-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const MODULES_TO_CLEAR = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/agent-interface/workflows.js",
  "../../packages/figlets-mcp-server/src/tools/agent-interface.js",
];
MODULES_TO_CLEAR.forEach(modulePath => {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch {}
});

const {
  DESIGNER_FLOW_HARD_RULES,
  MUTATING_TOOLS,
  WORKFLOWS,
  getStartGuide,
  getWorkflowGuide,
} = require("../../packages/figlets-mcp-server/src/agent-interface/workflows.js");

const {
  figletsHealthCheckTool,
  figletsStartTool,
  figletsWorkflowGuideTool,
  handleFigletsHealthCheck,
  handleFigletsRouteIntent,
  handleFigletsStart,
  handleFigletsWorkflowGuide,
} = require("../../packages/figlets-mcp-server/src/tools/agent-interface.js");

const DESIGNER_DOC_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "packages/figlets-adapter/AGENTS.md",
  "packages/figlets-adapter/CLAUDE.md",
  "plugins/claude-code/figlets/skills/figlets-designer/SKILL.md",
  "plugins/claude-code/figlets/commands/start.md",
  "plugins/codex/figlets/skills/figlets-designer/SKILL.md",
  "plugins/codex/figlets/commands/start.md",
];

function readDoc(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertDocsInclude(relativePaths, phrases, label) {
  for (const relativePath of relativePaths) {
    const content = readDoc(relativePath);
    for (const phrase of phrases) {
      assert.ok(
        content.includes(phrase),
        `${label}: ${relativePath} should mention ${JSON.stringify(phrase)}`
      );
    }
  }
}

function assertDocsIncludeAny(relativePaths, phrases, label) {
  for (const relativePath of relativePaths) {
    const content = readDoc(relativePath);
    assert.ok(
      phrases.some(phrase => content.includes(phrase)),
      `${label}: ${relativePath} should mention one of ${phrases.map(JSON.stringify).join(", ")}`
    );
  }
}

function findCheck(health, checkId) {
  const check = health.checks.find(item => item.id === checkId);
  assert.ok(check, `health check should include ${checkId}`);
  return check;
}

function assertStructuredCheck(check) {
  assert.ok(typeof check.id === "string" && check.id.length > 0, "check.id should be a non-empty string");
  assert.ok(typeof check.title === "string" && check.title.length > 0, "check.title should be a non-empty string");
  assert.ok(["pass", "fail", "warn", "info"].includes(check.status), `check ${check.id} status should be structured`);
  assert.ok(typeof check.message === "string" && check.message.length > 0, `check ${check.id} should include message`);
  assert.ok(typeof check.nextAction === "string" && check.nextAction.length > 0, `check ${check.id} should include nextAction`);
  assert.ok(Array.isArray(check.evidence), `check ${check.id} evidence should be an array`);
}

function assertHostNeutralHealth(health) {
  assert.strictEqual(health.boundaries.readOnly, true);
  assert.strictEqual(health.boundaries.figmaMutationAllowed, false);
  assert.strictEqual(health.boundaries.hostSpecificBehavior, false);
  assert.ok(health.nextAction && typeof health.nextAction.message === "string");
  assert.ok(Array.isArray(health.checks) && health.checks.length > 0);
  for (const check of health.checks) {
    assertStructuredCheck(check);
  }
}

try {
  // --- Unsafe pattern 1: skipping figlets_start in designer flow ---
  {
    assertDocsInclude(DESIGNER_DOC_PATHS, ["figlets_start"], "designer entrypoint docs");
    assertDocsIncludeAny(
      DESIGNER_DOC_PATHS,
      [
        "Call the Figlets MCP tool `figlets_start` first",
        "Call the `figlets_start` MCP tool first",
        "call `figlets_start` first",
      ],
      "designer entrypoint docs"
    );

    const start = handleFigletsStart();
    assert.ok(
      start.hardRules.requiredSequence.includes("figlets_start"),
      "start payload should require figlets_start in requiredSequence"
    );
    assert.ok(
      start.responseContract.nextAction.includes("route it before replying"),
      "start payload should steer concrete goals through routing before replying"
    );

    const skippedStart = handleFigletsHealthCheck({
      context: { mode: "designer", goal: "check my design system" },
      workflowState: {
        figletsStartCalled: false,
        routeIntentCalled: false,
        workflowGuideCalled: false,
      },
    });
    assert.strictEqual(skippedStart.status, "blocked");
    const entrypoint = findCheck(skippedStart, "designer_mode_entrypoint");
    assert.strictEqual(entrypoint.status, "fail");
    assert.strictEqual(entrypoint.recommendedTool, "figlets_start");
    assert.ok(entrypoint.nextAction.includes("figlets_start"));
    assert.ok(skippedStart.nextAction.tool === "figlets_start");
  }

  // --- Unsafe pattern 2: raw Figma scripts instead of Figlets workflow ---
  {
    assertDocsInclude(
      DESIGNER_DOC_PATHS,
      ["custom scripts", "figlets_workflow_guide"],
      "Figlets-only review docs"
    );

    const start = getStartGuide();
    assert.ok(
      start.hardRules.forbiddenUnlessDesignerExplicitlyAsksOutOfBounds.some(item => /custom scripts/i.test(item)),
      "start hardRules should forbid custom scripts for designer review"
    );
    assert.ok(
      start.hardRules.forbiddenUnlessDesignerExplicitlyAsksOutOfBounds.some(item => item.includes("figma-data.json")),
      "start hardRules should forbid local snapshot review scripts"
    );
    assert.ok(
      start.responseContract.designSystemReviewRule.includes("Figlets workflow tools/scripts only"),
      "start responseContract should steer agents to Figlets workflow tools"
    );
    assert.ok(figletsStartTool.description.includes("not custom scripts"));
    assert.ok(figletsWorkflowGuideTool.description.includes("named Figlets tools/scripts only"));

    const guide = handleFigletsWorkflowGuide({ workflow_id: "health-check" });
    assert.ok(guide.message.includes("named Figlets tools/scripts only"));
    assert.ok(guide.hardRules.forbiddenUnlessDesignerExplicitlyAsksOutOfBounds.some(item => /custom scripts/i.test(item)));
  }

  // --- Unsafe pattern 3: applying repair payloads without designer approval ---
  {
    assertDocsIncludeAny(
      DESIGNER_DOC_PATHS,
      ["ask approval", "ask for explicit approval", "after approval", "explicit designer confirmation"],
      "approval boundary docs"
    );

    for (const workflow of WORKFLOWS) {
      for (const step of workflow.steps || []) {
        if (step.kind === "write") {
          assert.strictEqual(
            step.requiresApproval,
            true,
            `${workflow.id}.${step.id} write step must require designer approval`
          );
        }
        if (step.kind === "read" && step.tool && MUTATING_TOOLS.has(step.tool)) {
          assert.strictEqual(
            step.options && step.options.dry_run,
            true,
            `${workflow.id}.${step.id} should dry-run ${step.tool} before approval`
          );
        }
      }
    }

    {
      const route = handleFigletsRouteIntent({ intent: "complete missing config-backed tokens" });
      assert.strictEqual(route.workflow.id, "token-gap-completion");
      assert.ok(route.designerResponse.includes("explicitly approve"));
      assert.ok(route.designerResponse.includes("not approval to write"));
      const tokenGuide = handleFigletsWorkflowGuide({ workflow_id: "token-gap-completion" });
      assert.ok(tokenGuide.approvalContract);
      assert.ok(tokenGuide.message.includes("Routing goal phrases are not approval"));
    }

    const unapprovedWrite = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "health-check" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        pendingWriteTool: "apply_ds_setup_repairs",
        approvalStatus: "needed",
      },
      requestedAction: {
        tool: "apply_ds_setup_repairs",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
      },
    });
    assert.strictEqual(unapprovedWrite.status, "blocked");
    const approval = findCheck(unapprovedWrite, "approval_boundary");
    assert.strictEqual(approval.status, "fail");
    assert.ok(/approve/i.test(approval.nextAction));
    assert.strictEqual(unapprovedWrite.nextAction.type, "ask_user");

    const handAuthored = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "token-gap-completion" },
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
    const payloadSource = findCheck(handAuthored, "repair_payload_source");
    assert.strictEqual(payloadSource.status, "fail");
    assert.ok(payloadSource.message.includes("structured Figlets repairPlan payloads"));
  }

  // --- Unsafe pattern 3b: reconstructing setup repair aliases after approval ---
  {
    assertDocsInclude(
      DESIGNER_DOC_PATHS,
      [
        "Never replace `aliases` with counts",
        "schema validation rejects",
        "fresh structured `repairPlan.applyInput`",
      ],
      "setup repair alias handoff docs"
    );

    const start = getStartGuide();
    assert.ok(
      start.hardRules.bulkRepairRouting.some(item => item.includes("pass that exact object")),
      "Agent Interface should tell agents to pass the exact setup repair payload"
    );
    assert.ok(
      start.hardRules.bulkRepairRouting.some(item => item.includes("Never replace setup repair aliases with counts")),
      "Agent Interface should forbid alias counts/summaries"
    );
    assert.ok(
      start.hardRules.bulkRepairRouting.some(item => item.includes("spacing_semantic_repairs")),
      "Agent Interface should name the exact semantic spacing repair payload"
    );
    assert.ok(
      start.hardRules.bulkRepairRouting.some(item => item.includes("do not redirect a Mobile-only approval into foundation mode creation")),
      "Agent Interface should forbid pivoting Mobile-only spacing approval into foundation mode creation"
    );
    assert.strictEqual(start.hardRules.setupRepairPayloadHandoff.preserveAliases, true);
    assert.strictEqual(start.hardRules.spacingSemanticRepairPayloadHandoff.preserveUpdates, true);
    assert.ok(start.hardRules.spacingSemanticRepairPayloadHandoff.invalidPayloadRecovery.includes("rerun inspect_ds_token_gaps"));

    const guide = getWorkflowGuide("health-check");
    const applyStep = guide.steps.find(step => step.tool === "apply_ds_setup_repairs");
    assert.ok(applyStep.designerMessage.includes("exact approved repairPlan.applyInput"));
    assert.ok(applyStep.designerMessage.includes("preserving each aliases object unchanged"));

    const handled = handleFigletsWorkflowGuide({ workflow_id: "health-check" });
    assert.ok(handled.bulkRepairRouting.some(item => item.includes("retrying invented arguments")));
    assert.strictEqual(handled.hardRules.setupRepairPayloadHandoff.target, "repairPlan.tool / apply_ds_setup_repairs");
  }

  // --- Unsafe pattern 3c: widening a narrow approval into a broader category write ---
  {
    const widenedBoundary = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "token-gap-completion" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        approvalStatus: "granted",
        approvedBoundary: "spacing-mobile-aliases",
      },
      requestedAction: {
        tool: "update_ds_tokens",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
        writeBoundary: "spacing-semantics-all-modes",
      },
    });
    assert.strictEqual(widenedBoundary.status, "blocked");
    const scope = findCheck(widenedBoundary, "write_scope_boundary");
    assert.strictEqual(scope.status, "fail");
    assert.ok(scope.message.includes("designer-approved boundary"));
    assert.ok(scope.nextAction.includes("approve this exact boundary"));
    assert.strictEqual(widenedBoundary.nextAction.type, "ask_user");

    const exactSubsetWithCategoryPayload = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "token-gap-completion" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        approvalStatus: "granted",
      },
      requestedAction: {
        tool: "update_ds_tokens",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
        approvalScope: "exact-subset",
        exactSubsetRequested: true,
        payloadGranularity: "category-level",
      },
    });
    assert.strictEqual(exactSubsetWithCategoryPayload.status, "blocked");
    const categoryScope = findCheck(exactSubsetWithCategoryPayload, "write_scope_boundary");
    assert.strictEqual(categoryScope.status, "fail");
    assert.ok(categoryScope.message.includes("category-level payload"));
    assert.ok(categoryScope.nextAction.includes("token-level repairPlan entries"));
    assert.ok(categoryScope.nextAction.includes("plan_ds_figma_operations"));
  }

  // --- Unsafe pattern 3d: continuing after foundation/apply unlocks new work ---
  {
    const foundationThenTokens = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "token-gap-completion" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        approvalStatus: "granted",
        lastAppliedBoundary: "foundation",
        postApplySyncReinspectCompleted: false,
        separateApprovalAfterReinspect: false,
      },
      requestedAction: {
        tool: "update_ds_tokens",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
        writeBoundary: "semantic-token",
      },
    });
    assert.strictEqual(foundationThenTokens.status, "blocked");
    const stop = findCheck(foundationThenTokens, "post_apply_stop_boundary");
    assert.strictEqual(stop.status, "fail");
    assert.ok(stop.message.includes("sync, reinspect"));
    assert.ok(stop.nextAction.includes("separate approval"));
    assert.strictEqual(foundationThenTokens.nextAction.type, "call_tool");

    const unlockedNewRepairs = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "health-check" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        approvalStatus: "granted",
        lastAppliedBoundary: "semantic-setup",
        lastApplyUnlockedNewRepairs: true,
        postApplySyncReinspectCompleted: true,
        separateApprovalAfterReinspect: false,
      },
      requestedAction: {
        tool: "apply_ds_setup_repairs",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
        writeBoundary: "newly-unlocked-setup-repairs",
      },
    });
    assert.strictEqual(unlockedNewRepairs.status, "blocked");
    const unlockedStop = findCheck(unlockedNewRepairs, "post_apply_stop_boundary");
    assert.strictEqual(unlockedStop.status, "fail");
    assert.ok(unlockedStop.nextAction.includes("fresh approval boundary"));
  }

  // --- Unsafe pattern 3e: applying QA designer-decision suggestions through fix:true ---
  {
    const designerDecisionBinding = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "qa-binding-audit" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        approvalStatus: "granted",
      },
      repairPlanState: {
        fixableNowCount: 1,
        needsDesignerDecisionCount: 1,
        hasDesignerDecisionApplyInput: false,
      },
      requestedAction: {
        tool: "qa_binding_audit",
        kind: "write",
        payloadSource: "repairPlan.applyInput",
        includesDesignerDecision: true,
      },
    });
    assert.strictEqual(designerDecisionBinding.status, "blocked");
    const decision = findCheck(designerDecisionBinding, "binding_designer_decision_boundary");
    assert.strictEqual(decision.status, "fail");
    assert.ok(decision.message.includes("fixableNow"));
    assert.ok(decision.nextAction.includes("plan_ds_figma_operations"));

    const naturalFixShape = handleFigletsHealthCheck({
      context: { mode: "designer", workflowId: "qa-binding-audit" },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        approvalStatus: "granted",
      },
      repairPlanState: {
        fixableNowCount: 1,
        needsDesignerDecisionCount: 1,
        hasDesignerDecisionApplyInput: false,
      },
      requestedAction: {
        tool: "qa_binding_audit",
        args: { fix: true },
        payloadSource: "repairPlan.applyInput",
        includesDesignerDecision: true,
      },
    });
    assert.strictEqual(naturalFixShape.status, "blocked");
    assert.strictEqual(findCheck(naturalFixShape, "binding_fixability_boundary").status, "pass");
    const naturalDecision = findCheck(naturalFixShape, "binding_designer_decision_boundary");
    assert.strictEqual(naturalDecision.status, "fail");
    assert.ok(naturalDecision.message.includes("fixableNow"));
  }

  // --- Unsafe pattern 4: treating stale MCP host output as repo regression ---
  {
    assert.ok(
      figletsHealthCheckTool.description.includes("stale host risk"),
      "health check tool description should mention stale host risk"
    );
    assert.ok(
      readDoc("packages/figlets-adapter/AGENTS.md").includes("stale host risk"),
      "adapter docs should mention stale host risk guidance"
    );

    const staleHost = handleFigletsHealthCheck({
      context: {
        mode: "developer",
        host: { mcpSessionFreshness: "stale_suspected" },
      },
    });
    assert.strictEqual(staleHost.status, "warning");
    const stale = findCheck(staleHost, "stale_host_suspicion");
    assert.strictEqual(stale.status, "warn");
    assert.ok(/fresh stdio/i.test(stale.nextAction));
    assert.ok(/repo regression/i.test(stale.nextAction));
    assert.strictEqual(staleHost.nextAction.type, "restart_or_refresh_host");
  }

  // --- Unsafe pattern 5: missing specialized planner/apply support is not a dead end ---
  {
    assertDocsInclude(
      DESIGNER_DOC_PATHS,
      ["plan_ds_figma_operations"],
      "high-level operations fallback docs"
    );
    assertDocsInclude(
      ["docs/developer-guide.md"],
      ["update_ds_tokens.spacing_semantic_repairs", "MCP tool schema"],
      "stale MCP schema manual smoke note"
    );
    assertDocsInclude(
      ["AGENTS.md", "CLAUDE.md"],
      ["do not tell the designer the gaps cannot be fixed"],
      "anti-dead-end root docs"
    );

    assert.ok(
      DESIGNER_FLOW_HARD_RULES.missingCapabilityResponse.includes("plan_ds_figma_operations"),
      "hard rules should route exact high-level edits through figma operations"
    );
    assert.ok(
      DESIGNER_FLOW_HARD_RULES.bulkRepairRouting.some(item => item.includes("plan_ds_figma_operations")),
      "bulkRepairRouting should steer agents toward high-level operations before gap reporting"
    );

    const start = getStartGuide();
    assert.ok(start.responseContract.bulkUpdateRule.includes("plan_ds_figma_operations"));

    const productGap = handleFigletsHealthCheck({
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
    assert.strictEqual(productGap.status, "warning");
    const gapCheck = findCheck(productGap, "product_gap_response");
    assert.strictEqual(gapCheck.status, "warn");
    assert.ok(gapCheck.nextAction.includes("plan_ds_figma_operations"));
    assert.ok(!/gaps cannot be fixed|dead end/i.test(gapCheck.nextAction));
    assert.ok(/inventing raw Figma scripts/i.test(gapCheck.nextAction));
    assert.strictEqual(productGap.nextAction.type, "report_product_gap");
  }

  // --- Unsafe pattern 6: skipping new-DS setup intake and inventing config values ---
  {
    const posterGalleryIntent =
      "using figlets set up a new design system with multiple vibrant colors as backgrounds and some matching vibrant colors to pair with them as foreground. The ds is called Poster Gallery.";
    const route = handleFigletsRouteIntent({ intent: posterGalleryIntent });
    assert.strictEqual(route.workflow.id, "new-ds-setup");
    assert.ok(route.intakeContract);
    assert.ok(route.intakeContract.proposalRule.includes("Do not draft a full proposal before intake"));
    assert.ok(route.message.includes("do not draft a full proposal"));
    assert.ok(route.message.includes("create_ds_config_from_intake"));
    assert.ok(route.designerResponse.includes("start by asking"));
    assert.ok(route.designerResponse.includes("won't draft"));
    assert.ok(route.designerResponse.includes("setupApprovalPreview"));
    assert.ok(route.designerResponse.includes("file-scoped local config"));
    assert.ok(route.designerResponse.includes("sample aliases"));
    assert.ok(!route.designerResponse.includes("1. I'll compute and preview"));

    const guide = handleFigletsWorkflowGuide({ workflow_id: "new-ds-setup" });
    assert.ok(guide.intakeContract);
    assert.ok(guide.intakeContract.requiredTopics.some(topic => topic.includes("brand colors")));
    assert.strictEqual(guide.intakeContract.configCreationTool, "create_ds_config_from_intake");
    assert.ok(guide.intakeContract.suggestionBoundary.includes("Do not confuse proposing with inventing"));
    assert.ok(guide.intakePresentationRule.includes("intake questions"));
    assert.ok(guide.message.includes("do not draft a full proposal"));
    assert.ok(guide.workflow.steps.some(step => step.id === "collect-answers" && step.requiredBeforeTool === "create_ds_config_from_intake"));
    assert.ok(guide.workflow.steps.some(step => step.id === "create-config-from-intake" && step.tool === "create_ds_config_from_intake" && step.localConfigWrite === true));
    const prepareStep = guide.workflow.steps.find(step => step.id === "prepare");
    assert.ok(prepareStep.designerMessage.includes("setupApprovalPreview"));
    assert.ok(prepareStep.designerMessage.includes("concrete collection groups"));
    assert.ok(prepareStep.designerMessage.includes("no-write approval boundary"));
    const contrastRepairStep = guide.workflow.steps.find(step => step.id === "repair-setup-contrast-config");
    assert.strictEqual(contrastRepairStep.tool, "apply_ds_config_contrast_repairs");
    assert.strictEqual(contrastRepairStep.localConfigWrite, true);
    assert.strictEqual(contrastRepairStep.requiresApproval, true);
    assert.ok(contrastRepairStep.designerMessage.includes("rerun prepare_ds_config"));
    assert.ok(guide.workflow.errors.some(item => item.includes("contrastRepairOptions")));
    assert.ok(guide.workflow.errors.some(item => item.includes("apply_ds_config_contrast_repairs")));

    assertDocsIncludeAny(
      DESIGNER_DOC_PATHS,
      [
        "do not draft a full proposal",
        "Do not draft a full proposal",
        "Never draft a full setup proposal",
      ],
      "setup proposal docs"
    );
    assertDocsIncludeAny(
      DESIGNER_DOC_PATHS,
      [
        "ask questions before suggesting concrete token values",
        "Ask targeted intake questions first",
      ],
      "setup intake question-first docs"
    );

    const skippedIntake = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        goal: posterGalleryIntent,
        workflowId: "new-ds-setup",
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
    assert.strictEqual(skippedIntake.status, "blocked");
    const intake = findCheck(skippedIntake, "setup_intake_boundary");
    assert.strictEqual(intake.status, "fail");
    assert.ok(intake.nextAction.includes("Do not draft a full proposal"));
    assert.strictEqual(skippedIntake.nextAction.type, "ask_user");

    const draftedProposal = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        goal: posterGalleryIntent,
        workflowId: "new-ds-setup",
      },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        setupIntakeCompleted: false,
        proposalDraftedBeforeIntake: true,
      },
    });
    assert.strictEqual(draftedProposal.status, "blocked");
    const proposal = findCheck(draftedProposal, "setup_proposal_boundary");
    assert.strictEqual(proposal.status, "fail");
    assert.ok(proposal.nextAction.includes("targeted intake questions"));
    assert.strictEqual(draftedProposal.nextAction.type, "ask_user");

    const negativeRoutes = [
      ["using figlets build a token showcase for vibrant colors", "build-showcase"],
      ["using figlets export DESIGN.md for background colors", "export-design-md"],
      ["using figlets check foreground contrast in my design system", "health-check"],
      ["using figlets add missing background/foreground color roles", "health-check"],
    ];
    for (const [intent, expectedWorkflowId] of negativeRoutes) {
      const route = handleFigletsRouteIntent({ intent });
      assert.strictEqual(
        route.workflow.id,
        expectedWorkflowId,
        `intent should route to ${expectedWorkflowId}: ${intent}`
      );
    }
  }

  // --- figlets_health_check first check set (host/model-neutral corrective guidance) ---
  {
    const expectedCheckIds = [
      "designer_mode_entrypoint",
      "concrete_goal_routing",
      "workflow_tool_sequence",
      "setup_intake_boundary",
      "setup_proposal_boundary",
      "approval_boundary",
      "repair_payload_source",
      "write_scope_boundary",
      "post_apply_health_check_verification",
      "post_apply_stop_boundary",
      "product_gap_response",
      "binding_fixability_boundary",
      "binding_designer_decision_boundary",
      "stale_host_suspicion",
      "bridge_readiness",
      "release_docs_readiness",
    ];

    const baseline = handleFigletsHealthCheck({});
    assertHostNeutralHealth(baseline);
    assert.deepStrictEqual(
      baseline.checks.map(check => check.id),
      expectedCheckIds,
      "health check should expose the first structured check set in stable order"
    );
    assert.ok(
      DESIGNER_FLOW_HARD_RULES.bulkRepairRouting.some(rule =>
        rule.includes("do not repeat a stale missing Tablet/Desktop modes item") &&
        rule.includes("not by a drifting menu number")
      ),
      "health-check hard rules should prevent stale post-apply remaining-items summaries"
    );

    const readyDesigner = handleFigletsHealthCheck({
      context: {
        mode: "designer",
        goal: "review my design system",
        workflowId: "health-check",
      },
      workflowState: {
        figletsStartCalled: true,
        routeIntentCalled: true,
        workflowGuideCalled: true,
        completedTools: ["sync_figma_data", "detect_design_system", "audit_tokens", "inspect_ds_setup_gaps"],
      },
    });
    assertHostNeutralHealth(readyDesigner);
    assert.strictEqual(findCheck(readyDesigner, "designer_mode_entrypoint").status, "pass");
    assert.strictEqual(findCheck(readyDesigner, "concrete_goal_routing").status, "pass");
    assert.strictEqual(findCheck(readyDesigner, "approval_boundary").status, "pass");
  }

  // --- Tool payloads stay host-neutral (no developer-local paths in public JSON) ---
  {
    const publicPayload = JSON.stringify({
      start: handleFigletsStart(),
      guide: handleFigletsWorkflowGuide({ workflow_id: "health-check" }),
      health: handleFigletsHealthCheck({ context: { mode: "designer" } }),
    });
    assert.ok(
      !/\/(Users|home)\/[^"\\/]+/.test(publicPayload),
      "Agent Interface regression payloads should not hardcode developer-local home paths"
    );
  }
} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  MODULES_TO_CLEAR.forEach(modulePath => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch {}
  });
}
