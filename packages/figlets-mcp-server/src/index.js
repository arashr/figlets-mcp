const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const { detectDesignSystemTool } = require("./tools/detect-design-system.js");
const { inspectComponentTool, handleInspectComponent } = require("./tools/inspect-component.js");
const { syncFigmaDataTool, handleSyncFigmaData } = require("./tools/sync-figma-data.js");

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
      const result = detectDesignSystemTool.handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("figlets-mcp server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
