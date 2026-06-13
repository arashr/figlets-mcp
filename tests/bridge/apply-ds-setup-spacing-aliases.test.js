const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");

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
    + "\n" + extractFunction(code, "_applyDsSetup", true)
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
        [0, 0],
        [1, 4],
        [2, 8],
        [12, 48],
        [16, 64],
        [24, 96],
      ],
    },
    color: { ramps: [] },
    spacing: {
      semantic: { "layout/lg": [48, 64, 96] },
      radius: { md: 8 },
      border: { thick: 4, default: 1 },
    },
    typography: { scale: {} },
  };

  const result = await context.module.exports._applyDsSetup(DS);
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
  assertJsonEqual(layout.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("space/12")));
  assertJsonEqual(layout.valuesByMode[modeByName.get("Tablet")], alias(primitiveId("space/16")));
  assertJsonEqual(layout.valuesByMode[modeByName.get("Desktop")], alias(primitiveId("space/24")));

  const radius = byName.get("space/radius/md");
  assert.ok(radius, "radius token should be created");
  assertJsonEqual(radius.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("space/2")));
  assertJsonEqual(radius.valuesByMode[modeByName.get("Tablet")], alias(primitiveId("space/2")));
  assertJsonEqual(radius.valuesByMode[modeByName.get("Desktop")], alias(primitiveId("space/2")));

  const thick = byName.get("space/border/thick");
  assert.ok(thick, "border token with a matching primitive should be created");
  assertJsonEqual(thick.valuesByMode[modeByName.get("Mobile")], alias(primitiveId("space/1")));

  const defaultBorder = byName.get("space/border/default");
  assert.ok(defaultBorder, "border token without a matching primitive should still be created");
  assert.strictEqual(defaultBorder.valuesByMode[modeByName.get("Mobile")], 1);
})();
