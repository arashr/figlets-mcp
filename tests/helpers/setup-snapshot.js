const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { generatePrimitivesData } = require('../../packages/figlets-core/src/ds-config');
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

async function buildSetupSnapshot(ds, unavailable = {}) {
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
    async loadFontAsync(font) {
      if (font.family === unavailable.family || font.style === unavailable.style) throw new Error('Font unavailable');
    },
  };

  const functions = [
    ["typographyFamilies", false], ["resolveTypographyFamily", false], ["typographyFontStyles", false], ["_preflightTypographyFonts", true],
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
  const firstResult = await context.module.exports._applyDsSetup({ DS: ds, primitivesData: generatePrimitivesData(ds) });
  if (firstResult.error) return { ...firstResult, variables, collections, textStyles };
  const firstIds = variables.map(variable => variable.id);
  await context.module.exports._applyDsSetup({ DS: ds, primitivesData: generatePrimitivesData(ds) });
  assert.deepStrictEqual(variables.map(variable => variable.id), firstIds, "repeated setup should preserve every generated variable ID");
  return { variables, collections, textStyles };
}


module.exports = { buildSetupSnapshot };
