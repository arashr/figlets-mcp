const fs = require("fs");
const path = require("path");
const { auditTokens } = require("../../../figlets-core/src/index.js");

const DEST_FILE = path.resolve(__dirname, "../../../../.local/figma-data.json");

const auditTokensTool = {
  name: "audit_tokens",
  description:
    "Analyzes the local Figma design system snapshot for token health issues: unaliased raw values (hardcoded colors/numbers that should reference tokens), duplicate values defined across multiple variables, and naming convention inconsistencies within collections. Run sync_figma_data first to ensure the snapshot is current.",
  inputSchema: {
    type: "object",
    properties: {
      figmaDataPath: {
        type: "string",
        description:
          "Optional path to the figma-data.json snapshot. Defaults to .local/figma-data.json."
      }
    },
    required: []
  }
};

function handleAuditTokens(args = {}) {
  const dataPath = args.figmaDataPath
    ? path.resolve(args.figmaDataPath)
    : DEST_FILE;

  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `Figma data snapshot not found at ${dataPath}. Run sync_figma_data first.`
    );
  }

  const rawData = fs.readFileSync(dataPath, "utf-8");
  const parsedData = JSON.parse(rawData);

  const result = auditTokens({
    variables: parsedData.variables || [],
    collections: parsedData.collections || []
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

module.exports = {
  auditTokensTool,
  handleAuditTokens
};
