const path = require("path");
const { CORE_VERSION } = require("../../figlets-core/src/index.js");
const { detectDesignSystemTool } = require("./tools/detect-design-system.js");
const { inspectComponentTool } = require("./tools/inspect-component.js");
const { syncFigmaDataTool } = require("./tools/sync-figma-data.js");

function main() {
  const examplePath = path.resolve(__dirname, "../../../examples/detect-design-system.figma-data.json");
  const example = detectDesignSystemTool.handler({
    figmaDataPath: examplePath
  });

  const server = {
    name: "figlets-mcp",
    version: "0.1.0",
    coreVersion: CORE_VERSION,
    tools: [
      {
        name: detectDesignSystemTool.name,
        description: detectDesignSystemTool.description,
        inputSchema: detectDesignSystemTool.inputSchema
      },
      {
        name: inspectComponentTool.name,
        description: inspectComponentTool.description,
        inputSchema: inspectComponentTool.inputSchema
      },
      {
        name: syncFigmaDataTool.name,
        description: syncFigmaDataTool.description,
        inputSchema: syncFigmaDataTool.inputSchema
      }
    ],
    examples: {
      detect_design_system: example
    }
  };

  process.stdout.write(`${JSON.stringify(server, null, 2)}\n`);
}

main();
