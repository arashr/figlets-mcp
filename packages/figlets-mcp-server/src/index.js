const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { ensureReceiverRunning } = require("./utils/ensure-receiver.js");

const { detectDesignSystemTool, handleDetectDesignSystem } = require("./tools/detect-design-system.js");
const { inspectComponentTool, handleInspectComponent } = require("./tools/inspect-component.js");
const { syncFigmaDataTool, handleSyncFigmaData } = require("./tools/sync-figma-data.js");
const { auditTokensTool, handleAuditTokens } = require("./tools/audit-tokens.js");
const { buildShowcaseTool, handleBuildShowcase } = require("./tools/build-showcase.js");
const { handlePrepareDsConfig } = require("./tools/prepare-ds-config.js");
const { handleApplyDsSetup } = require("./tools/apply-ds-setup.js");
const { updateDsPrimitivesTool, handleUpdateDsPrimitives } = require("./tools/update-ds-primitives.js");
const { inspectDsSetupGapsTool, handleInspectDsSetupGaps } = require("./tools/inspect-ds-setup-gaps.js");
const { inspectDsTokenGapsTool, handleInspectDsTokenGaps } = require("./tools/inspect-ds-token-gaps.js");
const { updateDsTokensTool, handleUpdateDsTokens } = require("./tools/update-ds-tokens.js");
const { applyDsFoundationRepairsTool, handleApplyDsFoundationRepairs } = require("./tools/apply-ds-foundation-repairs.js");
const { applyDsSetupRepairsTool, handleApplyDsSetupRepairs } = require("./tools/apply-ds-setup-repairs.js");
const {
  planSemanticNamingConsolidationTool,
  applySemanticNamingConsolidationTool,
  handlePlanSemanticNamingConsolidation,
  handleApplySemanticNamingConsolidation,
} = require("./tools/semantic-naming-consolidation.js");
const {
  planDsVariableCreationsTool,
  applyDsVariableCreationsTool,
  handlePlanDsVariableCreations,
  handleApplyDsVariableCreations,
} = require("./tools/variable-creations.js");
const {
  planDsFigmaOperationsTool,
  applyDsFigmaOperationsTool,
  handlePlanDsFigmaOperations,
  handleApplyDsFigmaOperations,
} = require("./tools/figma-operations.js");
const { refreshDsConfigFromFigmaTool, handleRefreshDsConfigFromFigma } = require("./tools/refresh-ds-config-from-figma.js");
const { generateComponentDocTool, handleGenerateComponentDoc } = require("./tools/generate-component-doc.js");
const { qaBindingAuditTool, handleQaBindingAudit } = require("./tools/qa-binding-audit.js");
const { designMdIntakeTool, handleCreateDsConfigFromDesignMd } = require("./tools/design-md-intake.js");
const { exportDesignMdTool, handleExportDesignMd } = require("./tools/export-design-md.js");
const {
  figletsStartTool,
  figletsRouteIntentTool,
  figletsWorkflowGuideTool,
  figletsHealthCheckTool,
  handleFigletsStart,
  handleFigletsRouteIntent,
  handleFigletsWorkflowGuide,
  handleFigletsHealthCheck,
} = require("./tools/agent-interface.js");

const { version: serverVersion } = require("../package.json");

const server = new McpServer({
  name: "figlets-mcp",
  version: serverVersion
});

