"use strict";

const {
  DESIGNER_FLOW_HARD_RULES,
  getStartGuide,
  getWorkflowGuide,
  listWorkflows,
  routeIntent,
} = require("../agent-interface/workflows.js");

const figletsStartTool = {
  name: "figlets_start",
  description:
    "Read-only Agent Interface entrypoint. Returns the Figlets intro, safety contract, runtime environment hints, capability menu, and first designer-facing question. Designer reviews must use Figlets workflows/tools, not custom scripts. Does not inspect or mutate Figma.",
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
    "Read-only Agent Interface guide. Returns the step-by-step contract for a Figlets workflow, including tools, read/write classification, required confirmations, error recovery notes, and safe next workflows. For designer-facing review, use the named Figlets tools/scripts only unless the designer explicitly asks to go out of bounds.",
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

function asTextResult(result) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
  return {
    workflow,
    hardRules: DESIGNER_FLOW_HARD_RULES,
    availableWorkflows: listWorkflows().map(item => ({ id: item.id, title: item.title })),
    message: `Workflow guide: ${workflow.title}. Follow the steps in order, use the named Figlets tools/scripts only, summarize tool output in plain language, and ask for approval before any write step.`,
  };
}

module.exports = {
  figletsStartTool,
  figletsRouteIntentTool,
  figletsWorkflowGuideTool,
  handleFigletsStart,
  handleFigletsRouteIntent,
  handleFigletsWorkflowGuide,
  asTextResult,
};
