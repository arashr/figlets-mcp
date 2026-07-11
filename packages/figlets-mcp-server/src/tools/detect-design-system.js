const fs = require("fs");
const path = require("path");
const {
  detectDesignSystem,
  detectDesignSystemFromFigmaData,
  designSystemInventory,
  emptyDesignSystemPrompt,
} = require("../figlets-core.js");
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

function _designSystemEmptyState(result) {
  const snapshot = result && result.snapshot ? result.snapshot : {};
  const inventory = designSystemInventory(snapshot);
  return {
    isEmpty: inventory.isEmpty,
    state: inventory.state,
    designSystemArtifactCount: inventory.designSystemArtifactCount,
    foundationCollectionCount: inventory.foundationCollectionCount,
    counts: inventory.counts,
    recommendedWorkflow: "new-ds-setup",
    recommendedDesignerPrompt: emptyDesignSystemPrompt(inventory),
  };
}

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
  const dataSource = input.snapshot ? null : loadFigmaDataSource(input);
  const result = input.snapshot ? runAnalysis(input) : (dataSource
    ? detectDesignSystemFromFigmaData({
      ...dataSource.figmaData,
      target: dataSource.target,
      source: dataSource.kind,
      sourceMeta: dataSource.meta !== undefined ? dataSource.meta : null
    })
    : runAnalysis(input));

  if (result.error) return result;

  // All analysis stays on the client machine — save full context for downstream tools
  const contextPath = dataSource && dataSource.meta && dataSource.meta.dsContextPath
    ? dataSource.meta.dsContextPath
    : DS_CONTEXT_PATH;
  if (result.snapshot) {
    const dir = path.dirname(contextPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(contextPath, JSON.stringify(result.snapshot, null, 2));
  }

  // Agent receives only what it needs to reason and report
  const emptyState = _designSystemEmptyState(result);
  return {
    saved: contextPath,
    source: dataSource ? {
      kind: dataSource.kind,
      target: dataSource.target,
      fileKey: dataSource.meta && dataSource.meta.fileKey ? dataSource.meta.fileKey : null,
      path: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
    } : null,
    summary: result.summary,
    emptyDesignSystem: emptyState,
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
    effectStyles: (result.snapshot && result.snapshot.effectStyles || []).map(s => s.name),
    paintStyles: (result.snapshot && result.snapshot.paintStyles || []).map(s => s.name)
  };
}

module.exports = { detectDesignSystemTool, handleDetectDesignSystem };
