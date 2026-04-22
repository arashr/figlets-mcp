const path = require("path");
const { CORE_VERSION } = require("../../figlets-core/src/index.js");
const { detectDesignSystemTool } = require("./tools/detect-design-system.js");

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
      }
    ],
    examples: {
      detect_design_system: example
    }
  };

  process.stdout.write(`${JSON.stringify(server, null, 2)}\n`);
}

main();
