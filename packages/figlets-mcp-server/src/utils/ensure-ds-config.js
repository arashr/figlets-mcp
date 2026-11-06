"use strict";

const fs = require("fs");
const path = require("path");
const { getActiveFileConfigPath, getActiveFileKey } = require("./paths.js");
const { bootstrapDsFromSnapshot } = require("./bootstrap-ds-from-figma.js");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");

function _writeDsConfig(configPath, ds) {
  let writeDsConfig;
  try {
    ({ writeDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (err) {
    ({ writeDsConfig } = require("../figlets-core.js").dsConfig);
  }
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeDsConfig(configPath, ds);
}

function _readDsConfig(configPath) {
  let readDsConfig;
  try {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (err) {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  }
  try { return readDsConfig(configPath); } catch (err) { return null; }
}

function _isGeneratedBootstrap(ds) {
  return Boolean(ds && ds.figlets && ds.figlets.source === "figma-snapshot-bootstrap");
}

function ensureActiveDsConfig(input = {}) {
  const configPath = input.configPath || getActiveFileConfigPath();
  if (!configPath) {
    return {
      created: false,
      configPath: null,
      configExists: false,
      reason: "no-active-file",
      message: "No active Figma file key is available, so Figlets cannot create a file-scoped config yet.",
    };
  }

  const configAlreadyExists = fs.existsSync(configPath);
  const existingDs = configAlreadyExists ? _readDsConfig(configPath) : null;
  if (configAlreadyExists && !(input.refreshGenerated && _isGeneratedBootstrap(existingDs))) {
    return {
      created: false,
      configPath,
      configExists: true,
      reason: "exists",
      message: "Using existing file-scoped design-system.config.js.",
    };
  }

  const dataSource = input.dataSource
    || loadActiveFigmaDataSource(input)
    || loadFigmaDataSource(input);
  if (!dataSource || !dataSource.figmaData) {
    return {
      created: false,
      configPath,
      configExists: false,
      reason: "no-snapshot",
      message: "No synced Figma snapshot was found. Run sync_figma_data before Figlets creates a file-scoped config.",
    };
  }

  const ds = bootstrapDsFromSnapshot(dataSource.figmaData, {
    algorithm: input.algorithm || (existingDs && existingDs.color && existingDs.color.contrastAlgorithm),
    createdAt: input.createdAt,
  });
  if (existingDs) {
    const { mergeFoundationRequirements } = require('./foundation-requirements');
    ds.figlets.foundationRequirements = mergeFoundationRequirements(existingDs.figlets && existingDs.figlets.foundationRequirements, ds.figlets.foundationRequirements);
    if (existingDs.figlets && existingDs.figlets.foundationRequirementsApproved === true) ds.figlets.foundationRequirementsApproved = true;
    if (
      existingDs.project &&
      existingDs.project.name &&
      existingDs.project.name !== "Imported Figma design system"
    ) {
      ds.project = Object.assign({}, ds.project, existingDs.project);
      // Confirmation belongs to the retained project name, not the new snapshot suggestion.
      if (existingDs.figlets && existingDs.figlets.projectNameSource === "designer-confirmed") {
        ds.figlets.projectNameSource = "designer-confirmed";
      }
    }
    if (existingDs.grid) ds.grid = existingDs.grid;
    if (existingDs.typography) {
      const inferredTypography = ds.typography || {};
      ds.typography = Object.assign({}, inferredTypography, existingDs.typography);
      if (inferredTypography.families || existingDs.typography.families) ds.typography.families = Object.assign({}, inferredTypography.families, existingDs.typography.families);
      if (inferredTypography.scale || existingDs.typography.scale) ds.typography.scale = Object.assign({}, inferredTypography.scale, existingDs.typography.scale);
    }
    if (existingDs.motion) {
      ds.motion = existingDs.motion;
      const { motionCollectionName } = require('../figlets-core.js').dsConfig;
      ds.collections = Object.assign({}, ds.collections, { motion: motionCollectionName(existingDs.collections) });
    }
  }
  ds.figlets = Object.assign({}, ds.figlets || {}, {
    fileKey: getActiveFileKey() || dataSource.meta && dataSource.meta.fileKey || dataSource.figmaData.fileKey || null,
    bootstrapReason: input.reason || "missing-file-scoped-config",
    refreshedAt: configAlreadyExists ? (input.createdAt || new Date().toISOString()) : undefined,
  });
  _writeDsConfig(configPath, ds);

  return {
    created: !configAlreadyExists,
    refreshed: Boolean(configAlreadyExists),
    configPath,
    configExists: true,
    reason: configAlreadyExists ? "refreshed-from-snapshot" : "created-from-snapshot",
    message: configAlreadyExists
      ? "Refreshed Figlets-generated design-system.config.js from the synced Figma snapshot."
      : "Created file-scoped design-system.config.js from the synced Figma snapshot.",
    summary: {
      collections: ds.collections || {},
      semanticPairs: ds.color && ds.color.semantics && Array.isArray(ds.color.semantics.pairs)
        ? ds.color.semantics.pairs.length
        : 0,
      unpairedRoles: ds.color && ds.color.semantics && Array.isArray(ds.color.semantics.unpaired)
        ? ds.color.semantics.unpaired.length
        : 0,
      iconRoles: ds.color && ds.color.semantics && Array.isArray(ds.color.semantics.icons)
        ? ds.color.semantics.icons.length
        : 0,
    },
  };
}

module.exports = { ensureActiveDsConfig };
