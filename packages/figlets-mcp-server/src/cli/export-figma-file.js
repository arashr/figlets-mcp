const fs = require("fs");
const path = require("path");
const { exportFigmaFile } = require("../exporters/figma-rest-export.js");
const { loadDotenv } = require("../utils/load-dotenv.js");

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node packages/figlets-mcp-server/src/cli/export-figma-file.js --file <figma-url-or-key> [--output figma-data.json]",
      "",
      "Environment:",
      "  FIGMA_ACCESS_TOKEN or FIGMA_TOKEN",
      "",
      "Examples:",
      "  node packages/figlets-mcp-server/src/cli/export-figma-file.js --file https://www.figma.com/design/FILE_KEY/File-Name",
      "  node packages/figlets-mcp-server/src/cli/export-figma-file.js --file FILE_KEY --output ./tmp/figma-data.json"
    ].join("\n") + "\n"
  );
}

function readArgs(argv) {
  const args = {
    file: null,
    output: null
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }

    if (value === "--file") {
      args.file = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === "--output") {
      args.output = argv[index + 1] || null;
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = readArgs(process.argv);
  loadDotenv();

  if (args.help || !args.file) {
    printUsage();
    if (!args.help) {
      process.exitCode = 1;
    }
    return;
  }

  const exported = await exportFigmaFile({ file: args.file });
  const serialized = JSON.stringify(exported, null, 2) + "\n";

  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.writeFileSync(outputPath, serialized, "utf8");
    process.stdout.write("Wrote Figma export to " + outputPath + "\n");
    return;
  }

  process.stdout.write(serialized);
}

main().catch(function(error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
