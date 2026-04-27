'use strict';

const { computeDsConfig }        = require('./compute-ds-config');
const { generateColorRamps }     = require('./generate-color-ramps');
const { validateSemanticPairs }  = require('./validate-semantic-pairs');
const { generatePrimitivesData } = require('./generate-primitives-data');

/**
 * readDsConfig(configPath) — reads and evaluates a design-system.config.js file.
 * Returns the DS object, or throws if the file is missing or unparseable.
 */
function readDsConfig(configPath) {
  const fs   = require('fs');
  const vm   = require('vm');
  const path = require('path');

  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config not found: ${resolved}`);
  }

  const src = fs.readFileSync(resolved, 'utf8')
    .replace(/^\s*(const|let|var)\s+DS\s*=/m, 'DS =');
  const ctx = {};
  try {
    vm.runInNewContext(src, ctx);
  } catch (e) {
    throw new Error(`Could not parse config: ${e.message}`);
  }

  if (!ctx.DS) throw new Error('Config must export a DS object');
  return ctx.DS;
}

/**
 * writeDsConfig(configPath, ds) — serializes the DS object back to a config file.
 */
function writeDsConfig(configPath, ds) {
  const fs   = require('fs');
  const path = require('path');
  const resolved = path.resolve(configPath);
  fs.writeFileSync(resolved, `const DS = ${JSON.stringify(ds, null, 2)};\n`, 'utf8');
}

/**
 * runDsPipeline(configPath) — runs the full computation pipeline:
 * 1. Read config
 * 2. computeDsConfig  → adds spacing, typography scale
 * 3. generateColorRamps → adds color ramps
 * 4. validateSemanticPairs → adds semantic pairs
 * 5. generatePrimitivesData → produces Collection 1 payload
 * 6. Write updated config back to disk
 *
 * Returns all pipeline outputs for use by MCP tools.
 */
function runDsPipeline(configPath) {
  let ds = readDsConfig(configPath);

  // Step 1 — spacing + typography
  const step1 = computeDsConfig(ds);
  ds = step1.ds;

  // Step 2 — color ramps
  const step2 = generateColorRamps(ds);
  ds = step2.ds;

  // Step 3 — semantic pairs (only if failCount check passes downstream)
  const step3 = validateSemanticPairs(ds);
  ds = step3.ds;

  // Step 4 — primitives data
  const step4 = generatePrimitivesData(ds);

  // Write updated config
  writeDsConfig(configPath, ds);

  return {
    spacingPreview:       step1.preview,
    computed:             step1.computed,
    needsClaude:          step1.needsClaude,
    colorRampsTable:      step2.markdownTable,
    colorRampsSummary:    step2.summary,
    contrastAnnotations:  step2.contrastAnnotations,
    derivedColors:        step2.derivedColors,
    semanticPairsTable:   step3.markdownTable,
    iconTable:            step3.iconTable,
    failCount:            step3.failCount,
    semanticSummary:      step3.summary,
    primitivesData:       step4,
  };
}

module.exports = {
  computeDsConfig,
  generateColorRamps,
  validateSemanticPairs,
  generatePrimitivesData,
  readDsConfig,
  writeDsConfig,
  runDsPipeline,
};
