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

function makeVariable(id, name, collectionId, type, valuesByMode) {
  return {
    id,
    name,
    variableCollectionId: collectionId,
    resolvedType: type,
    valuesByMode: Object.assign({}, valuesByMode || {}),
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
  const collections = [
    {
      id: "primitives",
      name: "1. Primitives",
      modes: [{ modeId: "value", name: "Default" }],
    },
    {
      id: "spacing",
      name: "4. Spacing",
      modes: [{ modeId: "mobile", name: "Mobile" }],
    },
  ];
  const variables = [
    makeVariable("space-12", "space/12", "primitives", "FLOAT", { value: 48 }),
    makeVariable("layout-lg", "space/layout/lg", "spacing", "FLOAT", { mobile: 48 }),
  ];
  const figma = {
    variables: {
      async getLocalVariableCollectionsAsync() {
        return collections;
      },
      async getLocalVariablesAsync() {
        return variables;
      },
      createVariable(name, collection, type) {
        const variable = makeVariable(`created-${variables.length}`, name, collection.id, type, {});
        variables.push(variable);
        return variable;
      },
      getVariableById(id) {
        return variables.find(variable => variable.id === id) || null;
      },
    },
    async getLocalEffectStylesAsync() {
      return [];
    },
    async getLocalTextStylesAsync() {
      return [];
    },
  };

  const functionNames = [
    "_scopeForVariableName",
    "_sameVariableScopes",
    "_setVariableScopes",
    "_setVariableScopesForName",
    "_emptyTokenUpdateReport",
    "_tokenUpdateItem",
    "_tokenUpdateValueSummary",
    "_tokenUpdateChangedItem",
    "_sanitizeSpaceStep",
    "_typePrefixForTokenUpdate",
    "_typeSizeTokenName",
    "_tokenUpdateEntriesForCategory",
    "_tokenUpdateEntriesFromSpacingRepairs",
    "_tokenValueEq",
  ];
  const source = functionNames.map(name => extractFunction(code, name)).join("\n")
    + "\n" + extractFunction(code, "_updateDsTokens", true)
    + "\nmodule.exports = { _updateDsTokens };";

  const context = { figma, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "update-tokens-spacing-approval-boundary.js" });

  const result = await context.module.exports._updateDsTokens({
    DS: {
      collections: {
        primitives: "1. Primitives",
        spacing: "4. Spacing",
      },
      breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
      spacing: {
        semantic: {
          "layout/lg": [48, 64, 96],
          "component/md": [48, 64, 64],
        },
        radius: {},
        border: {},
      },
    },
    categories: ["spacing-semantics"],
    createMissing: true,
    dryRun: false,
    ensureCollectionModes: false,
    spacingSemanticRepairs: [{
      name: "space/layout/lg",
      updates: [{
        modeId: "mobile",
        modeName: "Mobile",
        toAliasId: "space-12",
        toAliasName: "space/12",
        configExpected: 48,
      }],
    }],
  });

  assert.ok(!result.error, result.error);
  assertJsonEqual(
    collections.find(collection => collection.name === "4. Spacing").modes,
    [{ modeId: "mobile", name: "Mobile" }],
    "Mobile-only semantic spacing repair must not create Tablet/Desktop modes"
  );
  assertJsonEqual(
    variables.find(variable => variable.name === "space/layout/lg").valuesByMode.mobile,
    { type: "VARIABLE_ALIAS", id: "space-12" },
    "approved Mobile raw value should be aliased"
  );
  assert.ok(
    !variables.some(variable => variable.name === "space/component/md"),
    "exact spacing repair payload must not create unrelated semantic spacing variables"
  );

  const malformedExactResult = await context.module.exports._updateDsTokens({
    DS: {
      collections: {
        primitives: "1. Primitives",
        spacing: "4. Spacing",
      },
      breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
      spacing: {
        semantic: {
          "layout/lg": [48, 64, 96],
          "component/md": [48, 64, 64],
        },
        radius: {},
        border: {},
      },
    },
    categories: ["spacing-semantics"],
    createMissing: true,
    dryRun: false,
    ensureCollectionModes: false,
    spacingSemanticRepairs: [],
  });
  assert.ok(
    malformedExactResult.error && malformedExactResult.error.includes("Refusing to fall back"),
    "explicit but empty exact spacing repair payload must fail closed instead of applying the full category"
  );
  assert.ok(
    !variables.some(variable => variable.name === "space/component/md"),
    "empty exact payload must not fall back to creating unrelated semantic spacing variables"
  );

  variables.find(variable => variable.name === "space/layout/lg").valuesByMode.mobile = 48;
  const staleAliasResult = await context.module.exports._updateDsTokens({
    DS: {
      collections: {
        primitives: "1. Primitives",
        spacing: "4. Spacing",
      },
      breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
      spacing: {
        semantic: {
          "layout/lg": [48, 64, 96],
        },
        radius: {},
        border: {},
      },
    },
    categories: ["spacing-semantics"],
    createMissing: true,
    dryRun: false,
    ensureCollectionModes: false,
    spacingSemanticRepairs: [{
      name: "space/layout/lg",
      updates: [{
        modeId: "mobile",
        modeName: "Mobile",
        toAliasId: "space-12-stale-id",
        toAliasName: "space/12",
        configExpected: 48,
      }],
    }],
  });
  assert.ok(!staleAliasResult.error, staleAliasResult.error);
  assert.strictEqual(
    variables.find(variable => variable.name === "space/layout/lg").valuesByMode.mobile,
    48,
    "stale approved alias id must not fall back to alias name or configExpected raw value"
  );
  assert.strictEqual(
    staleAliasResult.report["spacing-semantics"].unmatched.length,
    1,
    "stale approved alias target should be reported as unmatched"
  );

  collections.find(collection => collection.name === "4. Spacing").modes = [
    { modeId: "mobile", name: "Mobile" },
    { modeId: "tablet", name: "Tablet" },
  ];
  variables.find(variable => variable.name === "space/layout/lg").valuesByMode = {
    mobile: 48,
    tablet: 64,
  };
  const staleSecondModeResult = await context.module.exports._updateDsTokens({
    DS: {
      collections: {
        primitives: "1. Primitives",
        spacing: "4. Spacing",
      },
      breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
      spacing: {
        semantic: {
          "layout/lg": [48, 64, 96],
        },
        radius: {},
        border: {},
      },
    },
    categories: ["spacing-semantics"],
    createMissing: true,
    dryRun: false,
    ensureCollectionModes: false,
    spacingSemanticRepairs: [{
      name: "space/layout/lg",
      updates: [
        {
          modeId: "mobile",
          modeName: "Mobile",
          toAliasId: "space-12",
          toAliasName: "space/12",
          configExpected: 48,
        },
        {
          modeId: "tablet",
          modeName: "Tablet",
          toAliasId: "space-16-stale-id",
          toAliasName: "space/16",
          configExpected: 64,
        },
      ],
    }],
  });
  assert.ok(!staleSecondModeResult.error, staleSecondModeResult.error);
  assertJsonEqual(
    variables.find(variable => variable.name === "space/layout/lg").valuesByMode,
    { mobile: 48, tablet: 64 },
    "one stale approved mode target must prevent all writes for that exact token repair"
  );
  assert.strictEqual(
    staleSecondModeResult.report["spacing-semantics"].unmatched.length,
    1,
    "multi-mode exact repair with a stale target should be unmatched instead of partially mutated"
  );
})();
