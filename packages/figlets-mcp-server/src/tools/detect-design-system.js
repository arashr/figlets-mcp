const {
  detectDesignSystem,
  detectDesignSystemFromFigmaData
} = require("../../../figlets-core/src/index.js");
const {
  explainMissingFigmaBridge,
  loadFigmaDataSource
} = require("../bridges/figma-data-source.js");

const detectDesignSystemTool = {
  name: "detect_design_system",
  description: "Analyze a Figma file or selection and summarize available design system capabilities.",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "A file key, node id, selection marker, or adapter-specific target reference."
      },
      snapshot: {
        type: "object",
        description: "Optional pre-fetched design system data for local summarization before live Figma integration lands."
      },
      figmaData: {
        type: "object",
        description: "Optional raw Figma-like data for local structural analysis before the live bridge is wired in."
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
  },
  handler(input = {}) {
    // Explicit snapshot input takes priority over any automatic data source
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
};

module.exports = {
  detectDesignSystemTool
};