// --- figlets_start ---
server.tool(
  figletsStartTool.name,
  figletsStartTool.description,
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(handleFigletsStart(), null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- figlets_route_intent ---
server.tool(
  figletsRouteIntentTool.name,
  figletsRouteIntentTool.description,
  {
    intent: z.string().describe("The designer's natural-language request, such as 'check my design system' or 'document this component'.")
  },
  async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(handleFigletsRouteIntent(args), null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- figlets_workflow_guide ---
server.tool(
  figletsWorkflowGuideTool.name,
  figletsWorkflowGuideTool.description,
  {
    workflow_id: z.string().describe("Workflow id returned by figlets_start or figlets_route_intent, e.g. setup-gap-qa, build-showcase, component-docs.")
  },
  async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(handleFigletsWorkflowGuide(args), null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- figlets_health_check ---
server.tool(
  figletsHealthCheckTool.name,
  figletsHealthCheckTool.description,
  {
    context: z.object({
      mode: z.enum(["designer", "developer", "unknown"]).optional(),
      goal: z.string().optional(),
      intent: z.string().optional(),
      workflowId: z.string().optional(),
      host: z.object({
        name: z.string().optional(),
        mcpSessionFreshness: z.enum(["fresh", "stale_suspected", "unknown"]).optional(),
        bridgeState: z.enum(["connected", "disconnected", "unknown"]).optional(),
      }).optional(),
    }).optional(),
    workflowState: z.object({
      figletsStartCalled: z.boolean().optional(),
      routeIntentCalled: z.boolean().optional(),
      workflowGuideCalled: z.boolean().optional(),
      completedTools: z.array(z.string()).optional(),
      lastTool: z.string().optional(),
      lastToolStatus: z.enum(["success", "error", "unknown"]).optional(),
      pendingWriteTool: z.string().optional(),
      approvalStatus: z.enum(["not_needed", "needed", "granted", "denied", "unknown"]).optional(),
    }).passthrough().optional(),
    repairPlanState: z.object({
      sourceTool: z.string().optional(),
      hasApplyInput: z.boolean().optional(),
      hasOptionalApplyInput: z.boolean().optional(),
      hasFoundationRepairPlan: z.boolean().optional(),
      hasPrimitiveRepairPlan: z.boolean().optional(),
      hasMissingCapabilityNotes: z.boolean().optional(),
      fixableNowCount: z.number().optional(),
    }).passthrough().optional(),
    requestedAction: z.object({
      tool: z.string().optional(),
      kind: z.enum(["read", "write", "unknown"]).optional(),
      payloadSource: z.enum([
        "repairPlan.applyInput",
        "repairPlan.optionalApplyInput",
        "repairPlan.foundationRepairPlan.applyInput",
        "repairPlan.primitiveRepairPlan",
        "hand_authored",
        "unknown",
      ]).optional(),
    }).passthrough().optional(),
  },
  async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(handleFigletsHealthCheck(args), null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- detect_design_system ---
server.tool(
  detectDesignSystemTool.name,
  detectDesignSystemTool.description,
  {
    target: z.string().optional().describe("A file key, node id, or adapter-specific target reference."),
    figmaDataPath: z.string().optional().describe("Path to a local JSON file containing Figma data."),
    figmaDataCommand: z.string().optional().describe("Shell command that prints a Figma-like JSON payload to stdout.")
  },
  async (args) => {
    try {
      const result = handleDetectDesignSystem(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- sync_figma_data ---
server.tool(
  syncFigmaDataTool.name,
  syncFigmaDataTool.description,
  {},
  async () => {
    try {
      return await handleSyncFigmaData();
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- inspect_component ---
server.tool(
  inspectComponentTool.name,
  inspectComponentTool.description,
  {},
  async () => {
    try {
      return await handleInspectComponent();
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- audit_tokens ---
server.tool(
  auditTokensTool.name,
  auditTokensTool.description,
  {
    figmaDataPath: z.string().optional().describe("Optional path to the figma-data.json snapshot.")
  },
  async (args) => {
    try {
      return handleAuditTokens(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- build_ds_showcase ---
server.tool(
  buildShowcaseTool.name,
  buildShowcaseTool.description,
  {
    numericFallback: z.object({
      radius: z.enum(["exact", "nearest", "floor", "ceil"]).optional(),
      border: z.enum(["exact", "nearest", "floor", "ceil"]).optional(),
      spacing: z.enum(["exact", "nearest", "floor", "ceil"]).optional(),
      maxDistance: z.number().min(0).optional()
    }).optional().describe("Optional numeric fallback policy for generated showcase chrome when no exact variable exists. Colors never use nearest-neighbor matching.")
  },
  async (args) => {
    try {
      return await handleBuildShowcase(args || {});
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- create_ds_config_from_design_md ---
server.tool(
  designMdIntakeTool.name,
  designMdIntakeTool.description,
  {
    design_md_path: z.string().describe("Absolute path to DESIGN.md."),
    config_path: z.string().describe("Absolute path where design-system.config.js should be written.")
  },
  async (args) => {
    try {
      const result = handleCreateDsConfigFromDesignMd(args);
      if (result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- export_design_md ---
server.tool(
  exportDesignMdTool.name,
  exportDesignMdTool.description,
  {
    config_path: z.string().optional().describe("Optional absolute path to design-system.config.js. Defaults to the active file config."),
    output_path: z.string().optional().describe("Optional absolute path for the DESIGN.md output. Defaults to DESIGN.md next to the config."),
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. When provided, sync is skipped."),
    skip_sync: z.boolean().optional().describe("When true, skip the sync_figma_data step and use whatever snapshot is already on disk."),
    dry_run: z.boolean().optional().describe("When true, do not write design-system.config.js or DESIGN.md; report what would change.")
  },
  async (args) => {
    try {
      const result = await handleExportDesignMd(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- prepare_ds_config ---
server.tool(
  "prepare_ds_config",
  "Run the DS computation pipeline on an existing design-system.config.js: generates spacing scale, color ramps with WCAG/APCA analysis, validates semantic bg+text pair contrast, and prepares the Collection 1 primitives payload. Must be called after intake and before apply_ds_setup.",
  {
    config_path: z.string().describe("Absolute path to design-system.config.js (created during intake).")
  },
  async (args) => {
    try {
      const result = handlePrepareDsConfig(args);
      if (result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- apply_ds_setup ---
server.tool(
  "apply_ds_setup",
  "Build all 5 Figma variable collections from a prepared design-system.config.js. Creates: Primitives (color ramps, scrims, type + spacing floats), Color Semantics (Light/Dark aliases), Typography (responsive type vars per breakpoint), Spacing (responsive semantic spacing), and Elevation (shadow floats + Effect Styles). Requires the Figlets Bridge plugin open in Figma Desktop. Call prepare_ds_config first.",
  {
    config_path: z.string().describe("Absolute path to design-system.config.js (must have been prepared by prepare_ds_config).")
  },
  async (args) => {
    try {
      const result = await handleApplyDsSetup(args);
      if (result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- update_ds_primitives ---
server.tool(
  updateDsPrimitivesTool.name,
  updateDsPrimitivesTool.description,
  {
    config_path: z.string().describe("Absolute path to design-system.config.js (must have been prepared by prepare_ds_config)."),
    categories: z.array(z.string()).optional().describe('Optional list of primitive categories to update. Supported today: "color", "spacing", "color-semantics", "primitive-typography", "primitive-shadow". Defaults to color, spacing, and color-semantics when omitted.'),
    create_missing: z.boolean().optional().describe("When true, create missing primitive or semantic variables inside existing collections before setting values. Existing variable IDs are preserved."),
    dry_run: z.boolean().optional().describe("When true, report variables that would be created or updated but do not mutate Figma. Use before create_missing repairs for designer confirmation."),
    prune_off_scale: z.boolean().optional().describe("When true, delete primitive color variables whose step number is not in the configured scale."),
    prune_unused_ramps: z.boolean().optional().describe("When true, delete primitive color variables that belong to ramp folders not present in the current config.")
  },
  async (args) => {
    try {
      const result = await handleUpdateDsPrimitives(args);
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- refresh_ds_config_from_figma ---
server.tool(
  refreshDsConfigFromFigmaTool.name,
  refreshDsConfigFromFigmaTool.description,
  {
    config_path: z.string().optional().describe("Optional file-scoped design-system.config.js path. Defaults to the active file config."),
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."),
    dry_run: z.boolean().optional().describe("When true, report changes without writing design-system.config.js.")
  },
  async (args) => {
    try {
      const result = handleRefreshDsConfigFromFigma(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- inspect_ds_setup_gaps ---
server.tool(
  inspectDsSetupGapsTool.name,
  inspectDsSetupGapsTool.description,
  {
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."),
    config_path: z.string().optional().describe("Optional file-scoped design-system.config.js path. Used only to read contrastAlgorithm; inspection remains read-only."),
    answers: z.object({
      algorithm: z.enum(["wcag", "apca"]).optional()
    }).optional().describe("Optional QA choices. Pass algorithm to override the config's contrast algorithm for this inspection.")
  },
  async (args) => {
    try {
      const result = handleInspectDsSetupGaps(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- inspect_ds_token_gaps ---
server.tool(
  inspectDsTokenGapsTool.name,
  inspectDsTokenGapsTool.description,
  {
    config_path: z.string().optional().describe("Optional file-scoped design-system.config.js path. Defaults to the active file config."),
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."),
    categories: z.array(z.string()).optional().describe("Optional config-backed categories to inspect. Phase 3A supports non-color token categories such as primitive-typography, primitive-shadow, spacing-semantics, radius, border-width, typography, typography-variables, elevation, and elevation-variables."),
    include_existing_updates: z.boolean().optional().describe("When true, preserve the request in update_ds_tokens preview/apply payloads. Phase 3B remains read-only and does not compare stale values.")
  },
  async (args) => {
    try {
      const result = handleInspectDsTokenGaps(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- update_ds_tokens ---
server.tool(
  updateDsTokensTool.name,
  updateDsTokensTool.description,
  {
    config_path: z.string().describe("Absolute path to design-system.config.js."),
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."),
    categories: z.array(z.string()).optional().describe("Optional categories to preview. Supports non-color config-backed categories such as primitive-typography, primitive-shadow, spacing-semantics, radius, border-width, typography, typography-variables, typography-styles, elevation, elevation-variables, and elevation-styles."),
    create_missing: z.boolean().optional().describe("When true, missing variables/styles are reported as wouldCreate*. When false, they remain unmatched/missing only."),
    dry_run: z.boolean().optional().describe("When true, preview without mutating Figma. dry_run=false is limited to approved narrow token categories."),
    ensure_collection_modes: z.boolean().optional().describe("When true on apply, add configured breakpoint modes to existing Spacing and Typography collections before responsive token writes."),
    spacing_semantic_repairs: z.array(z.object({
      name: z.string(),
      updates: z.array(z.object({
        modeId: z.string().optional(),
        modeName: z.string().optional(),
        toAliasId: z.string().optional(),
        toAliasName: z.string().optional(),
        configExpected: z.number().optional(),
      }).passthrough()),
    })).optional().describe("Optional exact semantic spacing alias repairs copied from inspect_ds_token_gaps.repairPlan.applyInput.spacing_semantic_repairs. When provided, update_ds_tokens applies only these token/mode entries instead of the whole spacing-semantics category."),
    prune: z.object({
      off_config_variables: z.boolean().optional(),
      off_config_text_styles: z.boolean().optional(),
      off_config_effect_styles: z.boolean().optional(),
      config_authoritative: z.boolean().optional().describe("Required for dry_run:false when any token prune flag is set."),
      off_scale_color_steps: z.boolean().optional(),
      unused_color_ramps: z.boolean().optional()
    }).optional().describe("Optional approved prune scope. Token prune deletes managed off-config variables/styles only when config_authoritative is true on apply. Color ramp prune belongs on update_ds_primitives.")
  },
  async (args) => {
    try {
      const result = await handleUpdateDsTokens(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- apply_ds_foundation_repairs ---
server.tool(
  applyDsFoundationRepairsTool.name,
  applyDsFoundationRepairsTool.description,
  {
    config_path: z.string().describe("Absolute path to design-system.config.js."),
    collections: z.array(z.object({
      kind: z.enum(["primitives", "spacing", "typography", "elevation"]).describe("Configured foundation collection kind."),
      name: z.string().describe("Configured collection name copied from inspect_ds_token_gaps."),
      modes: z.array(z.string()).optional().describe("Mode names copied from inspect_ds_token_gaps; the server recomputes expected modes from config before sending to Figma.")
    })).describe("Approved missing foundation collection shells copied from inspect_ds_token_gaps.repairPlan.foundationRepairPlan.applyInput.collections.")
  },
  async (args) => {
    try {
      const result = await handleApplyDsFoundationRepairs(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- apply_ds_setup_repairs ---
server.tool(
  applyDsSetupRepairsTool.name,
  applyDsSetupRepairsTool.description,
  {
    repairs: z.array(z.object({
      bg: z.string(),
      recommended: z.string().optional(),
      name: z.string().optional(),
      source: z.string(),
      aliases: z.any().optional().describe("Per-mode primitive variable names approved by the designer from inspect_ds_setup_gaps.repairPlan.applyInput. Preserve the object exactly; never replace it with a count, summary, boolean, or prose-derived value.")
    })).optional().describe("Designer-approved missing-foreground repairs, usually copied from inspect_ds_setup_gaps.semanticGaps."),
    aliasUpdates: z.array(z.object({
      token: z.string().describe("Existing semantic variable name to re-alias."),
      mode: z.string().describe("Mode name to update, e.g. Light or Dark."),
      newAliasTarget: z.string().optional().describe("Primitive variable name the token should alias in this mode."),
      to: z.string().optional().describe("Legacy alias for newAliasTarget, accepted for plannedReAlias round-trips."),
      expectedCurrentAlias: z.string().optional().describe("Optional primitive variable name the token was expected to alias when approved."),
      from: z.string().optional().describe("Legacy alias for expectedCurrentAlias.")
    })).optional().describe("Designer-approved re-alias updates for existing semantic variables, usually copied from contrastFailures[*].plannedReAlias."),
    roleRepairs: z.array(z.object({
      name: z.string().describe("Semantic role variable to create, e.g. color/border/info, color/icon/success, color/outline/focus, or an approved foreground role."),
      role: z.string().describe("Role type, usually border, icon, focus-border, or foreground."),
      pairedBg: z.string().optional().describe("Optional background token from the planner when this role belongs to a specific surface."),
      expectedCurrentPairText: z.string().optional().describe("Optional stale-approval guard for pair text remaps."),
      expectedCurrentPairIcon: z.string().optional().describe("Optional stale-approval guard for pair icon remaps."),
      aliases: z.any().describe("Per-mode primitive variable names approved by the designer from inspect_ds_setup_gaps.repairPlan.applyInput. Preserve the object exactly; never replace it with a count, summary, boolean, or prose-derived value.")
    })).optional().describe("Designer-approved missing border/icon/focus-border/foreground semantic role variables copied or filtered from inspect_ds_setup_gaps.repairPlan.applyInput or optionalApplyInput."),
    config_path: z.string().optional().describe("Optional file-scoped design-system.config.js path to update after Figma succeeds. Defaults to the active file config."),
    update_config: z.boolean().optional().describe("When false, do not update design-system.config.js after applying repairs. Defaults to true."),
    answers: z.object({
      algorithm: z.enum(["wcag", "apca"]).optional()
    }).optional().describe("Optional repair choices. Pass algorithm to override the config's contrast algorithm when recomputing aliases.")
  },
  async (args) => {
    try {
      const result = await handleApplyDsSetupRepairs(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- plan_ds_semantic_naming_consolidation ---
server.tool(
  planSemanticNamingConsolidationTool.name,
  planSemanticNamingConsolidationTool.description,
  {
    canonicalConvention: z.enum(["surface-based", "role-based"]).describe("The naming convention the designer chose after reviewing semanticNamingConflicts."),
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data.")
  },
  async (args) => {
    try {
      const result = handlePlanSemanticNamingConsolidation(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- apply_ds_semantic_naming_consolidation ---
server.tool(
  applySemanticNamingConsolidationTool.name,
  applySemanticNamingConsolidationTool.description,
  {
    canonicalConvention: z.enum(["surface-based", "role-based"]).describe("The naming convention approved by the designer."),
    renameVariables: z.array(z.object({
      id: z.string().describe("Figma variable id copied from plan_ds_semantic_naming_consolidation.repairPlan.applyInput."),
      expectedCurrentName: z.string().describe("Current variable name expected when the designer approved the plan."),
      newName: z.string().describe("Compatibility namespace name to assign while preserving the variable id."),
      canonicalName: z.string().describe("Canonical variable name the duplicate maps to."),
      canonicalId: z.string().describe("Canonical Figma variable id copied from the dry-run plan."),
      family: z.string().optional(),
      role: z.string().optional(),
      expectedEquivalence: z.object({
        status: z.string(),
        modeCount: z.number().optional(),
        modes: z.array(z.object({
          modeId: z.string(),
          mode: z.string().optional(),
          canonicalSignature: z.string(),
          duplicateSignature: z.string()
        }))
      }).describe("Per-mode value/alias signatures copied from the dry-run plan."),
      reason: z.string().optional()
    })).describe("Approved rename entries copied or filtered from plan_ds_semantic_naming_consolidation.repairPlan.applyInput.renameVariables.")
  },
  async (args) => {
    try {
      const result = await handleApplySemanticNamingConsolidation(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- plan_ds_variable_creations ---
server.tool(
  planDsVariableCreationsTool.name,
  planDsVariableCreationsTool.description,
  {
    variables: z.array(z.object({
      name: z.string().describe("Exact variable name to create."),
      collection: z.string().describe("Existing Figma variable collection name."),
      type: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]).describe("Figma variable type."),
      values: z.record(z.string(), z.any()).describe("Mode-name map. Use { alias: variableName }, { value: literal }, a number, boolean, string, or color hex string.")
    })).describe("Exact designer-requested variables to validate and preview."),
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data.")
  },
  async (args) => {
    try {
      const result = handlePlanDsVariableCreations(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- apply_ds_variable_creations ---
server.tool(
  applyDsVariableCreationsTool.name,
  applyDsVariableCreationsTool.description,
  {
    variableCreations: z.array(z.object({
      name: z.string(),
      collection: z.string(),
      collectionId: z.string(),
      type: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]),
      modeValues: z.array(z.object({
        mode: z.string(),
        modeId: z.string(),
        kind: z.enum(["alias", "literal"]),
        targetName: z.string().optional(),
        targetId: z.string().optional(),
        value: z.any().optional()
      }))
    })).describe("Approved variable creations copied or filtered from plan_ds_variable_creations.repairPlan.applyInput.variableCreations."),
    figmaDataPath: z.string().optional().describe("Optional snapshot path used for stale approval validation before apply.")
  },
  async (args) => {
    try {
      const result = await handleApplyDsVariableCreations(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- plan_ds_figma_operations ---
server.tool(
  planDsFigmaOperationsTool.name,
  planDsFigmaOperationsTool.description,
  {
    operations: z.array(z.record(z.string(), z.any())).describe("Exact high-level Figma operations to validate. Supported kinds: create_collection, rename_collection, delete_collection, create_mode, rename_mode, delete_mode, create_variable, update_variable, rename_variable, delete_variable."),
    figmaDataPath: z.string().optional().describe("Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data.")
  },
  async (args) => {
    try {
      const result = handlePlanDsFigmaOperations(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- apply_ds_figma_operations ---
server.tool(
  applyDsFigmaOperationsTool.name,
  applyDsFigmaOperationsTool.description,
  {
    operations: z.array(z.record(z.string(), z.any())).describe("Approved operations copied or filtered from plan_ds_figma_operations.repairPlan.applyInput.operations."),
    figmaDataPath: z.string().optional().describe("Optional snapshot path used for stale approval validation before apply.")
  },
  async (args) => {
    try {
      const result = await handleApplyDsFigmaOperations(args || {});
      if (result && result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- generate_component_doc ---
server.tool(
  generateComponentDocTool.name,
  generateComponentDocTool.description,
  {
    component_name: z.string().describe("Name of the COMPONENT or COMPONENT_SET on the current Figma page."),
    description: z.string().optional().describe("Human-readable description (1-2 sentences) shown under the title on the spec sheet. Agent should craft this after inspecting the component."),
    usage_do: z.array(z.string()).optional().describe("Do rules for the usage panel. Agent should ground these in the component's actual purpose, not pass generic placeholders."),
    usage_dont: z.array(z.string()).optional().describe("Don't rules for the usage panel. Agent should ground these in the component's actual purpose."),
    variant_descriptions: z.record(z.string(), z.string()).optional().describe("Map of exact variant name to short purpose (<=10 words).")
  },
  async (args) => {
    try {
      return await handleGenerateComponentDoc(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// --- qa_binding_audit ---
server.tool(
  qaBindingAuditTool.name,
  qaBindingAuditTool.description,
  {
    fix: z.boolean().optional().describe("When true, apply all high-confidence variable/style suggestions in Figma. Defaults to false.")
  },
  async (args) => {
    try {
      return await handleQaBindingAudit(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

async function main() {
  await ensureReceiverRunning();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("figlets-mcp server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
