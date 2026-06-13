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

const {
  handleCreateDsConfigFromDesignMd,
  handleCreateDsConfigFromIntake,
} = require('../../packages/figlets-mcp-server/src/tools/design-md-intake.js');
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
fs.mkdirSync(path.join(markdownOnlyDir, 'docs'), { recursive: true });
fs.mkdirSync(path.join(markdownOnlyDir, 'config'), { recursive: true });
const markdownOnlyPath = path.join(markdownOnlyDir, 'docs/DESIGN.md');
const markdownOnlyConfigPath = path.join(markdownOnlyDir, 'design-system.config.js');
fs.copyFileSync(
  path.join(__dirname, '../fixtures/md-gallery/docs/DESIGN.md'),
  markdownOnlyPath
);
fs.copyFileSync(
  path.join(__dirname, '../fixtures/md-gallery/config/gallery.config.json'),
  path.join(markdownOnlyDir, 'config/gallery.config.json')
);

const markdownOnlyResult = handleCreateDsConfigFromDesignMd({
  design_md_path: markdownOnlyPath,
  config_path: markdownOnlyConfigPath
});

assert.ok(!markdownOnlyResult.error, 'Markdown-only DESIGN.md intake should succeed');
assert.strictEqual(markdownOnlyResult.intakeMode, 'markdown+linked-config');
assert.strictEqual(markdownOnlyResult.parsedFromFrontMatter, false);
assert.strictEqual(markdownOnlyResult.parsedFromMarkdown.projectName, 'MD Gallery');
assert.ok(markdownOnlyResult.linkedConfigCandidates.some(entry => entry.path === 'config/gallery.config.json' && entry.exists));
assert.ok(markdownOnlyResult.mapped.brandColors >= 2);
assert.ok(Array.isArray(markdownOnlyResult.needsDesignerInput));
assert.ok(markdownOnlyResult.needsDesignerInput.includes('platform'));
assert.ok(!markdownOnlyResult.needsDesignerInput.includes('color scale and brand colors (name + hex)'));
assert.ok(markdownOnlyResult.message.includes('remaining setup questions'));

const intakeFileKey = 'file_intake_config';
const intakeScopedDir = path.join(tmp, intakeFileKey);
fs.mkdirSync(intakeScopedDir, { recursive: true });
fs.writeFileSync(path.join(tmp, 'active-file.json'), JSON.stringify({ fileKey: intakeFileKey, updatedAt: 'now' }));
const intakeConfigPath = path.join(intakeScopedDir, 'design-system.config.js');
const outsideActiveConfigPath = path.join(scopedDir, 'intake-design-system.config.js');
const outsideActiveResult = handleCreateDsConfigFromIntake({
  config_path: outsideActiveConfigPath,
  project_name: 'Case study',
  platform: 'Web',
  grid_base: 4,
  breakpoint_tier: '3-tier',
  semantic_color_grammar: 'intent/emphasis',
  contrast_standard: 'WCAG 2.2',
  theme_behavior: 'light + dark',
  color_scale: '50-950',
  brand_colors: [{ name: 'portfolio blue', hex: '#234CFF', role: 'primary' }],
  typography: {
    scalePreset: 'material3',
    families: {
      sans: 'Roboto Slab',
      mono: 'JetBrains Mono',
    },
  },
});

assert.ok(outsideActiveResult.error, 'intake config should reject non-active config paths');
assert.strictEqual(outsideActiveResult.configWritten, false);
assert.ok(!fs.existsSync(outsideActiveConfigPath), 'intake config should not write outside the active file-scoped path');

const missingIntakeResult = handleCreateDsConfigFromIntake({
  config_path: intakeConfigPath,
  project_name: 'Case study',
  platform: 'Web',
  grid_base: 4,
  breakpoint_tier: '3-tier',
  semantic_color_grammar: 'intent/emphasis',
  contrast_standard: 'WCAG 2.2',
  theme_behavior: 'light + dark',
  color_families: ['neutral light/black', 'red', 'deep navy', 'lime', 'yellow', 'teal'],
  typography: {
    families: {
      sans: 'Roboto Slab',
      mono: 'JetBrains Mono',
    },
  },
});

assert.ok(!missingIntakeResult.error, 'incomplete intake should return designer questions, not a tool error');
assert.strictEqual(missingIntakeResult.configWritten, false);
assert.strictEqual(missingIntakeResult.readyForPrepare, false);
assert.ok(!fs.existsSync(intakeConfigPath), 'incomplete intake should not write config');
assert.ok(
  missingIntakeResult.needsDesignerInput.some(item => item.includes('brand colors with hex values')),
  'screenshot-derived color families should require confirmed hex values'
);
assert.ok(
  missingIntakeResult.needsDesignerInput.includes('color scale (for example 50-950)'),
  'missing color scale should remain a designer input instead of defaulting'
);
assert.ok(
  missingIntakeResult.needsDesignerInput.includes('typography scale or preset'),
  'missing typography preset should remain a designer input instead of defaulting'
);

const vagueIntakeResult = handleCreateDsConfigFromIntake({
  config_path: intakeConfigPath,
  project_name: 'Case study',
  platform: 'Web',
  grid_base: 'sometimes',
  breakpoint_tier: 'responsive',
  semantic_color_grammar: 'not sure',
  contrast_standard: 'WCAG 2.2',
  theme_behavior: 'light + dark',
  color_scale: '50-950',
  brand_colors: [{ name: 'portfolio blue', hex: '#234CFF', role: 'primary' }],
  typography: {
    scalePreset: 'material3',
    families: {
      sans: 'Roboto Slab',
      mono: 'JetBrains Mono',
    },
  },
});

