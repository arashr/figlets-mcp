const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { generatePrimitivesData, readDsConfig } = require("../../packages/figlets-core/src/ds-config");
const { handlePrepareDsConfig } = require("../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js");
const { inspectDsSetupGapsFromFigmaData } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");
const { inspectDsTokenGapsFromConfigAndFigmaData } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");

const { buildSetupSnapshot } = require('../helpers/setup-snapshot');

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-generated-setup-qa-"));
  const configPath = path.join(tmp, "design-system.config.js");
  fs.writeFileSync(configPath, `const DS = {
  project: { name: 'Generated Setup QA', platform: 'Web app' },
  grid: { base: 4 },
  breakpoints: { modes: ['Mobile', 'Tablet', 'Desktop'], tier: 3 },
  typography: { scalePreset: 'fluid', families: { sans: 'JetBrains Mono', mono: 'JetBrains Mono' } },
  color: {
    scale: '100-900',
    algorithm: 'oklch',
    contrastAlgorithm: 'wcag',
    convention: 'role-based',
    brand: [
      { name: 'pink', hex: '#FF5FA2', role: 'primary' },
      { name: 'pale-pink', hex: '#FFD6E7', role: 'secondary' },
      { name: 'warm-peach', hex: '#F6A04D', role: 'accent' },
      { name: 'butter', hex: '#FFD166' },
      { name: 'ink', hex: '#090A0C' }
    ]
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

  const prepared = await handlePrepareDsConfig({ config_path: configPath });
  assert.ok(!prepared.error, "generated setup should prepare");
  assert.strictEqual(prepared.readyToBuild, true, "generated setup should be build-ready on first pass");
  assert.strictEqual(prepared.semanticPairs.failCount, 0, "generated setup should not surface self-inflicted contrast failures");
  assert.deepStrictEqual(
    prepared.setupApprovalPreview.collections[0].sampleTokens.opacity.map(item => item.token),
    ["opacity/4", "opacity/8", "opacity/12", "opacity/16", "opacity/20", "opacity/40", "opacity/60"],
    "setup preview should list every shared opacity primitive"
  );
  assert.strictEqual(prepared.setupApprovalPreview.collections[0].sampleTokens.scrims.length, 10);
  assert.ok(prepared.setupApprovalPreview.collections[0].sampleTokens.scrims.every(item => item.color && item.opacity && item.resolvedRgba));

  const ds = readDsConfig(configPath);
  const brandPair = ds.color.semantics.pairs.find(pair => pair.bg === "color/bg/brand");
  assert.ok(brandPair, "generated semantics should include the brand background pair");
  assert.strictEqual(brandPair.icon, "color/icon/on-brand", "generated bg/brand pair should carry its on-brand icon companion");
  const mutedPair = ds.color.semantics.pairs.find(pair => pair.bg === "color/bg/default" && pair.text === "color/text/muted");
  assert.ok(mutedPair, "generated semantics should include the muted text pair");
  assert.strictEqual(mutedPair.min, null, "generated muted pair should preserve its WCAG contrast exemption");

  const snapshot = await buildSetupSnapshot(ds);
  const multi = JSON.parse(JSON.stringify(ds));
  multi.typography.families.display = 'Space Grotesk';
  multi.typography.scale['body/md'].family = 'Inter';
  const multiSnapshot = await buildSetupSnapshot(multi);
  assert.ok(!multiSnapshot.error, multiSnapshot.error);
  const multiVariables = new Map(multiSnapshot.variables.map(item => [item.name, item]));
  const displayFamily = multiVariables.get('type/display/lg/family');
  assert.strictEqual(Object.values(displayFamily.valuesByMode)[0].id, multiVariables.get('font/display').id);
  assert.strictEqual(multiSnapshot.textStyles.find(item => item.name === 'type/display/lg').fontName.family, 'Space Grotesk');
  assert.strictEqual(multiSnapshot.textStyles.find(item => item.name === 'type/body/md').fontName.family, 'Inter');
  const missingFont = await buildSetupSnapshot(multi, { family: 'Space Grotesk' });
  assert.ok(missingFont.error);
  assert.strictEqual(missingFont.collections.length, 0, 'Font availability must be checked before any setup write');
  assert.strictEqual(missingFont.textStyles.length, 0);
  const missingWeight = await buildSetupSnapshot(multi, { style: 'Medium' });
  assert.ok(missingWeight.error, 'Missing weight must not fall back to Regular');
  assert.strictEqual(missingWeight.variables.length, 0);
  const primitiveCollection = snapshot.collections.find(collection => collection.name === "1. Primitives");
  const primitiveModeId = primitiveCollection.modes[0].modeId;
  const primitiveByName = new Map(snapshot.variables
    .filter(variable => variable.variableCollectionId === primitiveCollection.id)
    .map(variable => [variable.name, variable]));
  for (const value of [4, 8, 12, 16, 20, 40, 60]) {
    const opacity = primitiveByName.get(`opacity/${value}`);
    assert.ok(opacity, `opacity/${value} should be created during setup`);
    assert.strictEqual(opacity.valuesByMode[primitiveModeId], value);
    assert.strictEqual(JSON.stringify(opacity.scopes), JSON.stringify(["OPACITY", "COLOR_OPACITY"]));
  }
  const blackScrim = primitiveByName.get("color/scrim/black/40");
  assert.ok(blackScrim, "black scrim should retain its stable name");
  assert.strictEqual(blackScrim.valuesByMode[primitiveModeId].opacity.type, "VARIABLE_ALIAS");
  assert.strictEqual(blackScrim.valuesByMode[primitiveModeId].opacity.id, primitiveByName.get("opacity/40").id);
  assert.ok(blackScrim.valuesByMode[primitiveModeId].color, "black scrim should use a composed color channel");
  const health = inspectDsSetupGapsFromFigmaData(snapshot, {
    existingDs: ds,
    algorithm: ds.color.contrastAlgorithm,
  });

  assert.deepStrictEqual(
    health.contrastFailures,
    [],
    "a Figlets-generated setup should not produce text contrast failures in the post-build health check"
  );
  assert.deepStrictEqual(
    health.iconContrastFailures,
    [],
    "a Figlets-generated setup should not produce icon contrast failures in the post-build health check"
  );

  assert.deepStrictEqual(
    health.semanticNamingAdvisories.filter(item => /^color\/(?:scrim|shadow)\//.test(item.token || "")),
    [],
    "a Figlets-generated setup should not report generated scrim/shadow utility tokens as naming advisories"
  );

  const spacingHealth = inspectDsTokenGapsFromConfigAndFigmaData(ds, snapshot, {
    configPath,
    categories: ["spacing-semantics"],
  });
  assert.strictEqual(
    spacingHealth.summary.responsiveSpacingAdvisoryCount,
    0,
    "a Figlets-generated setup should not call intentional component/stack/touch same-value defaults unvalidated"
  );
})();
