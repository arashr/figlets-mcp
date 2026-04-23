const { analyzeDesignSystemData } = require("./analyze-design-system.js");
const { inspectComponentData } = require("./inspect-component.js");

const CORE_VERSION = "0.1.0";

function summarizeDesignSystem(input = {}) {
  const collectionList = Array.isArray(input.collections) ? input.collections : [];
  const textStyleList = Array.isArray(input.textStyles) ? input.textStyles : [];
  const effectStyleList = Array.isArray(input.effectStyles) ? input.effectStyles : [];
  const colorCollections = collectionList.filter(
    collection => collection && typeof collection.colorVarCount === "number" && collection.colorVarCount > 0
  ).length;
  const floatCollections = collectionList.filter(
    collection => collection && typeof collection.floatVarCount === "number" && collection.floatVarCount > 0
  ).length;
  const collections = collectionList.length;
  const textStyles = textStyleList.length;
  const effectStyles = effectStyleList.length;

  return {
    collections,
    textStyles,
    effectStyles,
    capabilities: {
      hasVariables: collections > 0,
      hasColorVariables: colorCollections > 0,
      hasFloatVariables: floatCollections > 0,
      hasTextStyles: textStyles > 0,
      hasEffectStyles: effectStyles > 0,
      canAuditTokens: collections > 0,
      canDocumentComponents: collections > 0 || textStyles > 0 || effectStyles > 0
    }
  };
}

function normalizeDesignSystemSnapshot(input = {}) {
  return {
    target: input.target !== undefined ? input.target : "unknown",
    collections: Array.isArray(input.collections) ? input.collections : [],
    textStyles: Array.isArray(input.textStyles) ? input.textStyles : [],
    effectStyles: Array.isArray(input.effectStyles) ? input.effectStyles : []
  };
}

function detectDesignSystem(input = {}) {
  const snapshot = normalizeDesignSystemSnapshot(input);
  const summary = summarizeDesignSystem(snapshot);

  return {
    target: snapshot.target,
    summary,
    snapshot
  };
}

function detectDesignSystemFromFigmaData(input = {}) {
  const snapshot = analyzeDesignSystemData(input);
  const summary = summarizeDesignSystem(snapshot);

  return {
    target: snapshot.target,
    source: input.source !== undefined ? input.source : "unknown",
    sourceMeta: input.sourceMeta !== undefined ? input.sourceMeta : null,
    summary,
    snapshot
  };
}

module.exports = {
  CORE_VERSION,
  detectDesignSystem,
  detectDesignSystemFromFigmaData,
  inspectComponentData,
  normalizeDesignSystemSnapshot,
  summarizeDesignSystem
};
