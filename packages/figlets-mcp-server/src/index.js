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
const { generateComponentDocTool, handleGenerateComponentDoc } = require("./tools/generate-component-doc.js");
const { qaBindingAuditTool, handleQaBindingAudit } = require("./tools/qa-binding-audit.js");
const { designMdIntakeTool, handleCreateDsConfigFromDesignMd } = require("./tools/design-md-intake.js");

const server = new McpServer({
  name: "figlets-mcp",
  version: "0.1.0"
});

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
    categories: z.array(z.string()).optional().describe('Optional list of primitive categories to update. Supported today: "color", "spacing". Defaults to all supported categories.'),
    create_missing: z.boolean().optional().describe("When true, create missing primitive variables inside the existing Primitives collection before setting values. Existing variable IDs are preserved.")
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

// --- generate_component_doc ---
server.tool(
  generateComponentDocTool.name,
  generateComponentDocTool.description,
  {
    component_name: z.string().describe("Name of the COMPONENT or COMPONENT_SET on the current Figma page."),
    description: z.string().optional().describe("Human-readable description (1-2 sentences) shown under the title on the spec sheet. Agent should craft this after inspecting the component."),
    usage_do: z.array(z.string()).optional().describe("Do rules for the usage panel. Agent should ground these in the component's actual purpose, not pass generic placeholders."),
    usage_dont: z.array(z.string()).optional().describe("Don't rules for the usage panel. Agent should ground these in the component's actual purpose."),
    variant_descriptions: z.record(z.string()).optional().describe("Map of exact variant name to short purpose (<=10 words).")
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
