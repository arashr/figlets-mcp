"use strict";

const {
  DESIGNER_FLOW_HARD_RULES,
  MUTATING_TOOLS,
  WORKFLOWS,
  getStartGuide,
  getWorkflowGuide,
  listWorkflows,
  routeIntent,
} = require("../agent-interface/workflows.js");

const figletsStartTool = {
  name: "figlets_start",
  description:
    "Read-only Agent Interface entrypoint. Returns the Figlets intro, safety contract, bulk design-system update posture, runtime environment hints, capability menu, and first designer-facing question. Designer reviews must use Figlets workflows/tools, not custom scripts. Does not inspect or mutate Figma.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const figletsRouteIntentTool = {
  name: "figlets_route_intent",
  description:
    "Read-only Agent Interface router. Maps a designer's natural-language request to the most likely Figlets workflow and returns confirmation boundaries and next steps. Use the returned workflow before any design-system review scripting or mutation. Does not inspect or mutate Figma.",
  inputSchema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        description: "The designer's natural-language request, such as 'check my design system' or 'document this component'.",
      },
    },
    required: ["intent"],
    additionalProperties: false,
  },
};

const figletsWorkflowGuideTool = {
  name: "figlets_workflow_guide",
  description:
    "Read-only Agent Interface guide. Returns the step-by-step contract for a Figlets workflow, including tools, read/write classification, required confirmations, bulk repair posture, error recovery notes, and safe next workflows. For designer-facing review, use the named Figlets tools/scripts only unless the designer explicitly asks to go out of bounds.",
  inputSchema: {
    type: "object",
    properties: {
      workflow_id: {
        type: "string",
        description: "Workflow id returned by figlets_start or figlets_route_intent, e.g. health-check, build-showcase, component-docs.",
      },
    },
    required: ["workflow_id"],
    additionalProperties: false,
  },
};

const figletsHealthCheckTool = {
  name: "figlets_health_check",
  description:
    "Read-only Agent Interface health check for agent readiness and Figlets workflow safety. Returns structured, host-neutral feedback about entrypoint/routing, workflow sequencing, setup intake and proposal boundaries, approval boundaries, repair payload sources, product-gap handling, stale host risk, and bridge readiness. Does not inspect or mutate Figma.",
  inputSchema: {
    type: "object",
    properties: {
      context: { type: "object" },
      workflowState: { type: "object" },
      repairPlanState: { type: "object" },
      requestedAction: { type: "object" },
    },
    additionalProperties: false,
  },
};

const HEALTH_CHECK_VERIFY_TOOLS = [
  "sync_figma_data",
  "detect_design_system",
  "audit_tokens",
  "inspect_ds_setup_gaps",
  "inspect_ds_token_gaps",
];

function asTextResult(result) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function _truthy(value) {
  return value === true;
}

function _nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function _array(value) {
  return Array.isArray(value) ? value : [];
}

function _knownWorkflow(workflowId) {
  if (!_nonEmpty(workflowId)) return null;
  return WORKFLOWS.find(workflow => workflow.id === workflowId) || null;
}

function _isWriteTool(toolName) {
  if (!_nonEmpty(toolName)) return false;
  return MUTATING_TOOLS.has(toolName) || toolName === "qa_binding_audit:fix";
}

