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

const {
  handleApplyDsConfigContrastRepairs,
  handlePrepareDsConfig,
} = require("../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js");
const result = handlePrepareDsConfig({ config_path: configPath });

assert.ok(!result.error, "prepare_ds_config should succeed");
assert.ok(result.setupApprovalPreview, "prepare_ds_config should return a detailed setup approval preview");
assert.strictEqual(result.setupApprovalPreview.approvalBoundary.previewOnly, true);
assert.strictEqual(result.setupApprovalPreview.approvalBoundary.writeTool, "apply_ds_setup");
assert.ok(
  result.setupApprovalPreview.approvalBoundary.message.includes("Nothing has been changed in Figma"),
  "preview should make the no-write approval boundary explicit"
);
assert.ok(
  result.setupApprovalPreview.collections.length >= 5,
  "preview should describe the planned Figma collections, not only aggregate counts"
);
assert.ok(
  result.setupApprovalPreview.collections.some(collection =>
    collection.name === "2. Color" &&
    Array.isArray(collection.sampleAliases) &&
    collection.sampleAliases.some(alias => alias.background && alias.text && alias.Light && alias.Dark)
  ),
  "preview should include concrete semantic color alias examples"
);
assert.ok(
  result.setupApprovalPreview.collections.some(collection =>
    collection.name === "4. Spacing" &&
    Array.isArray(collection.sampleTokens) &&
    collection.sampleTokens.some(token => token.token === "space/layout/lg" && token.values.length === 3)
  ),
  "preview should include concrete responsive spacing token examples"
);
assert.ok(
  result.setupApprovalPreview.colorSystem.rampNames.includes("cobalt"),
  "preview should list generated ramp names"
);
assert.ok(
  result.primitives && result.primitives.counts && result.primitives.counts.colors > 0,
  "detailed preview should be additive and preserve the existing primitives summary"
);
assert.ok(result.setupPreview && result.setupPreview.svgPath, "prepare_ds_config should return setup preview path");
assert.ok(fs.existsSync(result.setupPreview.svgPath), "setup preview SVG should be written next to the config");
assert.ok(fs.readFileSync(result.setupPreview.svgPath, "utf8").includes("Semantic pairs"), "preview should include semantic pairs");
assert.ok(result.designMdExport && result.designMdExport.path, "prepare_ds_config should return DESIGN.md export path");
assert.ok(fs.existsSync(result.designMdExport.path), "DESIGN.md should be written next to the config");
assert.ok(fs.readFileSync(result.designMdExport.path, "utf8").includes("## Overview"), "DESIGN.md export should include portable agent context");

function writeCustomTypographyConfig(filePath, textStylePattern) {
  fs.writeFileSync(filePath, `const DS = {
  project: { name: 'Custom Type Preview', platform: 'Web app' },
  grid: { base: 4 },
  breakpoints: { modes: ['Mobile', 'Tablet', 'Desktop'], tier: 1 },
  typography: {
    scalePreset: 'custom',
    families: { sans: 'Inter', mono: 'JetBrains Mono' },
    scale: {
      'body/md': { sizes: [14, 16, 16], lineHeights: [20, 24, 24], weight: 400, tracking: 0 },
      'label/action/sm': { sizes: [12, 12, 12], lineHeights: [16, 16, 16], weight: 500, tracking: 0.01 }
    }
  },
  color: {
    scale: '50-950',
    algorithm: 'oklch',
    contrastAlgorithm: 'wcag',
    convention: 'role-based',
    brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }]
  },
  naming: { textStyle: '${textStylePattern}', fontFamily: 'font/{variant}' },
  collections: {
    primitives: '1. Primitives',
    color: '2. Color',
    typography: '3. Typography',
    spacing: '4. Spacing',
    elevation: '5. Elevation'
  }
};\n`, "utf8");
}

const customWithSizePath = path.join(tmp, "custom-with-size.config.js");
writeCustomTypographyConfig(customWithSizePath, "type/{role}/{size}");
const customWithSize = handlePrepareDsConfig({ config_path: customWithSizePath });
assert.ok(!customWithSize.error, "custom type config with {size} should prepare");
assert.ok(
  customWithSize.setupApprovalPreview.typographySystem.textStyleExamples.includes("type/body/md"),
  "preview should preserve body/md style naming when pattern includes {size}"
);
assert.ok(
  customWithSize.setupApprovalPreview.typographySystem.textStyleExamples.includes("type/label/action/sm"),
  "preview should preserve multi-segment role naming when pattern includes {size}"
);

const customNoSizePath = path.join(tmp, "custom-no-size.config.js");
writeCustomTypographyConfig(customNoSizePath, "text/{role}");
const customNoSize = handlePrepareDsConfig({ config_path: customNoSizePath });
assert.ok(!customNoSize.error, "custom type config without {size} should prepare");
assert.ok(
  customNoSize.setupApprovalPreview.typographySystem.textStyleExamples.includes("text/body/md"),
  "preview should use the full role when pattern omits {size}"
);
assert.ok(
  customNoSize.setupApprovalPreview.typographySystem.textStyleExamples.includes("text/label/action/sm"),
  "preview should not truncate multi-segment roles when pattern omits {size}"
);

