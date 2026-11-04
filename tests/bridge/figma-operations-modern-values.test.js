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
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function alias(id) {
  return { type: "VARIABLE_ALIAS", id };
}

function stable(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function makeVariable(id, name, collectionId, resolvedType, valuesByMode) {
  return {
    id,
    name,
    variableCollectionId: collectionId,
    resolvedType,
    valuesByMode: Object.assign({}, valuesByMode),
    scopes: [],
    setValueForMode(modeId, value) {
      this.valuesByMode[modeId] = value;
    },
    remove() {
      this.removed = true;
    },
  };
}

module.exports = (async () => {
  const collections = [
    { id: "prim", name: "1. Primitives", modes: [{ modeId: "value", name: "Value" }], variableIds: [] },
    { id: "color", name: "2. Color", modes: [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }], variableIds: [] },
    { id: "spacing", name: "4. Spacing", modes: [{ modeId: "mobile", name: "Mobile" }], variableIds: [] },
    { id: "motion", name: "6. Motion", modes: [{ modeId: "default", name: "Default" }, { modeId: "reduced", name: "Reduced Motion" }], variableIds: [] },
  ];
  const composedBefore = { color: alias("n50"), opacity: alias("opacity40") };
  const variables = [
    makeVariable("n50", "color/neutral/50", "prim", "COLOR", { value: { r: 1, g: 1, b: 1 } }),
    makeVariable("n950", "color/neutral/950", "prim", "COLOR", { value: { r: 0, g: 0, b: 0 } }),
    makeVariable("opacity40", "opacity/40", "prim", "FLOAT", { value: 40 }),
    makeVariable("composed", "color/scrim/composed", "color", "COLOR", { light: composedBefore, dark: composedBefore }),
    makeVariable("space-base", "space/base", "spacing", "FLOAT", { mobile: 16 }),
    makeVariable("space-use", "space/use", "spacing", "FLOAT", { mobile: alias("space-base") }),
  ];
  let nextId = 1;
  const figma = {
    variables: {
      async getLocalVariableCollectionsAsync() { return collections; },
      async getLocalVariablesAsync() { return variables.filter(variable => !variable.removed); },
      createVariable(name, collection, resolvedType) {
        const variable = makeVariable(`created-${nextId++}`, name, collection.id, resolvedType, {});
        variables.push(variable);
        collection.variableIds.push(variable.id);
        return variable;
      },
    },
    async getLocalTextStylesAsync() { return []; },
    async getLocalEffectStylesAsync() { return []; },
  };

  const helpers = [
    "_scopeForVariableName",
    "_sameVariableScopes",
    "_setVariableScopes",
    "_setVariableScopesForName",
  ];
  const source = helpers.map(name => extractFunction(code, name)).join("\n")
    + "\n" + extractFunction(code, "_applyFigmaOperations", true)
    + "\nmodule.exports = { _applyFigmaOperations };";
  const context = { figma, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "figma-operations-modern-values-runtime.js" });

  const operations = [
    {
      kind: "create_variable",
      name: "motion/duration/standard",
      collection: "6. Motion",
      collectionId: "motion",
      type: "TIMING",
      modeValues: [
        { mode: "Default", modeId: "default", kind: "literal", value: 0.2 },
        { mode: "Reduced Motion", modeId: "reduced", kind: "literal", value: 0 },
      ],
    },
    {
      kind: "create_variable",
      name: "motion/easing/standard",
      collection: "6. Motion",
      collectionId: "motion",
      type: "EASING",
      modeValues: [
        { mode: "Default", modeId: "default", kind: "literal", value: { type: "CUSTOM_CUBIC_BEZIER", easingFunctionCubicBezier: { x1: 0.2, y1: 0, x2: 0, y2: 1 } } },
        { mode: "Reduced Motion", modeId: "reduced", kind: "literal", value: { type: "LINEAR" } },
      ],
    },
    {
      kind: "create_variable",
      name: "color/scrim/new",
      collection: "2. Color",
      collectionId: "color",
      type: "COLOR",
      modeValues: [
        { mode: "Light", modeId: "light", kind: "literal", value: { color: alias("n50"), opacity: alias("opacity40") } },
        { mode: "Dark", modeId: "dark", kind: "literal", value: { color: { r: 0, g: 0, b: 0 }, opacity: alias("opacity40") } },
      ],
    },
    {
      kind: "move_variable",
      variableId: "space-base",
      expectedName: "space/base",
      type: "FLOAT",
      sourceCollectionId: "spacing",
      sourceCollection: "4. Spacing",
      collectionId: "spacing",
      collection: "4. Spacing",
      newName: "space/base-moved",
      modeValues: [
        { mode: "Mobile", modeId: "mobile", kind: "literal", value: 16 },
      ],
      aliasRefs: [{
        variableId: "space-use",
        variableName: "space/use",
        modeId: "mobile",
        aliasPath: [],
        expectedCurrentSignature: stable(alias("space-base")),
      }],
      deleteOriginal: true,
      destructive: true,
    },
    {
      kind: "retarget_variable_aliases",
      fromVariableId: "n50",
      expectedFromName: "color/neutral/50",
      toVariableId: "n950",
      expectedToName: "color/neutral/950",
      type: "COLOR",
      aliasRefs: [{
        variableId: "composed",
        variableName: "color/scrim/composed",
        modeId: "light",
        aliasPath: ["color"],
        expectedCurrentSignature: stable(composedBefore),
      }],
    },
  ];

  const valuesResult = await context.module.exports._applyFigmaOperations({ operations: operations.slice(0, 3) });
  assert.strictEqual(valuesResult.atomic, true);
  assert.strictEqual(valuesResult.batchStatus, "committed");
  assert.strictEqual(valuesResult.created.length, 3);
  const lifecycleResult = await context.module.exports._applyFigmaOperations({ operations: operations.slice(3) });
  const result = { error: valuesResult.error || lifecycleResult.error, applied: valuesResult.applied.concat(lifecycleResult.applied) };
  assert.ok(!result.error, result.error);
  assert.strictEqual(result.applied.length, 5);

  const timing = variables.find(variable => variable.name === "motion/duration/standard");
  assert.strictEqual(timing.resolvedType, "TIMING");
  assert.strictEqual(JSON.stringify(timing.valuesByMode), JSON.stringify({ default: 0.2, reduced: 0 }));

  const easing = variables.find(variable => variable.name === "motion/easing/standard");
  assert.strictEqual(easing.resolvedType, "EASING");
  assert.strictEqual(easing.valuesByMode.default.type, "CUSTOM_CUBIC_BEZIER");

  const newScrim = variables.find(variable => variable.name === "color/scrim/new");
  assert.strictEqual(JSON.stringify(newScrim.valuesByMode.light), JSON.stringify({ color: alias("n50"), opacity: alias("opacity40") }));
  const movedSpace = variables.find(variable => variable.name === "space/base-moved");
  assert.ok(movedSpace, "move should create the replacement variable");
  assert.strictEqual(variables.find(variable => variable.id === "space-base").removed, true);
  assert.strictEqual(variables.find(variable => variable.id === "space-use").valuesByMode.mobile.id, movedSpace.id);
  assert.strictEqual(variables.find(variable => variable.id === "composed").valuesByMode.light.color.id, "n950");
  assert.strictEqual(variables.find(variable => variable.id === "composed").valuesByMode.light.opacity.id, "opacity40");
})();
