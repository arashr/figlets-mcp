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
  {},
  async () => {
    try {
      return await handleBuildShowcase();
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
