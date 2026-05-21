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
const { refreshDsConfigFromFigmaTool, handleRefreshDsConfigFromFigma } = require("./tools/refresh-ds-config-from-figma.js");
const { generateComponentDocTool, handleGenerateComponentDoc } = require("./tools/generate-component-doc.js");
const { qaBindingAuditTool, handleQaBindingAudit } = require("./tools/qa-binding-audit.js");
const { designMdIntakeTool, handleCreateDsConfigFromDesignMd } = require("./tools/design-md-intake.js");
const { exportDesignMdTool, handleExportDesignMd } = require("./tools/export-design-md.js");
const {
  figletsStartTool,
  figletsRouteIntentTool,
  figletsWorkflowGuideTool,
  handleFigletsStart,
  handleFigletsRouteIntent,
  handleFigletsWorkflowGuide,
} = require("./tools/agent-interface.js");

const server = new McpServer({
  name: "figlets-mcp",
  version: "0.1.0"
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
    categories: z.array(z.string()).optional().describe('Optional list of primitive categories to update. Supported today: "color", "spacing", "color-semantics", "primitive-typography". Defaults to color, spacing, and color-semantics when omitted.'),
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
    prune: z.object({
      off_scale_color_steps: z.boolean().optional(),
      unused_color_ramps: z.boolean().optional()
    }).optional().describe("Future prune options. Phase 3B reports them as unsupported rather than deleting anything.")
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
      aliases: z.record(z.string(), z.string()).optional().describe("Per-mode primitive variable names approved by the designer, usually copied from plannedAliases.")
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
      name: z.string().describe("Semantic role variable to create, e.g. color/border/info, color/icon/success, or color/outline/focus."),
      role: z.string().describe("Role type, usually border, icon, or focus-border."),
      aliases: z.record(z.string(), z.string()).describe("Per-mode primitive variable names approved by the designer.")
    })).optional().describe("Designer-approved missing border/icon/focus-border semantic role variables."),
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