function _normalizeBoundary(value) {
  if (!_nonEmpty(value)) return "";
  return String(value).trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function _sameApprovalBoundary(approvedBoundary, writeBoundary) {
  const approved = _normalizeBoundary(approvedBoundary);
  const write = _normalizeBoundary(writeBoundary);
  if (!approved || !write) return true;
  if (approved === write) return true;
  if (approved === "all" || approved === "all-ready-safe" || approved === "all-currently-ready-safe") return true;
  return false;
}

function _isCategoryLevelPayload(value) {
  const normalized = _normalizeBoundary(value);
  return normalized === "category" ||
    normalized === "category-level" ||
    normalized === "broad-category" ||
    normalized === "categories";
}

function _hasCompletedTools(completedTools, requiredTools) {
  const completed = new Set(_array(completedTools));
  return requiredTools.every(tool => completed.has(tool));
}

function _statusRank(status) {
  if (status === "fail") return 4;
  if (status === "warn") return 3;
  if (status === "info") return 2;
  if (status === "pass") return 1;
  return 0;
}

function _makeCheck({
  id,
  title,
  status,
  severity,
  message,
  evidence,
  nextAction,
  recommendedTool,
  recommendedPayloadSource,
}) {
  const check = {
    id,
    title,
    status,
    severity,
    message,
    evidence: _array(evidence),
    nextAction,
  };
  if (recommendedTool) check.recommendedTool = recommendedTool;
  if (recommendedPayloadSource) check.recommendedPayloadSource = recommendedPayloadSource;
  return check;
}

function _chooseNextAction(checks, fallback) {
  const actionable = checks
    .filter(check => check.status === "fail" || check.status === "warn")
    .sort((a, b) => _statusRank(b.status) - _statusRank(a.status))[0];
  if (!actionable) return fallback;

  if (actionable.id === "designer_mode_entrypoint") {
    return {
      type: "call_tool",
      tool: "figlets_start",
      argsSource: "{}",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "concrete_goal_routing") {
    return {
      type: "route_intent",
      tool: "figlets_route_intent",
      argsSource: "context.intent or context.goal",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "workflow_tool_sequence") {
    return {
      type: "call_tool",
      tool: actionable.recommendedTool || "figlets_workflow_guide",
      argsSource: actionable.recommendedTool ? "workflow guide step order" : "context.workflowId",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "setup_intake_boundary") {
    return {
      type: "ask_user",
      tool: null,
      argsSource: "new-ds-setup intakeContract.requiredTopics",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "setup_proposal_boundary") {
    return {
      type: "ask_user",
      tool: "figlets_workflow_guide",
      argsSource: "new-ds-setup intakeContract.firstResponseRule",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "approval_boundary") {
    return {
      type: "ask_user",
      tool: actionable.recommendedTool || null,
      argsSource: actionable.recommendedPayloadSource || "exact Figlets payload",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "repair_payload_source") {
    return {
      type: "call_tool",
      tool: actionable.recommendedTool || null,
      argsSource: actionable.recommendedPayloadSource || "repairPlan payload",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "write_scope_boundary") {
    return {
      type: "ask_user",
      tool: actionable.recommendedTool || null,
      argsSource: actionable.recommendedPayloadSource || "exact Figlets repairPlan entries",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "post_apply_stop_boundary") {
    return {
      type: "call_tool",
      tool: actionable.recommendedTool || null,
      argsSource: actionable.recommendedPayloadSource || "sync/reinspect result",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "post_apply_health_check_verification") {
    return {
      type: "call_tool",
      tool: actionable.recommendedTool || null,
      argsSource: actionable.recommendedPayloadSource || "full health-check verification result",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "product_gap_response") {
    return {
      type: "report_product_gap",
      tool: null,
      argsSource: "repairPlan.missingCapabilityNotes",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "stale_host_suspicion") {
    return {
      type: "restart_or_refresh_host",
      tool: null,
      argsSource: "fresh stdio MCP server validation",
      message: actionable.nextAction,
    };
  }
  if (actionable.id === "bridge_readiness") {
    return {
      type: "ask_user",
      tool: null,
      argsSource: "Figma Desktop and Figlets Bridge plugin",
      message: actionable.nextAction,
    };
  }
  return {
    type: actionable.status === "fail" ? "stop" : "continue",
    tool: actionable.recommendedTool || null,
    argsSource: actionable.recommendedPayloadSource || null,
    message: actionable.nextAction,
  };
}

function handleFigletsHealthCheck(args) {
  const input = args || {};
  const context = input.context || {};
  const host = context.host || {};
  const workflowState = input.workflowState || {};
  const repairPlanState = input.repairPlanState || {};
  const requestedAction = input.requestedAction || {};
  const checks = [];

  const mode = context.mode || "unknown";
  const goal = context.goal || context.intent || "";
  const workflowId = context.workflowId || "";
  const workflow = _knownWorkflow(workflowId);
  const completedTools = _array(workflowState.completedTools);
  const requestedTool = requestedAction.tool || workflowState.pendingWriteTool || "";
  const requestedArgs = requestedAction.args || requestedAction.arguments || {};
  const requestedQaFix = requestedTool === "qa_binding_audit" &&
    (_truthy(requestedAction.fix) || _truthy(requestedArgs.fix));
  const requestedKind = requestedAction.kind || (_isWriteTool(requestedTool) || requestedQaFix ? "write" : "unknown");
  const pendingWriteTool = workflowState.pendingWriteTool || (requestedKind === "write" ? requestedTool : "");
  const approvalStatus = workflowState.approvalStatus || "unknown";
  const writeRequested = requestedKind === "write" || !!pendingWriteTool;

  if (mode === "designer" && !_truthy(workflowState.figletsStartCalled)) {
    checks.push(_makeCheck({
      id: "designer_mode_entrypoint",
      title: "Designer Mode entrypoint",
      status: "fail",
      severity: "error",
      message: "Designer-facing Figlets work must start with figlets_start.",
      evidence: ["context.mode=designer", "workflowState.figletsStartCalled is not true"],
      nextAction: "Call figlets_start before repo inspection, raw Figma actions, or designer-facing workflow guidance.",
      recommendedTool: "figlets_start",
    }));
  } else {
    checks.push(_makeCheck({
      id: "designer_mode_entrypoint",
      title: "Designer Mode entrypoint",
      status: mode === "designer" ? "pass" : "info",
      severity: "info",
      message: mode === "designer"
        ? "Designer Mode entrypoint has been acknowledged."
        : "Mode was not provided as designer; if this is designer-facing work, start with figlets_start.",
      evidence: [`context.mode=${mode}`],
      nextAction: mode === "designer"
        ? "Continue with intent routing and workflow guidance."
        : "Provide context.mode or call figlets_start for designer-facing work.",
      recommendedTool: mode === "designer" ? null : "figlets_start",
    }));
  }

  if (_nonEmpty(goal) && mode === "designer" && (!_truthy(workflowState.routeIntentCalled) || !_truthy(workflowState.workflowGuideCalled))) {
    checks.push(_makeCheck({
      id: "concrete_goal_routing",
      title: "Concrete goal routing",
      status: "fail",
      severity: "error",
      message: "A concrete designer goal should route through figlets_route_intent and figlets_workflow_guide before the agent answers with workflow steps.",
      evidence: [
        `goal=${goal}`,
        `routeIntentCalled=${Boolean(workflowState.routeIntentCalled)}`,
        `workflowGuideCalled=${Boolean(workflowState.workflowGuideCalled)}`,
      ],
      nextAction: "Call figlets_route_intent with the designer goal, then call figlets_workflow_guide for the selected workflow.",
      recommendedTool: "figlets_route_intent",
    }));
  } else {
    checks.push(_makeCheck({
      id: "concrete_goal_routing",
      title: "Concrete goal routing",
      status: _nonEmpty(goal) ? "pass" : "info",
      severity: "info",
      message: _nonEmpty(goal)
        ? "Concrete goal routing state is acceptable."
        : "No concrete goal was provided; route intent when the designer states one.",
      evidence: _nonEmpty(goal) ? [`goal=${goal}`] : [],
      nextAction: _nonEmpty(goal)
        ? "Continue with the selected workflow."
        : "Collect or pass the designer goal, then route it.",
    }));
  }

  if (workflow) {
    const firstMissingReadStep = (workflow.steps || [])
      .filter(step => step.kind === "read" && step.tool)
      .find(step => completedTools.indexOf(step.tool) === -1);
    if (pendingWriteTool && firstMissingReadStep) {
      checks.push(_makeCheck({
        id: "workflow_tool_sequence",
        title: "Workflow tool sequence",
        status: "warn",
        severity: "warning",
        message: `The ${workflow.id} workflow appears to be moving toward a write before completing the read step ${firstMissingReadStep.tool}.`,
        evidence: [`pendingWriteTool=${pendingWriteTool}`, `missingReadTool=${firstMissingReadStep.tool}`],
        nextAction: `Run ${firstMissingReadStep.tool} before requesting or applying writes for this workflow.`,
        recommendedTool: firstMissingReadStep.tool,
      }));
    } else {
      checks.push(_makeCheck({
        id: "workflow_tool_sequence",
        title: "Workflow tool sequence",
        status: "pass",
        severity: "info",
        message: `Workflow metadata found for ${workflow.id}.`,
        evidence: [`completedTools=${completedTools.join(",")}`],
        nextAction: "Follow figlets_workflow_guide step order.",
      }));
    }

    const setupIntakeCompleted = _truthy(workflowState.setupIntakeCompleted);
    const setupToolRequested = requestedTool === "create_ds_config_from_intake" ||
      requestedTool === "prepare_ds_config" ||
      requestedTool === "apply_ds_setup" ||
      completedTools.indexOf("create_ds_config_from_intake") !== -1 ||
      completedTools.indexOf("prepare_ds_config") !== -1;
    if (workflow.id === "new-ds-setup" && setupToolRequested && !setupIntakeCompleted) {
      checks.push(_makeCheck({
        id: "setup_intake_boundary",
        title: "Setup intake boundary",
        status: "fail",
        severity: "error",
        message: "New design-system setup must collect designer intake answers before create_ds_config_from_intake, prepare_ds_config, or apply_ds_setup.",
        evidence: [
          "workflowId=new-ds-setup",
          "setupIntakeCompleted is not true",
          `requestedOrCompletedTool=${requestedTool || "prepare_ds_config"}`,
        ],
        nextAction: "Ask targeted setup intake questions for missing choices. Treat the designer prompt as direction, not a complete spec. Do not draft a full proposal or concrete token values before intake.",
        recommendedTool: "figlets_workflow_guide",
      }));
    } else if (workflow.id === "new-ds-setup") {
      checks.push(_makeCheck({
        id: "setup_intake_boundary",
        title: "Setup intake boundary",
        status: setupIntakeCompleted || !setupToolRequested ? "pass" : "info",
        severity: "info",
        message: setupIntakeCompleted
          ? "Setup intake is marked complete for this workflow."
          : "Setup intake has not been requested yet.",
        evidence: [`setupIntakeCompleted=${setupIntakeCompleted}`],
        nextAction: "Collect missing setup choices before calling create_ds_config_from_intake or prepare_ds_config.",
      }));
    } else {
      checks.push(_makeCheck({
        id: "setup_intake_boundary",
        title: "Setup intake boundary",
        status: "info",
        severity: "info",
        message: "Setup intake boundary applies only to new-ds-setup.",
        evidence: workflowId ? [`workflowId=${workflowId}`] : [],
        nextAction: "No setup intake check needed for this workflow.",
      }));
    }

    const proposalDraftedBeforeIntake = _truthy(workflowState.proposalDraftedBeforeIntake);
    if (workflow.id === "new-ds-setup" && proposalDraftedBeforeIntake && !setupIntakeCompleted) {
      checks.push(_makeCheck({
        id: "setup_proposal_boundary",
        title: "Setup proposal boundary",
        status: "fail",
        severity: "error",
        message: "New design-system setup must ask intake questions before drafting palettes, typography stacks, grid defaults, or token names.",
        evidence: [
          "workflowId=new-ds-setup",
          "proposalDraftedBeforeIntake is true",
          "setupIntakeCompleted is not true",
        ],
        nextAction: "Replace the proposal with targeted intake questions. Offer lightweight multiple-choice options only; do not draft a full setup proposal before intake unless the designer explicitly asks for suggestions.",
        recommendedTool: "figlets_workflow_guide",
      }));
    } else if (workflow.id === "new-ds-setup") {
      checks.push(_makeCheck({
        id: "setup_proposal_boundary",
        title: "Setup proposal boundary",
        status: proposalDraftedBeforeIntake ? "warn" : "pass",
        severity: proposalDraftedBeforeIntake ? "warning" : "info",
        message: proposalDraftedBeforeIntake
          ? "A setup proposal was drafted after intake began; confirm the designer asked for suggestions."
          : "No pre-intake setup proposal risk detected.",
        evidence: [`proposalDraftedBeforeIntake=${proposalDraftedBeforeIntake}`],
        nextAction: "Lead with intake questions for broad setup prompts; avoid full proposals before answers.",
      }));
    } else {
      checks.push(_makeCheck({
        id: "setup_proposal_boundary",
        title: "Setup proposal boundary",
        status: "info",
        severity: "info",
        message: "Setup proposal boundary applies only to new-ds-setup.",
        evidence: workflowId ? [`workflowId=${workflowId}`] : [],
        nextAction: "No setup proposal check needed for this workflow.",
      }));
    }
  } else {
    checks.push(_makeCheck({
      id: "workflow_tool_sequence",
      title: "Workflow tool sequence",
      status: _nonEmpty(workflowId) ? "warn" : "info",
      severity: _nonEmpty(workflowId) ? "warning" : "info",
      message: _nonEmpty(workflowId)
        ? `Unknown workflow id: ${workflowId}.`
        : "No workflow id was provided.",
      evidence: _nonEmpty(workflowId) ? [`workflowId=${workflowId}`] : [],
      nextAction: "Call figlets_route_intent and figlets_workflow_guide to establish the workflow.",
      recommendedTool: "figlets_workflow_guide",
    }));

    checks.push(_makeCheck({
      id: "setup_intake_boundary",
      title: "Setup intake boundary",
      status: "info",
      severity: "info",
      message: "Setup intake boundary applies only to new-ds-setup.",
      evidence: workflowId ? [`workflowId=${workflowId}`] : [],
      nextAction: "No setup intake check needed until new-ds-setup is selected.",
    }));

    checks.push(_makeCheck({
      id: "setup_proposal_boundary",
      title: "Setup proposal boundary",
      status: "info",
      severity: "info",
      message: "Setup proposal boundary applies only to new-ds-setup.",
      evidence: workflowId ? [`workflowId=${workflowId}`] : [],
      nextAction: "No setup proposal check needed until new-ds-setup is selected.",
    }));
  }

  if (writeRequested && approvalStatus !== "granted") {
    checks.push(_makeCheck({
      id: "approval_boundary",
      title: "Approval boundary",
      status: "fail",
      severity: "error",
      message: "A Figlets write is pending without explicit designer approval.",
      evidence: [`tool=${requestedTool || pendingWriteTool}`, `approvalStatus=${approvalStatus}`],
      nextAction: "Ask the designer to approve the exact Figlets payload before calling the write tool.",
      recommendedTool: requestedTool || pendingWriteTool,
      recommendedPayloadSource: requestedAction.payloadSource || "exact Figlets payload",
    }));
  } else {
    checks.push(_makeCheck({
      id: "approval_boundary",
      title: "Approval boundary",
      status: "pass",
      severity: "info",
      message: writeRequested
        ? "A write is pending and approval is marked granted."
        : "No write is pending.",
      evidence: [`approvalStatus=${approvalStatus}`],
      nextAction: "Continue to use explicit approval for any Figma write.",
    }));
  }

  if (writeRequested && requestedAction.payloadSource === "hand_authored") {
    checks.push(_makeCheck({
      id: "repair_payload_source",
      title: "Repair payload source",
      status: "fail",
      severity: "error",
      message: "Designer-facing Figlets repairs should use structured Figlets repairPlan payloads, not hand-authored mutation payloads.",
      evidence: [`payloadSource=${requestedAction.payloadSource}`],
      nextAction: "Use the applicable repairPlan payload from Figlets output. For exact designer-specified variable, collection, mode, style, binding, metadata, or lifecycle edits, route through plan_ds_figma_operations before treating the request as a product-specific planner gap. Do not convert health-check findings into invented generic operations.",
      recommendedTool: requestedTool || pendingWriteTool,
      recommendedPayloadSource: "repairPlan.applyInput",
    }));
  } else {
    checks.push(_makeCheck({
      id: "repair_payload_source",
      title: "Repair payload source",
      status: "pass",
      severity: "info",
      message: "No hand-authored repair payload risk detected.",
      evidence: requestedAction.payloadSource ? [`payloadSource=${requestedAction.payloadSource}`] : [],
      nextAction: "Keep using structured Figlets repairPlan payloads for approved repairs.",
    }));
  }

  const approvedBoundary = requestedAction.approvedBoundary || workflowState.approvedBoundary || "";
  const writeBoundary = requestedAction.writeBoundary || requestedAction.boundary || "";
  const exactSubsetRequested = _truthy(requestedAction.exactSubsetRequested) ||
    _truthy(workflowState.exactSubsetRequested) ||
    _normalizeBoundary(requestedAction.approvalScope || workflowState.approvalScope) === "exact-subset";
  const payloadGranularity = requestedAction.payloadGranularity || repairPlanState.payloadGranularity || "";
  const scopeWidened = writeRequested && !_sameApprovalBoundary(approvedBoundary, writeBoundary);
  const categoryForExactSubset = writeRequested && exactSubsetRequested && _isCategoryLevelPayload(payloadGranularity);
  if (scopeWidened || categoryForExactSubset) {
    checks.push(_makeCheck({
      id: "write_scope_boundary",
      title: "Write scope boundary",
      status: "fail",
      severity: "error",
      message: scopeWidened
        ? "The requested write boundary does not match the designer-approved boundary."
        : "A category-level payload cannot safely satisfy an exact subset approval request.",
      evidence: [
        approvedBoundary ? `approvedBoundary=${approvedBoundary}` : null,
        writeBoundary ? `writeBoundary=${writeBoundary}` : null,
        `exactSubsetRequested=${Boolean(exactSubsetRequested)}`,
        payloadGranularity ? `payloadGranularity=${payloadGranularity}` : null,
      ].filter(Boolean),
      nextAction: scopeWidened
        ? "Stop before writing. Ask the designer to approve this exact boundary, or call the planner again and pass only the approved structured entries."
        : "Stop before writing. Use token-level repairPlan entries for the approved subset, or reroute exact designer-specified basic Figma edits through plan_ds_figma_operations. Treat this as a product-specific planner gap only when no structured Figlets surface can represent the approved boundary; do not invent semantic migrations with the generic operations surface.",
      recommendedTool: requestedTool || pendingWriteTool,
      recommendedPayloadSource: "exact repairPlan entries",
    }));
  } else {
    checks.push(_makeCheck({
      id: "write_scope_boundary",
      title: "Write scope boundary",
      status: "pass",
      severity: "info",
      message: "No scope-widening write boundary risk detected.",
      evidence: [
        approvedBoundary ? `approvedBoundary=${approvedBoundary}` : null,
        writeBoundary ? `writeBoundary=${writeBoundary}` : null,
        payloadGranularity ? `payloadGranularity=${payloadGranularity}` : null,
      ].filter(Boolean),
      nextAction: "Keep approved boundaries exact; use entry-level payloads when the designer approves specific fixes.",
    }));
  }

  const lastAppliedBoundary = _normalizeBoundary(workflowState.lastAppliedBoundary || "");
  const lastApplyUnlockedRepairs = _truthy(workflowState.lastApplyUnlockedNewRepairs);
  const postApplySyncReinspectCompleted = _truthy(workflowState.postApplySyncReinspectCompleted);
  const postApplyHealthCheckCompleted = _truthy(workflowState.postApplyHealthCheckCompleted) ||
    _hasCompletedTools(completedTools, HEALTH_CHECK_VERIFY_TOOLS);
  const separateApprovalAfterReinspect = _truthy(workflowState.separateApprovalAfterReinspect);
  const healthCheckWriteNeedsVerification = workflowId === "health-check" &&
    !!lastAppliedBoundary &&
    !postApplyHealthCheckCompleted;
  if (healthCheckWriteNeedsVerification) {
    checks.push(_makeCheck({
      id: "post_apply_health_check_verification",
      title: "Post-apply health-check verification",
      status: "fail",
      severity: "error",
      message: "After a health-check repair write, the agent must rerun the full read-only health-check sequence before reporting clean or remaining findings.",
      evidence: [
        `lastAppliedBoundary=${lastAppliedBoundary}`,
        `postApplyHealthCheckCompleted=${Boolean(postApplyHealthCheckCompleted)}`,
        `completedTools=${completedTools.join(",")}`,
      ],
      nextAction: "Run sync_figma_data, detect_design_system, audit_tokens, inspect_ds_setup_gaps, and inspect_ds_token_gaps again. Summarize remaining findings only from those fresh results, not from the apply result or a narrow token-only reinspection. Reconcile stale pre-apply findings against the fresh reports; do not repeat missing Tablet/Desktop modes if detect_design_system or inspect_ds_token_gaps no longer reports them, and describe the completed repair by its named boundary or token list instead of a drifting option number.",
      recommendedTool: "sync_figma_data",
      recommendedPayloadSource: "full health-check verification sequence",
    }));
  } else {
    checks.push(_makeCheck({
      id: "post_apply_health_check_verification",
      title: "Post-apply health-check verification",
      status: "pass",
      severity: "info",
      message: "No missing full health-check verification after a health-check write detected.",
      evidence: [
        lastAppliedBoundary ? `lastAppliedBoundary=${lastAppliedBoundary}` : null,
        `postApplyHealthCheckCompleted=${Boolean(postApplyHealthCheckCompleted)}`,
      ].filter(Boolean),
      nextAction: "After health-check writes, verify with the full read-only health-check sequence before summarizing remaining findings, and reconcile stale pre-apply findings against the fresh reports.",
    }));
  }
  const requestsAnotherWriteAfterFoundation = writeRequested &&
    lastAppliedBoundary === "foundation" &&
    _normalizeBoundary(writeBoundary || requestedTool) !== "foundation" &&
    requestedTool !== "apply_ds_foundation_repairs";
  const requestsWriteAfterUnlockedRepairs = writeRequested && lastApplyUnlockedRepairs;
  if ((requestsAnotherWriteAfterFoundation || requestsWriteAfterUnlockedRepairs) &&
    (!postApplySyncReinspectCompleted || !separateApprovalAfterReinspect)) {
    checks.push(_makeCheck({
      id: "post_apply_stop_boundary",
      title: "Post-apply stop boundary",
      status: "fail",
      severity: "error",
      message: "After a foundation repair or a write that unlocks new work, the agent must sync, reinspect, report the new plan, and stop before continuing to another write.",
      evidence: [
        lastAppliedBoundary ? `lastAppliedBoundary=${lastAppliedBoundary}` : null,
        `lastApplyUnlockedNewRepairs=${Boolean(lastApplyUnlockedRepairs)}`,
        `postApplySyncReinspectCompleted=${Boolean(postApplySyncReinspectCompleted)}`,
        `separateApprovalAfterReinspect=${Boolean(separateApprovalAfterReinspect)}`,
        requestedTool ? `requestedTool=${requestedTool}` : null,
      ].filter(Boolean),
      nextAction: "Run the read-only verification/sync sequence, summarize any newly available work as a fresh approval boundary, and ask for a separate approval before the next write.",
      recommendedTool: workflowId === "health-check" ? "sync_figma_data" : "inspect_ds_token_gaps",
      recommendedPayloadSource: "fresh post-apply inspection result",
    }));
  } else {
    checks.push(_makeCheck({
      id: "post_apply_stop_boundary",
      title: "Post-apply stop boundary",
      status: "pass",
      severity: "info",
      message: "No unsafe continuation after an apply step detected.",
      evidence: [
        lastAppliedBoundary ? `lastAppliedBoundary=${lastAppliedBoundary}` : null,
        `lastApplyUnlockedNewRepairs=${Boolean(lastApplyUnlockedRepairs)}`,
      ].filter(Boolean),
      nextAction: "After any write, sync/reinspect and ask separately before applying newly surfaced work.",
    }));
  }

  const hasAnyApplyPath = _truthy(repairPlanState.hasApplyInput) ||
    _truthy(repairPlanState.hasOptionalApplyInput) ||
    _truthy(repairPlanState.hasFoundationRepairPlan) ||
    _truthy(repairPlanState.hasPrimitiveRepairPlan) ||
    Number(repairPlanState.fixableNowCount || 0) > 0;
  if (_truthy(repairPlanState.hasMissingCapabilityNotes) && !hasAnyApplyPath) {
    checks.push(_makeCheck({
      id: "product_gap_response",
      title: "Planner coverage response",
      status: "warn",
      severity: "warning",
      message: "Figlets reported missing capability notes without a product-specific apply-ready path.",
      evidence: ["repairPlanState.hasMissingCapabilityNotes=true"],
      nextAction: "If the designer request is an exact designer-specified variable, collection, mode, style, binding, metadata, or lifecycle edit, use plan_ds_figma_operations. Otherwise report the missing product-specific planner/apply surface without inventing raw Figma scripts, generic rename batches, or presenting the work as impossible.",
    }));
  } else {
    checks.push(_makeCheck({
      id: "product_gap_response",
      title: "Product gap response",
      status: "pass",
      severity: "info",
      message: "No unsupported planner-coverage dead-end risk detected.",
      evidence: [],
      nextAction: "Use existing repairPlan channels when present; use plan_ds_figma_operations for exact designer-specified high-level Figma edits.",
    }));
  }

  const isQaFix = requestedTool === "qa_binding_audit:fix" || requestedQaFix ||
    (requestedTool === "qa_binding_audit" && requestedKind === "write");
  if (isQaFix && (Number(repairPlanState.fixableNowCount || 0) <= 0 || approvalStatus !== "granted")) {
    checks.push(_makeCheck({
      id: "binding_fixability_boundary",
      title: "Binding fixability boundary",
      status: "fail",
      severity: "error",
      message: "qa_binding_audit fixes are only allowed for fixableNow findings after approval.",
      evidence: [`fixableNowCount=${Number(repairPlanState.fixableNowCount || 0)}`, `approvalStatus=${approvalStatus}`],
      nextAction: "Run/read qa_binding_audit first, summarize byFixability, and apply fix:true only for fixableNow after approval.",
      recommendedTool: "qa_binding_audit",
      recommendedPayloadSource: "repairPlan.applyInput",
    }));
  } else {
    checks.push(_makeCheck({
      id: "binding_fixability_boundary",
      title: "Binding fixability boundary",
      status: "pass",
      severity: "info",
      message: "No unsafe binding fix request detected.",
      evidence: [],
      nextAction: "Use qa_binding_audit({ fix: true }) only for fixableNow after approval.",
    }));
  }

  const includesDesignerDecisionBinding = isQaFix && (
    _truthy(requestedAction.includesDesignerDecision) ||
    _normalizeBoundary(requestedAction.fixability) === "needsdesignerdecision" ||
    Number(repairPlanState.needsDesignerDecisionCount || 0) > 0 && _truthy(requestedAction.applyDesignerDecisions)
  );
  if (includesDesignerDecisionBinding && !_truthy(repairPlanState.hasDesignerDecisionApplyInput)) {
    checks.push(_makeCheck({
      id: "binding_designer_decision_boundary",
      title: "Binding designer decision boundary",
      status: "fail",
      severity: "error",
      message: "qa_binding_audit({ fix: true }) only applies fixableNow findings; designer-decision binding suggestions need a separate exposed apply payload.",
      evidence: [
        `needsDesignerDecisionCount=${Number(repairPlanState.needsDesignerDecisionCount || 0)}`,
        "hasDesignerDecisionApplyInput=false",
      ],
      nextAction: "Stop before writing designer-decision bindings through fix:true. Use the exposed designer-decision apply payload if Figlets provides one; if the designer gives exact node/style/variable targets, route those exact binding operations through plan_ds_figma_operations.",
      recommendedTool: "qa_binding_audit",
      recommendedPayloadSource: "designer-decision apply payload",
    }));
  } else {
    checks.push(_makeCheck({
      id: "binding_designer_decision_boundary",
      title: "Binding designer decision boundary",
      status: "pass",
      severity: "info",
      message: "No unsafe designer-decision binding apply request detected.",
      evidence: [],
      nextAction: "Keep fix:true limited to fixableNow; use a separate payload for approved designer-decision suggestions.",
    }));
  }

  if (host.mcpSessionFreshness === "stale_suspected") {
    checks.push(_makeCheck({
      id: "stale_host_suspicion",
      title: "Stale host suspicion",
      status: "warn",
      severity: "warning",
      message: "The MCP host/session may be stale.",
      evidence: ["context.host.mcpSessionFreshness=stale_suspected"],
      nextAction: "Validate with a fresh stdio Figlets MCP server or restart/reconnect the host before calling this a repo regression.",
    }));
  } else {
    checks.push(_makeCheck({
      id: "stale_host_suspicion",
      title: "Stale host suspicion",
      status: "pass",
      severity: "info",
      message: "No stale-host signal was provided.",
      evidence: host.mcpSessionFreshness ? [`mcpSessionFreshness=${host.mcpSessionFreshness}`] : [],
      nextAction: "If host output contradicts current repo behavior, validate with a fresh stdio server.",
    }));
  }

  if (host.bridgeState === "disconnected") {
    checks.push(_makeCheck({
      id: "bridge_readiness",
      title: "Bridge readiness",
      status: "warn",
      severity: "warning",
      message: "Live designer workflows need Figma Desktop and the Figlets Bridge plugin open.",
      evidence: ["context.host.bridgeState=disconnected"],
      nextAction: "Ask the designer to open Figma Desktop and the Figlets Bridge plugin before live read/write workflow steps.",
    }));
  } else {
    checks.push(_makeCheck({
      id: "bridge_readiness",
      title: "Bridge readiness",
      status: "info",
      severity: "info",
      message: "Bridge state was not reported as disconnected.",
      evidence: host.bridgeState ? [`bridgeState=${host.bridgeState}`] : [],
      nextAction: "For live workflows, make sure Figma Desktop and Figlets Bridge are open.",
    }));
  }

  checks.push(_makeCheck({
    id: "release_docs_readiness",
    title: "Release/docs readiness",
    status: "info",
    severity: "info",
    message: "Public onboarding and release claims should stay aligned with README and release verification.",
    evidence: [],
    nextAction: "Use README/release tasks for public install claims; do not imply future features are shipped.",
  }));

  const blockingReasons = checks
    .filter(check => check.status === "fail")
    .map(check => check.message);
  const hasWarn = checks.some(check => check.status === "warn");
  let status = "ready";
  if (blockingReasons.length) status = "blocked";
  else if (hasWarn) status = "warning";
  else if (!workflow || (mode === "unknown" && !_nonEmpty(goal))) status = "needs_input";

  const fallbackNextAction = status === "ready"
    ? {
      type: "continue",
      tool: null,
      argsSource: null,
      message: "Continue with the Figlets workflow guide and keep writes approval-gated.",
    }
    : {
      type: "call_tool",
      tool: "figlets_start",
      argsSource: "{}",
      message: "Call figlets_start or provide context.goal/context.workflowId so Figlets can give precise workflow guidance.",
    };
  const nextAction = _chooseNextAction(checks, fallbackNextAction);

  return {
    status,
    summary: status === "blocked"
      ? "Figlets workflow is blocked until the failed checks are resolved."
      : status === "warning"
        ? "Figlets workflow can continue with caution after reviewing warnings."
        : status === "needs_input"
          ? "Figlets needs a workflow goal or starting context to give precise guidance."
          : "Figlets workflow readiness checks passed for the supplied context.",
    nextAction,
    blockingReasons,
    checks,
    boundaries: {
      readOnly: true,
      figmaMutationAllowed: false,
      hostSpecificBehavior: false,
    },
  };
}

function handleFigletsStart() {
  return getStartGuide();
}

function handleFigletsRouteIntent(args) {
  return routeIntent(args && args.intent);
}

function handleFigletsWorkflowGuide(args) {
  const workflowId = args && args.workflow_id;
  const workflow = getWorkflowGuide(workflowId);
  const response = {
    workflow,
    hardRules: DESIGNER_FLOW_HARD_RULES,
    availableWorkflows: listWorkflows().map(item => ({ id: item.id, title: item.title })),
    presentationRule: "For inspect_ds_setup_gaps, prefer repairPlan.designerPresentation and show every ready-to-apply proposed change (proposedChanges or What will change) before asking approval — not only counts. For inspect_ds_token_gaps in health-check, summarize token-gap findings by category, explicitly call out foundation mode suggestions such as missing Tablet/Desktop modes, include available token-gap boundaries in the final next-step prompt, and show exact token/mode rows only when asking approval for that boundary. End health-check repair summaries with a numbered repair choice menu: numbered category options written in designer goal language, all ready safe repairs with included/excluded categories named, and specific/other for exact fixes. Do not use implementation terms like dry-run in menu labels; say review/fix/plan/add and explain confirmation happens before changes. For qa_binding_audit, prefer repairPlan, byFixability, and plain-language counts over raw violation dumps. Avoid technical verification matrices unless the designer asks for exact details.",
    bulkRepairRouting: DESIGNER_FLOW_HARD_RULES.bulkRepairRouting,
    message: `Workflow guide: ${workflow.title}. Follow the steps in order, use the named Figlets tools/scripts only, follow bulkRepairRouting when choosing repair surfaces, use structured repairPlan payloads when Figlets provides them, summarize tool output in plain language, and ask for approval before any write step.`,
  };
  if (workflow.id === "new-ds-setup" && workflow.intakeContract) {
    response.intakeContract = workflow.intakeContract;
    response.intakePresentationRule = workflow.intakeContract.firstResponseRule;
    response.message = `Workflow guide: ${workflow.title}. Treat the designer prompt as initial direction, not a complete spec. Ask intake questions first and do not draft a full proposal, palette, typography stack, grid defaults, or token names before intake. Run setup intake before create_ds_config_from_intake and prepare_ds_config. Follow the steps in order, summarize plainly, and ask for approval before any write step.`;
  }
  if (workflow.id === "token-gap-completion" && workflow.approvalContract) {
    response.approvalContract = workflow.approvalContract;
    response.message = `Workflow guide: ${workflow.title}. Follow the steps in order through dry-run previews first. Do not call apply_ds_foundation_repairs, update_ds_primitives, or update_ds_tokens with dry_run:false until the designer explicitly approves the specific write boundary after seeing the plan. Routing goal phrases are not approval to write. Present foundation collection/mode creation, primitive updates, and semantic token updates as separate options with separate approvals. If foundationRepairPlan is approved, use only repairPlan.foundationRepairPlan.applyInput, then sync and reinspect, then stop before any primitive or semantic token write. Use repairPlan.primitiveRepairPlan.applyInput and repairPlan.applyInput exactly only after their own separate approvals. Summarize plainly and ask for approval before any write step.`;
  }
  return response;
}

module.exports = {
  figletsStartTool,
  figletsRouteIntentTool,
  figletsWorkflowGuideTool,
  figletsHealthCheckTool,
  handleFigletsStart,
  handleFigletsRouteIntent,
  handleFigletsWorkflowGuide,
  handleFigletsHealthCheck,
  asTextResult,
};
