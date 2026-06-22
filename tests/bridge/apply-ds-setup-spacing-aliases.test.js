const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");
const setupSource = extractFunction(code, "_applyDsSetup", true);
assert.ok(setupSource.includes("preparedPrimitives"), "setup executor should consume prepared primitive inventory");
assert.ok(!setupSource.includes("TYPE_SIZES"), "setup executor should not define typography primitive ramps");
assert.ok(!setupSource.includes("SHADOW_FLOATS"), "setup executor should not define shadow primitive ramps");
assert.ok(!setupSource.includes("SCRIMS"), "setup executor should not define scrim primitive ramps");

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
  const collection = {
    id,
    name,
    modes: [{ modeId: `${id}-mode-0`, name: "Mode 1" }],
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
  return collection;
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

function assertJsonEqual(actual, expected, message) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

module.exports = (async () => {
  const collections = [];
  const variables = [];
  const effectStyles = [];
  const textStyles = [];

  const figma = {
    variables: {
      async getLocalVariableCollectionsAsync() {
        return collections;
      },
      async getLocalVariablesAsync() {
        return variables;
      },
      createVariableCollection(name) {
        const collection = makeCollection(`collection-${collections.length}`, name);
        collections.push(collection);
        return collection;
      },
      createVariable(name, collection, type) {
        const variable = makeVariable(`variable-${variables.length}`, name, collection.id, type);
        variables.push(variable);
        return variable;
      },
      getVariableById(id) {
        return variables.find(variable => variable.id === id) || null;
      },
      setBoundVariableForEffect(effect, property, variable) {
        const next = Object.assign({}, effect);
        next.boundVariables = Object.assign({}, effect.boundVariables || {});
        next.boundVariables[property] = { id: variable.id, type: variable.resolvedType };
        return next;
      },
    },
    async getLocalEffectStylesAsync() {
      return effectStyles;
    },
    createEffectStyle() {
      const style = { id: `effect-${effectStyles.length}`, name: "", effects: [] };
      effectStyles.push(style);
      return style;
    },
    async getLocalTextStylesAsync() {
      return textStyles;
    },
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
  ];
  const source = functions.map(([name, isAsync]) => extractFunction(code, name, isAsync)).join("\n")
    + "\n" + setupSource
    + "\nmodule.exports = { _applyDsSetup };";

  const context = { figma, module: { exports: {} }, Set };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "apply-ds-setup-spacing-aliases.js" });

  const DS = {
    collections: {
      primitives: "1. Primitives",
      color: "2. Color",
      typography: "3. Typography",
      spacing: "4. Spacing",
      elevation: "5. Elevation",
    },
    breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
    primitives: {
      spacing: [
        ["0", 0],
        ["025", 2],
        ["050", 4],
        ["100", 8],
        ["600", 48],
        ["800", 64],
        ["1200", 96],
      ],
    },
    color: { ramps: [] },
    spacing: {
      semantic: { "layout/lg": [48, 64, 96] },
      radius: { xs: 2, md: 8, full: 9999 },
      border: { hairline: 0.5, thick: 4, default: 1 },
    },
    typography: {
      scale: {
        "display/lg": { sizes: [45, 57, 72], lineHeights: [52, 64, 80], weight: 400, tracking: -0.02 },
      },
    },
  };

  const primitivesData = {
    collectionName: "1. Primitives",
    colors: [],
    scrims: [],
    floats: [
      { name: "space/0", value: 0 },
      { name: "space/025", value: 2 },
      { name: "space/050", value: 4 },
      { name: "space/100", value: 8 },
      { name: "space/600", value: 48 },
      { name: "space/800", value: 64 },
      { name: "space/1200", value: 96 },
      { name: "radius/xs", value: 2 },
      { name: "radius/md", value: 8 },
      { name: "radius/full", value: 9999 },
      { name: "border/width/hairline", value: 0.5 },
      { name: "border/width/default", value: 1 },
      { name: "border/width/thick", value: 4 },
      { name: "type/size/45", value: 45 },
      { name: "type/size/57", value: 57 },
      { name: "type/size/7xl", value: 72 },
      { name: "type/weight/regular", value: 400 },
      { name: "type/tracking/tight", value: -0.02 },
    ],
    strings: [
      { name: "font/sans", value: "Inter" },
      { name: "font/mono", value: "JetBrains Mono" },
    ],
  };

  const result = await context.module.exports._applyDsSetup({ DS, primitivesData });
  assert.ok(/Created:/.test(result.message), result.message);

  const byName = new Map(variables.map(variable => [variable.name, variable]));
  const spacingCollection = collections.find(collection => collection.name === "4. Spacing");
  assert.ok(spacingCollection, "setup should create the spacing collection");
  const modeByName = new Map(spacingCollection.modes.map(mode => [mode.name, mode.modeId]));

  const primitiveId = name => {
    const variable = byName.get(name);
    assert.ok(variable, `${name} should exist`);
    return variable.id;
  };
  const alias = id => ({ type: "VARIABLE_ALIAS", id });

  const layout = byName.get("space/layout/lg");
  assert.ok(layout, "semantic spacing token should be created");
  assertJsonEqual(layout.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("space/600")));
  assertJsonEqual(layout.valuesByMode[modeByName.get("Tablet")], alias(primitiveId("space/800")));
  assertJsonEqual(layout.valuesByMode[modeByName.get("Desktop")], alias(primitiveId("space/1200")));

  const radius = byName.get("space/radius/md");
  assert.ok(radius, "radius token should be created");
  assertJsonEqual(radius.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("radius/md")));
  assertJsonEqual(radius.valuesByMode[modeByName.get("Tablet")], alias(primitiveId("radius/md")));
  assertJsonEqual(radius.valuesByMode[modeByName.get("Desktop")], alias(primitiveId("radius/md")));

  const tinyRadius = byName.get("space/radius/xs");
  assert.ok(tinyRadius, "tiny radius token should be created");
  assertJsonEqual(tinyRadius.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("radius/xs")));

  const fullRadius = byName.get("space/radius/full");
  assert.ok(fullRadius, "full radius token should be created");
  assertJsonEqual(fullRadius.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("radius/full")));

  const hairline = byName.get("space/border/hairline");
  assert.ok(hairline, "hairline border token should be created");
  assertJsonEqual(hairline.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("border/width/hairline")));

  const thick = byName.get("space/border/thick");
  assert.ok(thick, "border token with a matching primitive should be created");
  assertJsonEqual(thick.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("border/width/thick")));

  const defaultBorder = byName.get("space/border/default");
  assert.ok(defaultBorder, "default border token should be created");
  assertJsonEqual(defaultBorder.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("border/width/default")));

  assert.ok(byName.get("type/size/45"), "setup should create a primitive for non-standard fluid size 45");
  assert.ok(byName.get("type/size/57"), "setup should create a primitive for non-standard fluid size 57");
  const displaySize = byName.get("type/display/lg/size");
  assert.ok(displaySize, "typography size semantic should be created");
  const typographyCollection = collections.find(collection => collection.name === "3. Typography");
  assert.ok(typographyCollection, "setup should create the typography collection");
  const typoModeByName = new Map(typographyCollection.modes.map(mode => [mode.name, mode.modeId]));
  assertJsonEqual(displaySize.valuesByMode[typoModeByName.get("Mobile")], alias(primitiveId("type/size/45")));
  assertJsonEqual(displaySize.valuesByMode[typoModeByName.get("Tablet")], alias(primitiveId("type/size/57")));
  assertJsonEqual(displaySize.valuesByMode[typoModeByName.get("Desktop")], alias(primitiveId("type/size/7xl")));

  const displayLineHeight = byName.get("type/display/lg/line-height");
  assert.ok(displayLineHeight, "typography line-height semantic should be created");
  assert.strictEqual(displayLineHeight.valuesByMode[typoModeByName.get("Mobile")], 52);
  assert.strictEqual(displayLineHeight.valuesByMode[typoModeByName.get("Tablet")], 64);
  assert.strictEqual(displayLineHeight.valuesByMode[typoModeByName.get("Desktop")], 80);
})();
