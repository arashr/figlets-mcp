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
      modes: [{ modeId: "value", name: "Value" }],
    },
    {
      id: "spacing",
      name: "4. Spacing",
      modes: [
        { modeId: "mobile", name: "Mobile" },
        { modeId: "tablet", name: "Tablet" },
        { modeId: "desktop", name: "Desktop" },
      ],
    },
    {
      id: "typography",
      name: "3. Typography",
      modes: [
        { modeId: "mobile", name: "Mobile" },
        { modeId: "tablet", name: "Tablet" },
        { modeId: "desktop", name: "Desktop" },
      ],
    },
  ];

  const variables = [
    makeVariable("space-12", "space/12", "primitives", "FLOAT", { value: 12 }),
    makeVariable("space-16", "space/16", "primitives", "FLOAT", { value: 16 }),
    makeVariable("type-size-sm", "type/size/sm", "primitives", "FLOAT", { value: 14 }),
    makeVariable("type-size-md", "type/size/md", "primitives", "FLOAT", { value: 16 }),
    makeVariable("type-weight-regular", "type/weight/regular", "primitives", "FLOAT", { value: 400 }),
    makeVariable("type-tracking-normal", "type/tracking/normal", "primitives", "FLOAT", { value: 0 }),
    makeVariable("font-sans", "font/sans", "primitives", "STRING", { value: "Inter" }),
    makeVariable("existing-size", "type/body/md/size", "typography", "FLOAT", {
      mobile: 10,
      tablet: 10,
      desktop: 10,
    }),
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
    },
  };

  const functionNames = [
    "_scopeForVariableName",
    "_sameVariableScopes",
    "_setVariableScopes",
    "_setVariableScopesForName",
    "_emptyTokenUpdateReport",
    "_tokenUpdateItem",
    "_sanitizeSpaceStep",
    "_typePrefixForTokenUpdate",
    "_typeSizeTokenName",
    "_tokenUpdateEntriesForCategory",
    "_tokenValueEq",
  ];
  const source = functionNames.map(name => extractFunction(code, name)).join("\n")
    + "\n" + extractFunction(code, "_updateDsTokens", true)
    + "\nmodule.exports = { _updateDsTokens };";

  const context = { figma, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "update-tokens-runtime.js" });

  const DS = {
    collections: {
      primitives: "1. Primitives",
      spacing: "4. Spacing",
      typography: "3. Typography",
    },
    breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
    naming: { textStyle: "type/{role}/{size}", typePrefix: "type", fontFamily: "font/{variant}" },
    spacing: {
      semantic: { "component/md": [12, 16, 16] },
      radius: {},
      border: {},
    },
    typography: {
      scale: {
        "body/md": { sizes: [14, 14, 16], lineHeights: [20, 20, 24], weight: 400, tracking: 0 },
      },
    },
  };

  const result = await context.module.exports._updateDsTokens({
    DS,
    categories: ["spacing-semantics", "typography-variables"],
    createMissing: true,
    dryRun: false,
  });

  assert.ok(!result.error, result.error);
  assertJsonEqual(result.categories, ["spacing-semantics", "typography-variables"]);
  assert.strictEqual(result.report["spacing-semantics"].createdVariables.length, 1);
  assert.strictEqual(result.report["typography-variables"].createdVariables.length, 4);
  assert.strictEqual(result.report["typography-variables"].updatedVariables.length, 1);
  assert.strictEqual(result.report["typography-variables"].createdStyles.length, 0);
  assert.strictEqual(result.report["typography-variables"].refreshedStyles.length, 0);

  const byName = new Map(variables.map(variable => [variable.name, variable]));
  const semanticSpacing = byName.get("space/component/md");
  assert.ok(semanticSpacing, "semantic spacing variable should be created");
  assertJsonEqual(semanticSpacing.valuesByMode.mobile, { type: "VARIABLE_ALIAS", id: "space-12" });
  assertJsonEqual(semanticSpacing.valuesByMode.tablet, { type: "VARIABLE_ALIAS", id: "space-16" });
  assertJsonEqual(semanticSpacing.valuesByMode.desktop, { type: "VARIABLE_ALIAS", id: "space-16" });
  assertJsonEqual(semanticSpacing.scopes, ["GAP"]);

  const existingSize = byName.get("type/body/md/size");
  assert.strictEqual(existingSize.id, "existing-size", "existing typography variable ID should be preserved");
  assertJsonEqual(existingSize.valuesByMode.mobile, { type: "VARIABLE_ALIAS", id: "type-size-sm" });
  assertJsonEqual(existingSize.valuesByMode.tablet, { type: "VARIABLE_ALIAS", id: "type-size-sm" });
  assertJsonEqual(existingSize.valuesByMode.desktop, { type: "VARIABLE_ALIAS", id: "type-size-md" });
  assertJsonEqual(existingSize.scopes, ["FONT_SIZE"]);

  const lineHeight = byName.get("type/body/md/line-height");
  assert.ok(lineHeight, "line-height variable should be created");
  assert.strictEqual(lineHeight.valuesByMode.mobile, 20);
  assert.strictEqual(lineHeight.valuesByMode.desktop, 24);
  assertJsonEqual(lineHeight.scopes, ["LINE_HEIGHT"]);

  const family = byName.get("type/body/md/family");
  assert.ok(family, "family variable should be created when a font primitive exists");
  assertJsonEqual(family.valuesByMode.mobile, { type: "VARIABLE_ALIAS", id: "font-sans" });
  assertJsonEqual(family.scopes, ["FONT_FAMILY"]);
})();