const failingContrastPath = path.join(tmp, "failing-contrast.config.js");
fs.writeFileSync(failingContrastPath, `const DS = {
  project: { name: 'Failing Contrast Preview', platform: 'Web app' },
  grid: { base: 4 },
  breakpoints: { modes: ['Mobile', 'Tablet', 'Desktop'], tier: 3 },
  typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
  color: {
    scale: '50-950',
    algorithm: 'oklch',
    contrastAlgorithm: 'wcag',
    convention: 'role-based',
    brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }],
    semantics: {
      convention: 'role-based',
      pairs: [{
        bg: 'color/bg/default',
        text: 'color/text/default',
        Light: { bg: 'color/neutral/50', text: 'color/neutral/50' },
        Dark: { bg: 'color/neutral/950', text: 'color/neutral/950' }
      }]
    }
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

const failingContrast = handlePrepareDsConfig({ config_path: failingContrastPath });
assert.ok(!failingContrast.error, "failing contrast config should still prepare");
assert.ok(failingContrast.semanticPairs.failCount > 0, "test fixture should fail contrast");
assert.ok(
  failingContrast.message.includes("semanticPairs.contrastRepairOptions"),
  "prepare message should point agents at structured contrast options"
);
assert.ok(
  failingContrast.semanticPairs.contrastRepairOptions.some(option =>
    option.background === "color/bg/default" &&
    option.text === "color/text/default" &&
    option.suggestedText &&
    option.approvalLabel
  ),
  "semanticPairs should expose exact contrast repair options"
);
assert.deepStrictEqual(
  failingContrast.semanticPairs.contrastRepairOptions,
  failingContrast.setupApprovalPreview.semanticColor.contrast.repairOptions,
  "setup approval preview should carry the same contrast repair options"
);
assert.deepStrictEqual(
  failingContrast.semanticPairs.contrastRepairApplyInput.repairs,
  failingContrast.semanticPairs.contrastRepairOptions,
  "prepare should expose a copy-ready config contrast repair apply payload"
);
assert.deepStrictEqual(
  failingContrast.setupApprovalPreview.semanticColor.contrast.repairApplyInput,
  failingContrast.semanticPairs.contrastRepairApplyInput,
  "setup approval preview should expose the same copy-ready contrast repair apply payload"
);
assert.strictEqual(
  failingContrast.setupApprovalPreview.semanticColor.contrast.repairTool,
  "apply_ds_config_contrast_repairs",
  "setup approval preview should name the local config contrast repair tool"
);
assert.ok(
  failingContrast.semanticPairs.contrastRepairOptions.length >= 2,
  "fixture should expose multiple contrast repairs so mixed valid+stale apply is tested"
);

const staleContrastInput = JSON.parse(JSON.stringify(failingContrast.semanticPairs.contrastRepairApplyInput));
staleContrastInput.repairs[0].suggestedText = "color/not-in-current-suggestions/123";
const beforeStaleAttempt = fs.readFileSync(failingContrastPath, "utf8");
const staleContrastRepair = handleApplyDsConfigContrastRepairs(staleContrastInput);
assert.ok(staleContrastRepair.error, "stale contrast repair payload should be rejected");
assert.strictEqual(
  staleContrastRepair.appliedCount,
  0,
  "mixed valid+stale contrast repair payload should report no applied writes"
);
assert.ok(
  staleContrastRepair.blocked.some(item => item.reason.includes("current prepare_ds_config contrast suggestions") || item.reason.includes("Current prepared suggestion")),
  "stale contrast repair should explain that the option is not current"
);
assert.strictEqual(
  fs.readFileSync(failingContrastPath, "utf8"),
  beforeStaleAttempt,
  "stale or mixed-invalid contrast repair payload must leave the config file unchanged"
);

const approvedContrastRepair = handleApplyDsConfigContrastRepairs(
  failingContrast.semanticPairs.contrastRepairApplyInput
);
assert.ok(!approvedContrastRepair.error, "approved contrast repair should apply to local config");
assert.strictEqual(approvedContrastRepair.figmaChanged, false, "contrast config repair must not mutate Figma");
assert.strictEqual(approvedContrastRepair.configWritten, true, "contrast config repair should write the local config");
assert.strictEqual(
  approvedContrastRepair.appliedCount,
  failingContrast.semanticPairs.contrastRepairOptions.length,
  "contrast config repair should apply every approved repair option"
);
assert.ok(
  approvedContrastRepair.message.includes("Rerun prepare_ds_config"),
  "contrast config repair should send agents back through prepare before build"
);

const afterContrastRepair = handlePrepareDsConfig({ config_path: failingContrastPath });
assert.ok(!afterContrastRepair.error, "reprepare after approved contrast repair should succeed");
assert.strictEqual(afterContrastRepair.semanticPairs.failCount, 0, "approved contrast repair should clear setup contrast failures");
assert.strictEqual(afterContrastRepair.readyToBuild, true, "reprepared config should be build-ready after contrast repair");

fs.rmSync(tmp, { recursive: true, force: true });