assert.strictEqual(vagueIntakeResult.configWritten, false);
assert.ok(vagueIntakeResult.needsDesignerInput.includes('valid grid base number'));
assert.ok(vagueIntakeResult.needsDesignerInput.includes('valid breakpoint tier or exact modes'));
assert.ok(vagueIntakeResult.needsDesignerInput.includes('semantic color naming grammar'));

const customPresetWithoutScale = handleCreateDsConfigFromIntake({
  config_path: intakeConfigPath,
  project_name: 'Case study',
  platform: 'Web',
  grid_base: 4,
  breakpoint_tier: '3-tier',
  semantic_color_grammar: 'intent/emphasis',
  contrast_standard: 'WCAG 2.2',
  theme_behavior: 'light + dark',
  color_scale: '50-950',
  brand_colors: [{ name: 'portfolio blue', hex: '#234CFF', role: 'primary' }],
  typography: {
    scalePreset: 'custom',
    families: {
      sans: 'Roboto Slab',
      mono: 'JetBrains Mono',
    },
  },
});

assert.strictEqual(customPresetWithoutScale.configWritten, false);
assert.ok(customPresetWithoutScale.needsDesignerInput.includes('explicit typography scale for custom preset'));
assert.ok(customPresetWithoutScale.suggestions.typography, 'custom type block should include typography suggestions');
assert.ok(
  customPresetWithoutScale.suggestions.typography.presetOptions.some(option => option.id === 'material3'),
  'typography suggestions should include supported presets'
);
assert.ok(
  customPresetWithoutScale.suggestions.typography.customTemplates.some(template => template.id === 'editorial-case-study'),
  'typography suggestions should include editable custom templates'
);

const intakeResult = handleCreateDsConfigFromIntake({
  config_path: intakeConfigPath,
  project_name: 'Case study',
  platform: 'Web',
  grid_base: 4,
  breakpoint_tier: '3-tier',
  semantic_color_grammar: 'intent/emphasis',
  contrast_standard: 'WCAG 2.2',
  theme_behavior: 'light + dark',
  color_scale: '50-950',
  brand_colors: [
    { name: 'portfolio blue', hex: '#234CFF', role: 'primary' },
    { name: 'acid lime', hex: '#C6FF32', role: 'accent' },
    { name: 'poster yellow', hex: '#FFD42A', role: 'accent' },
  ],
  typography: {
    scalePreset: 'standard',
    families: {
      sans: 'Roboto Slab',
      mono: 'JetBrains Mono',
    },
  },
  visual_direction: 'editorial case-study system with hard edges and bold accent panels',
});

assert.ok(!intakeResult.error, 'complete intake should succeed');
assert.strictEqual(intakeResult.configWritten, true);
assert.strictEqual(intakeResult.readyForPrepare, true);
assert.strictEqual(intakeResult.nextTool, 'prepare_ds_config');
assert.deepStrictEqual(intakeResult.preview.breakpoints.modes, ['Mobile', 'Tablet', 'Desktop']);
assert.strictEqual(intakeResult.preview.generatedConvention, 'role-based');
assert.strictEqual(intakeResult.preview.contrastAlgorithm, 'wcag');
assert.strictEqual(intakeResult.preview.typography.scalePreset, 'material3');
assert.ok(fs.existsSync(intakeConfigPath), 'complete intake should write file-scoped config');

const intakeWritten = fs.readFileSync(intakeConfigPath, 'utf8');
assert.ok(intakeWritten.includes('"source": "designer-intake"'), 'config should record designer intake source');
assert.ok(intakeWritten.includes('"base": 4'), 'config should preserve grid base');
assert.ok(intakeWritten.includes('"scalePreset": "material3"'), 'standard/material preset labels should normalize to material3');
assert.ok(intakeWritten.includes('"semanticGrammar": "intent-emphasis"'), 'config should preserve semantic grammar');
assert.ok(intakeWritten.includes('"convention": "role-based"'), 'config should map grammar to current prepare convention');
assert.ok(intakeWritten.includes('"contrastAlgorithm": "wcag"'), 'config should preserve WCAG choice');
assert.ok(intakeWritten.includes('"portfolio-blue"'), 'config should slug brand colors');

const customScaleResult = handleCreateDsConfigFromIntake({
  config_path: intakeConfigPath,
  project_name: 'Case study',
  platform: 'Web',
  grid_base: 4,
  breakpoint_tier: '3-tier',
  semantic_color_grammar: 'intent/emphasis',
  contrast_standard: 'WCAG 2.2',
  theme_behavior: 'light + dark',
  color_scale: '50-950',
  brand_colors: [{ name: 'portfolio blue', hex: '#234CFF', role: 'primary' }],
  typography: {
    families: {
      sans: 'Roboto Slab',
      mono: 'JetBrains Mono',
    },
    scale: {
      'body/md': { sizes: [16, 16, 16], lineHeights: [24, 24, 24], weight: 400, tracking: 0 },
    },
  },
});

assert.strictEqual(customScaleResult.configWritten, true);
assert.strictEqual(customScaleResult.preview.typography.scalePreset, 'custom');
const customScaleWritten = fs.readFileSync(intakeConfigPath, 'utf8');
assert.ok(customScaleWritten.includes('"scalePreset": "custom"'));
assert.ok(customScaleWritten.includes('"body/md"'), 'explicit typography scale should be preserved');

fs.rmSync(tmp, { recursive: true, force: true });
if (originalLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
else process.env.FIGLETS_LOCAL_DIR = originalLocalDir;
delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/utils/paths.js')];
delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/design-md-intake.js')];
