'use strict';

/**
 * prepare-ds-config.js
 * MCP tool handler for prepare_ds_config.
 *
 * Reads an existing design-system.config.js, runs the full computation pipeline
 * (spacing, typography, color ramps, semantic pair validation, primitives data),
 * writes the updated config back, and returns structured preview data.
 *
 * The adapter (CLAUDE.md / AGENTS.md) owns intake and initial config creation.
 * This tool is the deterministic computation step — call it after intake is done.
 */

const path = require('path');

function handlePrepareDsConfig({ config_path }) {
  const resolvedPath = path.resolve(config_path);

  let runDsPipeline;
  try {
    ({ runDsPipeline } = require('@figlets/core').dsConfig);
  } catch (e) {
    // Fallback: direct path for development environments
    ({ runDsPipeline } = require('../../../figlets-core/src/ds-config/index.js'));
  }

  let result;
  try {
    result = runDsPipeline(resolvedPath);
  } catch (err) {
    return {
      error: err.message,
      hint: err.message.includes('not found')
        ? 'Run intake and write design-system.config.js before calling prepare_ds_config.'
        : err.message.includes('ramps')
        ? 'Config is missing DS.color.brand. Add brand color(s) to the config first.'
        : null,
    };
  }

  const {
    spacingPreview, computed, needsClaude,
    colorRampsSummary, colorRampsTable, contrastAnnotations, derivedColors,
    semanticSummary, semanticPairsTable, iconTable, failCount,
    primitivesData,
  } = result;

  return {
    spacingPreview,
    computed,
    needsClaude,
    colorRamps: {
      summary:     colorRampsSummary,
      table:       colorRampsTable,
      contrasts:   contrastAnnotations,
      derived:     derivedColors,
    },
    semanticPairs: {
      summary:   semanticSummary,
      table:     semanticPairsTable,
      iconTable,
      failCount,
      ready:     failCount === 0,
    },
    primitives: {
      collectionName: primitivesData.collectionName,
      summary:        primitivesData.summary,
      counts: {
        colors:  primitivesData.colors.length,
        floats:  primitivesData.floats.length,
        strings: primitivesData.strings.length,
        scrims:  primitivesData.scrims.length,
      },
    },
    configPath: resolvedPath,
    readyToBuild: failCount === 0 && needsClaude.length === 0,
    message: failCount > 0
      ? `Config computed but ${failCount} semantic pair(s) fail contrast. Fix before building.`
      : needsClaude.length > 0
      ? `Config computed but ${needsClaude.join(', ')} need manual input before building.`
      : 'Config ready. Call apply_ds_setup to build all collections in Figma.',
  };
}

module.exports = { handlePrepareDsConfig };
