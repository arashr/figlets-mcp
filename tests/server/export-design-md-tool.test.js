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

async function withCwd(dir, fn) {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(original);
  }
}

function projectDesignMdPath(dir) {
  return path.join(fs.realpathSync(dir), 'specs', 'DESIGN.md');
}

function writeRichSnapshot(snapshotPath) {
  fs.writeFileSync(snapshotPath, JSON.stringify({
    fileKey: 'rich-file',
    fileName: 'Imported Rich DS',
    collections: [
      {
        id: 'primitives',
        name: 'Primitives',
        variableIds: ['primary-500'],
        modes: [{ modeId: 'default', name: 'Default' }],
      },
      {
        id: 'spacing',
        name: 'Spacing',
        variableIds: ['space-100', 'space-component-lg', 'radius-md', 'border-default'],
        modes: [
          { modeId: 'mobile', name: 'Mobile' },
          { modeId: 'tablet', name: 'Tablet' },
          { modeId: 'desktop', name: 'Desktop' },
        ],
      },
      {
        id: 'typography',
        name: 'Typography',
        variableIds: ['body-size', 'body-line', 'body-weight', 'body-tracking', 'font-sans'],
        modes: [
          { modeId: 'mobile', name: 'Mobile' },
          { modeId: 'tablet', name: 'Tablet' },
          { modeId: 'desktop', name: 'Desktop' },
        ],
      },
    ],
    variables: [
      { id: 'primary-500', name: 'color/primary/500', resolvedType: 'COLOR', variableCollectionId: 'primitives', valuesByMode: { default: { r: 0, g: 0.4, b: 1 } } },
      { id: 'space-100', name: 'space/100', resolvedType: 'FLOAT', variableCollectionId: 'spacing', valuesByMode: { mobile: 8, tablet: 8, desktop: 8 } },
      { id: 'space-component-lg', name: 'space/component/lg', resolvedType: 'FLOAT', variableCollectionId: 'spacing', valuesByMode: { mobile: 16, tablet: 20, desktop: 24 } },
      { id: 'radius-md', name: 'space/radius/md', resolvedType: 'FLOAT', variableCollectionId: 'spacing', valuesByMode: { mobile: 8, tablet: 8, desktop: 8 } },
      { id: 'border-default', name: 'space/border/default', resolvedType: 'FLOAT', variableCollectionId: 'spacing', valuesByMode: { mobile: 1, tablet: 1, desktop: 1 } },
      { id: 'body-size', name: 'type/body/md/size', resolvedType: 'FLOAT', variableCollectionId: 'typography', valuesByMode: { mobile: 14, tablet: 14, desktop: 16 } },
      { id: 'body-line', name: 'type/body/md/line-height', resolvedType: 'FLOAT', variableCollectionId: 'typography', valuesByMode: { mobile: 20, tablet: 20, desktop: 24 } },
      { id: 'body-weight', name: 'type/body/md/weight', resolvedType: 'FLOAT', variableCollectionId: 'typography', valuesByMode: { mobile: 400, tablet: 400, desktop: 400 } },
      { id: 'body-tracking', name: 'type/body/md/tracking', resolvedType: 'FLOAT', variableCollectionId: 'typography', valuesByMode: { mobile: 0, tablet: 0, desktop: 0 } },
      { id: 'font-sans', name: 'font/sans', resolvedType: 'STRING', variableCollectionId: 'typography', valuesByMode: { mobile: 'Inter', tablet: 'Inter', desktop: 'Inter' } },
    ],
    effectStyles: [
      {
        name: 'elevation/1',
        effects: [
          {
            type: 'DROP_SHADOW',
            color: { r: 0, g: 0, b: 0, a: 0.16 },
            offset: { x: 0, y: 2 },
            radius: 8,
            spread: 0,
          },
        ],
      },
    ],
  }), 'utf8');
}

