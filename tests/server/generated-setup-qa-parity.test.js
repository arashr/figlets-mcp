const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const { generatePrimitivesData, readDsConfig } = require("../../packages/figlets-core/src/ds-config");
const { handlePrepareDsConfig } = require("../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js");
const { inspectDsSetupGapsFromFigmaData } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");
const { inspectDsTokenGapsFromConfigAndFigmaData } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");

function extractFunction(source, name, isAsync) {
  const prefix = isAsync ? `async function ${name}` : `function ${name}`;
  const start = source.indexOf(prefix);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function makeCollection(id, name) {
  return {
    id,
    name,
    modes: [{ modeId: `${id}-mode-0`, name: "Mode 1" }],
    variableIds: [],
    addMode(modeName) {
      const modeId = `${id}-mode-${this.modes.length}`;
      this.modes.push({ modeId, name: modeName });
      return modeId;
    },
    renameMode(modeId, modeName) {
      const mode = this.modes.find(item => item.modeId === modeId);
      if (mode) mode.name = modeName;
    },
  };
}

function makeVariable(id, name, collectionId, type) {
  return {
    id,
    name,
    variableCollectionId: collectionId,
    resolvedType: type,
    valuesByMode: {},
    scopes: [],
    setValueForMode(modeId, value) {
      this.valuesByMode[modeId] = value;
    },
  };
}

async function buildSetupSnapshot(ds) {
  const code = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");
  const collections = [];
  const variables = [];
  const effectStyles = [];
  const textStyles = [];
  const figma = {
    variables: {
      async getLocalVariableCollectionsAsync() { return collections; },
      async getLocalVariablesAsync() { return variables; },
      createVariableCollection(name) {
        const collection = makeCollection(`collection-${collections.length}`, name);
        collections.push(collection);
        return collection;
      },
      createVariable(name, collection, type) {
        const variable = makeVariable(`variable-${variables.length}`, name, collection.id, type);
        variables.push(variable);
        collection.variableIds.push(variable.id);
        return variable;
      },
      getVariableById(id) {
        return variables.find(variable => variable.id === id) || null;
      },
      setBoundVariableForEffect(effect) {
        return effect;
      },
    },
    async getLocalEffectStylesAsync() { return effectStyles; },
    createEffectStyle() {
      const style = { id: `effect-${effectStyles.length}`, name: "", effects: [] };
      effectStyles.push(style);
      return style;
    },
    async getLocalTextStylesAsync() { return textStyles; },
    createTextStyle() {
      const style = {
        id: `text-${textStyles.length}`,
        name: "",
        boundVariables: {},
        setBoundVariable(property, variable) {
          this.boundVariables[property] = { id: variable.id, type: variable.resolvedType };
        },
      };
      textStyles.push(style);
      return style;
    },
    async loadFontAsync() {},
  };

  const functions = [
    ["_scopeForVariableName", false],
    ["_sameVariableScopes", false],
    ["_setVariableScopes", false],
    ["_setVariableScopesForName", false],
    ["_applyVariableScopesToCollection", true],
    ["_configuredCollectionName", false],
    ["_configuredBreakpointModes", false],
    ["_configuredInitialMode", false],
    ["_findVariableCollectionByName", false],
    ["_ensureCollectionModes", false],
    ["_applyDsSetup", true],
  ];
  const source = functions.map(([name, isAsync]) => extractFunction(code, name, isAsync)).join("\n")
    + "\nmodule.exports = { _applyDsSetup };";
  const context = { figma, module: { exports: {} }, Set };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "generated-setup-qa-parity.vm.js" });
  await context.module.exports._applyDsSetup({ DS: ds, primitivesData: generatePrimitivesData(ds) });
  const firstIds = variables.map(variable => variable.id);
  await context.module.exports._applyDsSetup({ DS: ds, primitivesData: generatePrimitivesData(ds) });
  assert.deepStrictEqual(variables.map(variable => variable.id), firstIds, "repeated setup should preserve every generated variable ID");
  return { variables, collections };
}

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
