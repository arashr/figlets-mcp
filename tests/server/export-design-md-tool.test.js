'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  exportDesignMdTool,
  handleExportDesignMd,
} = require('../../packages/figlets-mcp-server/src/tools/export-design-md.js');

function makeWorkspace(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-export-md-' + label + '-'));
  const configPath = path.join(tmp, 'design-system.config.js');
  const snapshotPath = path.join(tmp, 'figma-data.json');

  fs.writeFileSync(configPath, "const DS = {\n"
    + "  project: { name: 'Export MD Test' },\n"
    + "  color: {\n"
    + "    ramps: [{ folder: 'color/primary', steps: [[500, 0, 0, 0]] }],\n"
    + "    brand: [{ name: 'primary', hex: '#000000', role: 'primary', step: 500 }]\n"
    + "  },\n"
    + "  typography: { scale: { 'body/md': { sizes: [16, 16, 16], lineHeights: [24, 24, 24], weight: 400, tracking: 0 } }, families: { sans: 'Inter' } },\n"
    + "  spacing: { semantic: { 'component/md': [16, 16, 16] }, radius: { md: 8 }, border: { default: 1 } },\n"
    + "  primitives: { spacing: [[4, 16]] }\n"
    + "};\n", 'utf8');

  fs.writeFileSync(snapshotPath, JSON.stringify({
    collections: [
      { id: 'primitives', name: 'Primitives', variableIds: ['v-primary-500'], modes: [{ modeId: 'default', name: 'Default' }] },
    ],
    variables: [
      { id: 'v-primary-500', name: 'color/primary/500', resolvedType: 'COLOR', variableCollectionId: 'primitives', valuesByMode: { default: { r: 0.5, g: 0.2, b: 0.8 } } },
    ],
  }), 'utf8');

  return { tmp, configPath, snapshotPath };
}

module.exports = (async () => {
  assert.strictEqual(exportDesignMdTool.name, 'export_design_md');

  // --- Happy path: figmaDataPath bypasses sync; DESIGN.md is written; refresh records changes
  {
    const ws = makeWorkspace('happy');
    try {
      const result = await handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
      });
      assert.ok(!result.error, 'expected success, got error: ' + JSON.stringify(result));
      assert.strictEqual(result.dryRun, false);
      assert.strictEqual(result.designMd.written, true);
      assert.strictEqual(result.designMd.path, path.join(path.dirname(ws.configPath), 'DESIGN.md'));
      assert.ok(fs.existsSync(result.designMd.path), 'DESIGN.md should exist on disk');
      const md = fs.readFileSync(result.designMd.path, 'utf8');
      assert.ok(md.includes('Export MD Test'), 'DESIGN.md should embed DS project name');
      assert.strictEqual(result.sync.attempted, false, 'sync should be skipped when figmaDataPath is provided');
      assert.ok(Array.isArray(result.refresh.changes), 'refresh.changes should be an array');
      // The snapshot's primary/500 differs from the config's [0,0,0], so refresh should have updated the ramp step + brand hex.
      const refreshedConfig = fs.readFileSync(ws.configPath, 'utf8');
      assert.ok(refreshedConfig.includes('0.5'), 'config should be rewritten with refreshed ramp value');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
    }
  }

  // --- Explicit config path prefers sibling figma-data.json over any active/global snapshot
  {
    const ws = makeWorkspace('sibling-snapshot');
    try {
      const result = await handleExportDesignMd({
        config_path: ws.configPath,
        skip_sync: true,
      });
      assert.ok(!result.error, 'expected sibling snapshot export, got error: ' + JSON.stringify(result));
      assert.strictEqual(result.sync.attempted, false, 'skip_sync should avoid bridge sync');
      assert.strictEqual(result.sync.snapshotPath, ws.snapshotPath, 'explicit config export should refresh from sibling figma-data.json');
      const refreshedConfig = fs.readFileSync(ws.configPath, 'utf8');
      assert.ok(refreshedConfig.includes('0.5'), 'sibling snapshot should refresh the custom config');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
    }
  }

  // --- output_path override lands DESIGN.md at the chosen location
  {
    const ws = makeWorkspace('outpath');
    try {
      const outputPath = path.join(ws.tmp, 'nested', 'CUSTOM-DESIGN.md');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const result = await handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
        output_path: outputPath,
      });
      assert.ok(!result.error, 'expected success, got error: ' + JSON.stringify(result));
      assert.strictEqual(result.designMd.path, outputPath);
      assert.ok(fs.existsSync(outputPath), 'DESIGN.md should be written at the override path');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
    }
  }

  // --- Dry run: no DESIGN.md, no config rewrite, refresh marked dryRun
  {
    const ws = makeWorkspace('dry');
    try {
      const beforeConfig = fs.readFileSync(ws.configPath, 'utf8');
      const result = await handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
        dry_run: true,
      });
      assert.ok(!result.error, 'dry_run should not error');
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.designMd.written, false, 'dry_run must not write DESIGN.md');
      assert.ok(!fs.existsSync(path.join(path.dirname(ws.configPath), 'DESIGN.md')), 'DESIGN.md must not be created on dry_run');
      assert.strictEqual(result.refresh.dryRun, true);
      assert.strictEqual(fs.readFileSync(ws.configPath, 'utf8'), beforeConfig, 'config must not be rewritten on dry_run');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
    }
  }

  // --- Missing config errors clearly with setup hint
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-export-md-missing-'));
    try {
      const missingPath = path.join(tmp, 'design-system.config.js');
      const result = await handleExportDesignMd({
        config_path: missingPath,
        figmaDataPath: path.join(tmp, 'nope.json'),
      });
      assert.ok(result.error, 'missing config should produce an error');
      assert.ok(/not found/i.test(result.error), 'error should mention missing config');
      assert.ok(result.hint && /setup|prepare/i.test(result.hint), 'hint should point at setup flow');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
})();
