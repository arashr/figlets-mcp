const { formatPluginNotListening, requestBridgePost } = require("../bridges/bridge-request.js");

const qaBindingAuditTool = {
  name: "qa_binding_audit",
  description:
    "Audits the current Figma selection, or the current page if nothing is selected, for unbound design-system properties. Checks raw fills, strokes, stroke weights, corner radius, auto-layout spacing, and typography. Each violation includes issueNumber, fixability (fixableNow, needsExistingToken, needsDesignerDecision, unsupported), and repairPlan guidance for bulk-safe binding fixes. Present findings as a stable numbered list so the designer can reply with issue numbers. Before asking to apply fixableNow, show each exact raw value -> target token/style; for color suggestions, surface facts/candidates such as rawFill, top candidates, roleCandidate, and textDescendants when present. For needsDesignerDecision color and typography findings, interpret those facts and show a visible recommended target when one is better than the raw repairPlan suggestion. If the designer approves an issue by number with shorthand like ok, good, or good on suggestion, apply the visible recommended target you showed for that issue, not a hidden raw suggestion that you rejected in prose. fix: true applies only fixableNow items. approved_suggestions applies designer-approved decision bindings for the same audited node/property/raw value: use exact entries from repairPlan.designerDecisionApplyInput when the designer accepts the displayed target unchanged, or preserve issueNumber, nodeId, property, rawValue/fillIndex/strokeIndex and replace suggestion with the visible recommended target or designer-named existing token/style when the approved target differs from the raw repairPlan suggestion. color, spacing, radius, and border bind to variables first; typography uses exact text-style matches when possible. Requires the Figlets Bridge plugin open in Figma Desktop.",
  inputSchema: {
    type: "object",
    properties: {
      fix: {
        type: "boolean",
        description: "When true, apply all high-confidence variable/style suggestions in Figma. Defaults to false for report-only QA."
      },
      max_nodes: {
        type: "number",
        description: "Optional safety cap for page-scope audits. Defaults to 2500 nodes so large pages return a bounded partial report instead of timing out."
      },
      deadline_ms: {
        type: "number",
        description: "Optional audit time budget in milliseconds. Defaults to 45000."
      },
      approved_suggestions: {
        type: "array",
        description: "Designer-approved entries for needsDesignerDecision findings. Copy repairPlan.designerDecisionApplyInput.approved_suggestions unchanged when the designer accepts the displayed target unchanged; when the visible recommendation or designer-named target differs, keep the audited issueNumber/nodeId/property/rawValue/fillIndex/strokeIndex and replace suggestion with that exact target.",
        items: {
          type: "object",
          additionalProperties: true
        }
      }
    },
    required: []
  }
};

function handleQaBindingAudit(args = {}) {
  const payload = { fix: !!args.fix };
  if (typeof args.max_nodes === "number") payload.maxNodes = args.max_nodes;
  if (typeof args.deadline_ms === "number") payload.deadlineMs = args.deadline_ms;
  if (Array.isArray(args.approved_suggestions)) payload.approvedSuggestions = args.approved_suggestions;

  return requestBridgePost("/request-qa-audit", payload, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
    timeoutMs: 125000,
    bridgeRetryAttempts: args.bridgeRetryAttempts,
    bridgeRetryDelayMs: args.bridgeRetryDelayMs,
  }).then((response) => {
    return _formatQaAuditResponse(response);
  });
}

function _formatQaAuditResponse(response) {
  if (response.connectionError) {
    return {
      content: [{ type: "text", text: `Error: ${response.connectionError}` }],
      isError: true
    };
  }

  const parsed = response.data || {};
  const statusCode = response.statusCode;
  if (statusCode === 200) {
    const result = parsed.result || parsed;
    if (result.error) {
      return {
        content: [{ type: "text", text: `Plugin error: ${result.error}` }],
        isError: true
      };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          scope: result.scope || "selection",
          fileName: result.fileName || "",
          pageName: result.pageName || "",
          selectedCount: result.selectedCount || 0,
          checkedRootCount: result.checkedRootCount || 0,
          auditedNodeCount: result.auditedNodeCount || 0,
          truncated: !!result.truncated,
          truncateReason: result.truncateReason || "",
          maxNodes: result.maxNodes || 0,
          deadlineMs: result.deadlineMs || 0,
          violationCount: result.violationCount || 0,
          byType: result.byType || {},
          byFixability: result.byFixability || {
            fixableNow: 0,
            needsExistingToken: 0,
            needsDesignerDecision: 0,
            unsupported: 0
          },
          repairPlan: result.repairPlan || null,
          fixApplied: !!result.fixApplied,
          fixedCount: result.fixedCount || 0,
          failedCount: result.failedCount || 0,
          fixed: Array.isArray(result.fixed) ? result.fixed : [],
          failed: Array.isArray(result.failed) ? result.failed : [],
          violations: Array.isArray(result.violations) ? result.violations : [],
          message: `QA audit complete on ${result.fileName || "current file"} / ${result.pageName || "current page"}: ${result.violationCount || 0} violation(s).`
        }, null, 2)
      }]
    };
  }
  if (statusCode === 503) {
    return {
      content: [{ type: "text", text: `Error: ${formatPluginNotListening("QA commands", parsed, { fallbackHint: "Open the Figlets Bridge plugin in Figma Desktop, then retry." })}` }],
      isError: true
    };
  }
  if (statusCode === 504) {
    return {
      content: [{ type: "text", text: "Error: QA audit timed out after automatic retries. The selection may be very large or the plugin may have crashed." }],
      isError: true
    };
  }
  return {
    content: [{ type: "text", text: `Error: Unexpected status ${statusCode}: ${response.raw || ""}` }],
    isError: true
  };
}

module.exports = { qaBindingAuditTool, handleQaBindingAudit };
