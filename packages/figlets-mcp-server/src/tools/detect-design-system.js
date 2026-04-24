const fs = require("fs");
const {
  detectDesignSystem,
  detectDesignSystemFromFigmaData
} = require("../../../figlets-core/src/index.js");
const {
  explainMissingFigmaBridge,
  loadFigmaDataSource
} = require("../bridges/figma-data-source.js");
const { DS_CONTEXT_PATH, LOCAL_DIR } = require("../utils/paths.js");

const detectDesignSystemTool = {
  name: "detect_design_system",
  description: "Analyzes the synced Figma data, builds the design system context (variable maps, token indexes, typography strategy), saves it locally for downstream tools, and returns a compact summary. Run sync_figma_data first.",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "A file key, node id, or adapter-specific target reference."
      },
      figmaDataPath: {
        type: "string",
        description: "Optional path to a JSON file containing a Figma-like data payload."
      },
      figmaDataCommand: {
        type: "string",
        description: "Optional shell command that prints a Figma-like JSON payload to stdout."
      }
    },
    additionalProperties: false
  }
};

// Internal: run full analysis via core (returns raw result with snapshot)
function runAnalysis(input = {}) {
  if (input.snapshot && typeof input.snapshot === "object") {
    const snapshot = {
      ...input.snapshot,
      target: input.target !== undefined ? input.target : input.snapshot.target
    };
    return detectDesignSystem(snapshot);
  }

  const dataSource = loadFigmaDataSource(input);

  if (dataSource) {
    return detectDesignSystemFromFigmaData({
      ...dataSource.figmaData,
      target: dataSource.target,
      source: dataSource.kind,
      sourceMeta: dataSource.meta !== undefined ? dataSource.meta : null
    });
  }

  return {
    target: input.target !== undefined ? input.target : "unknown",
    error: explainMissingFigmaBridge()
  };
}

// Public: save full context to disk, return only compact summary for the agent
function handleDetectDesignSystem(input = {}) {
  const result = runAnalysis(input);

  if (result.error) return result;

  // All analysis stays on the client machine — save full context for downstream tools
  if (result.snapshot) {
    if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(DS_CONTEXT_PATH, JSON.stringify(result.snapshot, null, 2));
  }

  // Agent receives only what it needs to reason and report
  return {
    saved: DS_CONTEXT_PATH,
    summary: result.summary,
    typographyStrategy: result.snapshot && result.snapshot.context
      ? result.snapshot.context.typographyStrategy
      : "unknown",
    collections: (result.snapshot && result.snapshot.collections || []).map(c => ({
      name: c.name,
      modes: c.modeNames,
      variables: c.varCount,
      colorVars: c.colorVarCount,
      floatVars: c.floatVarCount,
      isAlias: c.isAlias,
      isPrimitive: c.isPrimitive,
      hasLightDark: c.hasLightDark
    })),
    textStyles: (result.snapshot && result.snapshot.textStyles || []).map(s => s.name),
    effectStyles: (result.snapshot && result.snapshot.effectStyles || []).map(s => s.name)
  };
}

module.exports = { detectDesignSystemTool, handleDetectDesignSystem };
