'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const originalLocalDir = process.env.FIGLETS_LOCAL_DIR;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-design-md-'));
process.env.FIGLETS_LOCAL_DIR = tmp;

delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/utils/paths.js')];
delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/design-md-intake.js')];

const fileKey = 'file_design_md';
const scopedDir = path.join(tmp, fileKey);
fs.mkdirSync(scopedDir, { recursive: true });
fs.writeFileSync(path.join(tmp, 'active-file.json'), JSON.stringify({ fileKey, updatedAt: 'now' }));

const designPath = path.join(scopedDir, 'DESIGN.md');
const configPath = path.join(scopedDir, 'design-system.config.js');
fs.writeFileSync(designPath, `---
name: Design Import
colors:
  primary: "#3366FF"
typography:
  body-md:
    fontFamily: Inter
    fontSize: 16px
spacing:
  sm: 8px
---

## Overview
Imported design.
`, 'utf8');

const { handleCreateDsConfigFromDesignMd } = require('../../packages/figlets-mcp-server/src/tools/design-md-intake.js');
const result = handleCreateDsConfigFromDesignMd({
  design_md_path: designPath,
  config_path: configPath
});

assert.ok(!result.error, 'DESIGN.md intake should succeed');
assert.strictEqual(result.configPath, configPath);
assert.strictEqual(result.intakeMode, 'front-matter');
assert.strictEqual(result.parsedFromFrontMatter, true);
assert.strictEqual(result.mapped.brandColors, 1);
assert.ok(fs.existsSync(configPath), 'config should be written');

const written = fs.readFileSync(configPath, 'utf8');
assert.ok(written.includes('"source"'), 'config should record DESIGN.md source metadata');
assert.ok(written.includes('"primary"'), 'config should include imported primary color');

const markdownOnlyDir = path.join(scopedDir, 'markdown-only');
fs.mkdirSync(path.join(markdownOnlyDir, 'config'), { recursive: true });
const markdownOnlyPath = path.join(markdownOnlyDir, 'DESIGN.md');
const markdownOnlyConfigPath = path.join(markdownOnlyDir, 'design-system.config.js');
fs.copyFileSync(
  path.join(__dirname, '../fixtures/md-gallery/DESIGN.md'),
  markdownOnlyPath
);
fs.copyFileSync(
  path.join(__dirname, '../fixtures/md-gallery/config/gallery.config.json'),
  path.join(markdownOnlyDir, 'config/gallery.config.json')
);

const markdownOnlyResult = handleCreateDsConfigFromDesignMd({
  design_md_path: markdownOnlyPath,
  config_path: markdownOnlyConfigPath,
  linked_config_path: path.join(markdownOnlyDir, 'config/gallery.config.json')
});

assert.ok(!markdownOnlyResult.error, 'Markdown-only DESIGN.md intake should succeed');
assert.strictEqual(markdownOnlyResult.intakeMode, 'markdown+linked-config');
assert.strictEqual(markdownOnlyResult.parsedFromFrontMatter, false);
assert.strictEqual(markdownOnlyResult.parsedFromMarkdown.projectName, 'MD Gallery');
assert.ok(markdownOnlyResult.linkedConfigCandidates.some(entry => entry.path === 'config/gallery.config.json'));
assert.ok(markdownOnlyResult.mapped.brandColors >= 2);
assert.ok(Array.isArray(markdownOnlyResult.needsDesignerInput));
assert.ok(markdownOnlyResult.needsDesignerInput.includes('platform'));
assert.ok(!markdownOnlyResult.needsDesignerInput.includes('color scale and brand colors (name + hex)'));
assert.ok(markdownOnlyResult.message.includes('remaining setup questions'));

fs.rmSync(tmp, { recursive: true, force: true });
if (originalLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
else process.env.FIGLETS_LOCAL_DIR = originalLocalDir;
delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/utils/paths.js')];
delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/design-md-intake.js')];
