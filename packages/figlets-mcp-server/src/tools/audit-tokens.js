const fs = require("fs");
const { auditTokens } = require("../../../figlets-core/src/index.js");
const { FIGMA_DATA_PATH, DS_CONTEXT_PATH } = require("../utils/paths.js");

const auditTokensTool = {
  name: "audit_tokens",
  description:
    "Analyzes the local Figma design system snapshot for token health issues: unaliased raw values (hardcoded colors/numbers that should reference tokens), duplicate values defined across multiple variables, and naming convention inconsistencies within collections. Run sync_figma_data and detect_design_system first to ensure the snapshot is current.",
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

function loadDsContext() {
  if (!fs.existsSync(DS_CONTEXT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(DS_CONTEXT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function handleAuditTokens(args = {}) {
  const dataPath = args.figmaDataPath
    ? require("path").resolve(args.figmaDataPath)
    : FIGMA_DATA_PATH;

  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `Figma data snapshot not found at ${dataPath}. Run sync_figma_data first.`
    );
  }

  const rawData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  // Load the saved DS context indexes for richer token matching
  // (produced by detect_design_system — if missing, audit still runs but without match suggestions)
  const dsContext = loadDsContext();
  const contextIndexes = dsContext && dsContext.context && dsContext.context.indexes
    ? dsContext.context.indexes
    : null;

  const result = auditTokens({
    variables: rawData.variables || [],
    collections: rawData.collections || [],
    contextIndexes
  });

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
  };
}

module.exports = { auditTokensTool, handleAuditTokens };
