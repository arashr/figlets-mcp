const path = require("path");
const { detectDesignSystemTool } = require("../tools/detect-design-system.js");
const { loadDotenv } = require("../utils/load-dotenv.js");

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node packages/figlets-mcp-server/src/cli/detect-design-system.js [figma-data.json]",
      "  node packages/figlets-mcp-server/src/cli/detect-design-system.js --command 'my-figma-export-command'",
      "",
      "Examples:",
      "  node packages/figlets-mcp-server/src/cli/detect-design-system.js",
      "  node packages/figlets-mcp-server/src/cli/detect-design-system.js /absolute/path/to/figma-data.json",
      "  node packages/figlets-mcp-server/src/cli/detect-design-system.js --command 'cat /absolute/path/to/figma-data.json'"
    ].join("\n") + "\n"
  );
}

function main() {
  loadDotenv();
  const arg = process.argv[2];
  const commandFlag = process.argv[2];
  const commandValue = process.argv[3];

  if (arg === "--help" || arg === "-h") {
    printUsage();
    return;
  }

  if (commandFlag === "--command" && commandValue) {
    const commandResult = detectDesignSystemTool.handler({ figmaDataCommand: commandValue });
    process.stdout.write(`${JSON.stringify(commandResult, null, 2)}\n`);
    return;
  }

  const figmaDataPath = arg
    ? path.resolve(arg)
    : path.resolve(__dirname, "../../../../examples/detect-design-system.figma-data.json");

  const result = detectDesignSystemTool.handler({ figmaDataPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
