const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-prepare-ds-"));
const configPath = path.join(tmp, "design-system.config.js");

fs.writeFileSync(configPath, `const DS = {
  project: { name: 'Preview Test', platform: 'Web app' },
  grid: { base: 4 },
  breakpoints: { modes: ['Desktop'], tier: 1 },
  typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
  color: {
    scale: '50-950',
    algorithm: 'oklch',
    contrastAlgorithm: 'wcag',
    convention: 'role-based',
    brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }]
  },
  naming: { textStyle: 'type/{role}/{size}', fontFamily: 'font/{variant}' },
  collections: {
    primitives: '1. Primitives',
    color: '2. Color',
    typography: '3. Typography',
    spacing: '4. Spacing',
    elevation: '5. Elevation'
  }
};\n`, "utf8");

const { handlePrepareDsConfig } = require("../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js");
const result = handlePrepareDsConfig({ config_path: configPath });

assert.ok(!result.error, "prepare_ds_config should succeed");
assert.ok(result.setupPreview && result.setupPreview.svgPath, "prepare_ds_config should return setup preview path");
assert.ok(fs.existsSync(result.setupPreview.svgPath), "setup preview SVG should be written next to the config");
assert.ok(fs.readFileSync(result.setupPreview.svgPath, "utf8").includes("Semantic pairs"), "preview should include semantic pairs");
assert.ok(result.designMdExport && result.designMdExport.path, "prepare_ds_config should return DESIGN.md export path");
assert.ok(fs.existsSync(result.designMdExport.path), "DESIGN.md should be written next to the config");
assert.ok(fs.readFileSync(result.designMdExport.path, "utf8").includes("## Overview"), "DESIGN.md export should include portable agent context");

fs.rmSync(tmp, { recursive: true, force: true });