module.exports = (async () => {
  assert.strictEqual(exportDesignMdTool.name, 'export_design_md');

  // --- Happy path: figmaDataPath bypasses sync; DESIGN.md is written; refresh records changes
  {
    const ws = makeWorkspace('happy');
    try {
      const result = await withCwd(ws.tmp, () => handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
      }));
      assert.ok(!result.error, 'expected success, got error: ' + JSON.stringify(result));
      assert.strictEqual(result.dryRun, false);
      assert.strictEqual(result.designMd.written, true);
      assert.strictEqual(result.designMd.path, projectDesignMdPath(ws.tmp));
      assert.strictEqual(result.designMd.output.defaultKind, 'project-specs');
      assert.strictEqual(result.designMd.output.fallbackUsed, false);
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
      const result = await withCwd(ws.tmp, () => handleExportDesignMd({
        config_path: ws.configPath,
        skip_sync: true,
      }));
      assert.ok(!result.error, 'expected sibling snapshot export, got error: ' + JSON.stringify(result));
      assert.strictEqual(result.sync.attempted, false, 'skip_sync should avoid bridge sync');
      assert.strictEqual(result.sync.snapshotPath, ws.snapshotPath, 'explicit config export should refresh from sibling figma-data.json');
      assert.strictEqual(result.designMd.path, projectDesignMdPath(ws.tmp));
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

  // --- project_path override lands the default DESIGN.md under the active workspace root
  {
    const ws = makeWorkspace('project-path');
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-export-cwd-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-export-project-'));
    try {
      const result = await withCwd(cwdDir, () => handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
        project_path: projectDir,
      }));
      const expectedPath = path.join(path.resolve(projectDir), 'specs', 'DESIGN.md');
      assert.ok(!result.error, 'expected success, got error: ' + JSON.stringify(result));
      assert.strictEqual(result.designMd.path, expectedPath);
      assert.strictEqual(result.designMd.output.requestedPath, expectedPath);
      assert.ok(fs.existsSync(expectedPath), 'DESIGN.md should be written under project_path');
      assert.ok(!fs.existsSync(path.join(path.resolve(cwdDir), 'specs', 'DESIGN.md')), 'DESIGN.md should not be written under cwd when project_path is provided');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
      fs.rmSync(cwdDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }

  // --- Existing config export includes newly synced local effect styles in prose without promoting config
  {
    const ws = makeWorkspace('observed-effects');
    try {
      const snapshot = JSON.parse(fs.readFileSync(ws.snapshotPath, 'utf8'));
      snapshot.effectStyles = [
        {
          name: 'Focus Ring',
          effects: [
            {
              type: 'DROP_SHADOW',
              color: { r: 0.2, g: 0.45, b: 1, a: 0.8 },
              offset: { x: 0, y: 0 },
              radius: 0,
              spread: 3,
              visible: true,
            },
          ],
        },
      ];
      fs.writeFileSync(ws.snapshotPath, JSON.stringify(snapshot), 'utf8');

      const result = await withCwd(ws.tmp, () => handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
      }));
      assert.ok(!result.error, 'expected observed effect export, got error: ' + JSON.stringify(result));
      const md = fs.readFileSync(result.designMd.path, 'utf8');
      assert.ok(md.includes('## Additional Effect Styles'), 'DESIGN.md should include synced non-elevation effect styles');
      assert.ok(md.includes('| Focus Ring |'), 'DESIGN.md should name the observed effect style');
      assert.ok(md.includes('DROP_SHADOW'), 'DESIGN.md should include implementation-relevant effect facts');
      const refreshedConfig = fs.readFileSync(ws.configPath, 'utf8');
      assert.ok(!refreshedConfig.includes('Focus Ring'), 'export refresh must not promote observed effect styles into config');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
    }
  }

  // --- Dry run: no DESIGN.md, no config rewrite, refresh marked dryRun
  {
    const ws = makeWorkspace('dry');
    try {
      const beforeConfig = fs.readFileSync(ws.configPath, 'utf8');
      const result = await withCwd(ws.tmp, () => handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
        dry_run: true,
      }));
      assert.ok(!result.error, 'dry_run should not error');
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.designMd.written, false, 'dry_run must not write DESIGN.md');
      assert.strictEqual(result.designMd.path, projectDesignMdPath(ws.tmp));
      assert.ok(!fs.existsSync(projectDesignMdPath(ws.tmp)), 'DESIGN.md must not be created on dry_run');
      assert.ok(!fs.existsSync(path.join(path.dirname(ws.configPath), 'DESIGN.md')), 'fallback DESIGN.md must not be created on dry_run');
      assert.strictEqual(result.refresh.dryRun, true);
      assert.strictEqual(fs.readFileSync(ws.configPath, 'utf8'), beforeConfig, 'config must not be rewritten on dry_run');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
    }
  }

  // --- Missing config with snapshot bootstraps a local config and exports richer DESIGN.md
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-export-md-bootstrap-'));
    try {
      const missingPath = path.join(tmp, 'design-system.config.js');
      const snapshotPath = path.join(tmp, 'figma-data.json');
      writeRichSnapshot(snapshotPath);
      const result = await withCwd(tmp, () => handleExportDesignMd({
        config_path: missingPath,
        figmaDataPath: snapshotPath,
      }));
      assert.ok(!result.error, 'missing config with snapshot should bootstrap, got: ' + JSON.stringify(result));
      assert.ok(fs.existsSync(missingPath), 'snapshot-derived config should be written');
      assert.strictEqual(result.bootstrap.source, 'figma-snapshot-bootstrap');
      assert.strictEqual(result.bootstrap.created, true);
      assert.strictEqual(result.bootstrap.summary.spacingTokens, 1);
      assert.strictEqual(result.bootstrap.summary.typographyRoles, 1);
      assert.strictEqual(result.bootstrap.summary.elevationStyles, 1);
      assert.ok(result.needsDesignerInput.some(item => item.field === 'breakpoints.widths'), 'breakpoint gap should be surfaced');
      assert.strictEqual(result.designMd.path, projectDesignMdPath(tmp));
      assert.ok(fs.existsSync(result.designMd.path), 'DESIGN.md should be written after bootstrap');
      const md = fs.readFileSync(result.designMd.path, 'utf8');
      assert.ok(md.includes('Imported Rich DS'), 'DESIGN.md should use the Figma file name');
      assert.ok(md.includes('primary-500'), 'DESIGN.md should include existing color ramp tokens');
      assert.ok(md.includes('| component/lg | 16 / 20 / 24 px |'), 'DESIGN.md should include responsive spacing tokens');
      assert.ok(md.includes('| body/md | 14 / 14 / 16 px | 400 | 0 |'), 'DESIGN.md should include typography resolved values');
      assert.ok(md.includes('Primary typeface: **Inter**.'), 'DESIGN.md should include inferred font family');
      assert.ok(md.includes('Default border width: 1px.'), 'DESIGN.md should include border width tokens');
      assert.ok(md.includes('## Elevation & Depth'), 'DESIGN.md should include effect styles');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // --- Default output falls back to config directory when project specs/ is not writable
  {
    const ws = makeWorkspace('fallback');
    try {
      fs.writeFileSync(path.join(ws.tmp, 'specs'), 'not a directory', 'utf8');
      const result = await withCwd(ws.tmp, () => handleExportDesignMd({
        config_path: ws.configPath,
        figmaDataPath: ws.snapshotPath,
      }));
      assert.ok(!result.error, 'fallback export should succeed, got error: ' + JSON.stringify(result));
      assert.strictEqual(result.designMd.path, path.join(path.dirname(ws.configPath), 'DESIGN.md'));
      assert.strictEqual(result.designMd.output.fallbackUsed, true);
      assert.strictEqual(result.designMd.output.requestedPath, projectDesignMdPath(ws.tmp));
      assert.ok(result.designMd.output.writeError, 'fallback should report the project-path write error');
      assert.ok(fs.existsSync(result.designMd.path), 'fallback DESIGN.md should be written');
    } finally {
      fs.rmSync(ws.tmp, { recursive: true, force: true });
    }
  }

  // --- Missing config still errors clearly when no snapshot can be read
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-export-md-missing-'));
    try {
      const missingPath = path.join(tmp, 'design-system.config.js');
      const result = await handleExportDesignMd({
        config_path: missingPath,
        figmaDataPath: path.join(tmp, 'nope.json'),
      });
      assert.ok(result.error, 'missing config without snapshot should produce an error');
      assert.ok(/snapshot|load/i.test(result.error), 'error should mention snapshot loading');
      assert.ok(result.hint && /bridge|figmaDataPath/i.test(result.hint), 'hint should point at bridge or snapshot input');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
})();
