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
    {
      id: "elevation",
      name: "5. Elevation",
      modes: [{ modeId: "value", name: "Value" }],
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
    makeVariable("shadow-1-offset", "shadow/1/offset-y", "primitives", "FLOAT", { value: 1 }),
    makeVariable("shadow-1-radius", "shadow/1/radius", "primitives", "FLOAT", { value: 2 }),
    makeVariable("shadow-ambient-2-radius", "shadow/ambient/2/radius", "primitives", "FLOAT", { value: 8 }),
    makeVariable("color-shadow-key", "color/shadow/key", "primitives", "COLOR", { value: { r: 0, g: 0, b: 0, a: 0.2 } }),
    makeVariable("color-shadow-ambient", "color/shadow/ambient", "primitives", "COLOR", { value: { r: 0, g: 0, b: 0, a: 0.08 } }),
    makeVariable("existing-size", "type/body/md/size", "typography", "FLOAT", {
      mobile: 10,
      tablet: 10,
      desktop: 10,
    }),
    makeVariable("existing-elevation-radius", "elevation/xs/radius", "elevation", "FLOAT", {
      value: 99,
    }),
  ];
  const effectStyles = [
    { id: "existing-effect-1", name: "elevation/1", effects: [{ type: "DROP_SHADOW", radius: 99 }] },
  ];
  const textStyles = [
    {
      id: "existing-text-body-md",
      name: "type/body/md",
      fontName: { family: "Inter", style: "Regular" },
      boundVariables: {},
      setBoundVariable(property, variable) {
        this.boundVariables[property] = { id: variable.id, type: variable.resolvedType };
      },
    },
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
      const style = { id: `created-effect-${effectStyles.length}`, name: "", effects: [] };
      effectStyles.push(style);
      return style;
    },
    async getLocalTextStylesAsync() {
      return textStyles;
    },
    createTextStyle() {
      const style = {
        id: `created-text-${textStyles.length}`,
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
      if (font.family === "Inter" && (font.style === "Regular" || font.style === "Medium")) return;
      throw new Error(`Font unavailable: ${font.family} ${font.style}`);
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
      elevation: "5. Elevation",
    },
    breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
    naming: { textStyle: "type/{role}/{size}", typePrefix: "type", fontFamily: "font/{variant}" },
    spacing: {
      semantic: { "component/md": [12, 16, 16] },
      radius: { md: 12 },
      border: { thick: 16, default: 1 },
    },
    typography: {
      scale: {
        "body/md": { sizes: [14, 14, 16], lineHeights: [20, 20, 24], weight: 400, tracking: 0 },
        "label/md": { sizes: [12, 14, 14], lineHeights: [16, 18, 18], weight: 500, tracking: 0 },
      },
    },
  };

  const result = await context.module.exports._updateDsTokens({
    DS,
    categories: ["radius", "border-width", "spacing-semantics", "typography-variables", "typography-styles", "elevation-variables", "elevation-styles"],
    createMissing: true,
    dryRun: false,
  });

  assert.ok(!result.error, result.error);
  assertJsonEqual(result.categories, ["radius", "border-width", "spacing-semantics", "typography-variables", "typography-styles", "elevation-variables", "elevation-styles"]);
  assert.strictEqual(result.report.radius.createdVariables.length, 1);
  assert.strictEqual(result.report["border-width"].createdVariables.length, 2);
  assert.strictEqual(result.report["spacing-semantics"].createdVariables.length, 1);
  assert.strictEqual(result.report["typography-variables"].createdVariables.length, 9);
  assert.strictEqual(result.report["typography-variables"].updatedVariables.length, 1);
  assert.strictEqual(result.report["typography-variables"].createdStyles.length, 0);
  assert.strictEqual(result.report["typography-variables"].refreshedStyles.length, 0);
  assert.strictEqual(result.report["typography-styles"].createdVariables.length, 0);
  assert.strictEqual(result.report["typography-styles"].updatedVariables.length, 0);
  assert.strictEqual(result.report["typography-styles"].createdStyles.length, 1);
  assert.strictEqual(result.report["typography-styles"].refreshedStyles.length, 1);
  assert.strictEqual(result.report["typography-styles"].refreshedStyles[0].id, "existing-text-body-md");
  assertJsonEqual(
    result.report["typography-styles"].refreshedStyles[0].boundVariables,
    ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight"]
  );
  assert.strictEqual(result.report["typography-styles"].fontLoadFailures.length, 0);
  assert.strictEqual(result.report["elevation-variables"].createdVariables.length, 9);
  assert.strictEqual(result.report["elevation-variables"].updatedVariables.length, 1);
  assert.strictEqual(result.report["elevation-variables"].createdStyles.length, 0);
  assert.strictEqual(result.report["elevation-variables"].refreshedStyles.length, 0);
  assert.strictEqual(result.report["elevation-styles"].createdVariables.length, 0);
  assert.strictEqual(result.report["elevation-styles"].updatedVariables.length, 0);
  assert.strictEqual(result.report["elevation-styles"].createdStyles.length, 5);
  assert.strictEqual(result.report["elevation-styles"].refreshedStyles.length, 1);
  assert.strictEqual(result.report["elevation-styles"].refreshedStyles[0].id, "existing-effect-1");
  assert.ok(
    result.report["elevation-styles"].bindingWarnings.some(item => item.kind === "missingAmbientRadiusVariable" && item.styleName === "elevation/3"),
    "ambient radius gaps should be reported without blocking style creation"
  );

  const byName = new Map(variables.map(variable => [variable.name, variable]));
  const semanticSpacing = byName.get("space/component/md");
  assert.ok(semanticSpacing, "semantic spacing variable should be created");
  assertJsonEqual(semanticSpacing.valuesByMode.mobile, { type: "VARIABLE_ALIAS", id: "space-12" });
  assertJsonEqual(semanticSpacing.valuesByMode.tablet, { type: "VARIABLE_ALIAS", id: "space-16" });
  assertJsonEqual(semanticSpacing.valuesByMode.desktop, { type: "VARIABLE_ALIAS", id: "space-16" });
  assertJsonEqual(semanticSpacing.scopes, ["GAP"]);

  const radius = byName.get("space/radius/md");
  assert.ok(radius, "radius variable should be created");
  assertJsonEqual(radius.valuesByMode.mobile, { type: "VARIABLE_ALIAS", id: "space-12" });
  assertJsonEqual(radius.valuesByMode.tablet, { type: "VARIABLE_ALIAS", id: "space-12" });
  assertJsonEqual(radius.valuesByMode.desktop, { type: "VARIABLE_ALIAS", id: "space-12" });
  assertJsonEqual(radius.scopes, ["CORNER_RADIUS"]);

  const thickBorder = byName.get("space/border/thick");
  assert.ok(thickBorder, "border variable with matching primitive should be created");
  assertJsonEqual(thickBorder.valuesByMode.mobile, { type: "VARIABLE_ALIAS", id: "space-16" });
  assertJsonEqual(thickBorder.scopes, ["STROKE_FLOAT"]);

  const defaultBorder = byName.get("space/border/default");
  assert.ok(defaultBorder, "border variable without matching primitive should still be created");
  assert.strictEqual(defaultBorder.valuesByMode.mobile, 1);
  assertJsonEqual(defaultBorder.scopes, ["STROKE_FLOAT"]);

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

  const bodyTextStyle = textStyles.find(style => style.name === "type/body/md");
  assert.ok(bodyTextStyle, "existing text style should be refreshed in place");
  assert.strictEqual(bodyTextStyle.id, "existing-text-body-md", "existing text style ID should be preserved");
  assertJsonEqual(bodyTextStyle.boundVariables.fontSize, { id: "existing-size", type: "FLOAT" });
  assertJsonEqual(bodyTextStyle.boundVariables.lineHeight, { id: lineHeight.id, type: "FLOAT" });
  assertJsonEqual(bodyTextStyle.boundVariables.fontFamily, { id: family.id, type: "STRING" });

  const labelTextStyle = textStyles.find(style => style.name === "type/label/md");
  assert.ok(labelTextStyle, "missing text style should be created");
  assertJsonEqual(labelTextStyle.fontName, { family: "Inter", style: "Medium" });
  assertJsonEqual(labelTextStyle.boundVariables.fontWeight, { id: byName.get("type/label/md/weight").id, type: "FLOAT" });

  const elevationOffset = byName.get("elevation/xs/offset-y");
  assert.ok(elevationOffset, "elevation offset variable should be created");
  assertJsonEqual(elevationOffset.valuesByMode.value, { type: "VARIABLE_ALIAS", id: "shadow-1-offset" });
  assertJsonEqual(elevationOffset.scopes, ["EFFECT_FLOAT"]);
  const elevationOffsetReport = result.report["elevation-variables"].createdVariables.find(item => item.name === "elevation/xs/offset-y");
  assert.ok(elevationOffsetReport, "created elevation offset report should include the changed variable");
  assert.strictEqual(elevationOffsetReport.id, elevationOffset.id);
  assertJsonEqual(elevationOffsetReport.scopes, ["EFFECT_FLOAT"]);
  assertJsonEqual(elevationOffsetReport.valuesByMode, [{
    modeId: "value",
    modeName: "Value",
    value: { type: "VARIABLE_ALIAS", id: "shadow-1-offset", name: "shadow/1/offset-y" },
  }]);

  const elevationRadius = byName.get("elevation/xs/radius");
  assert.strictEqual(elevationRadius.id, "existing-elevation-radius", "existing elevation variable ID should be preserved");
  assertJsonEqual(elevationRadius.valuesByMode.value, { type: "VARIABLE_ALIAS", id: "shadow-1-radius" });
  assertJsonEqual(elevationRadius.scopes, ["EFFECT_FLOAT"]);
  const elevationRadiusReport = result.report["elevation-variables"].updatedVariables.find(item => item.name === "elevation/xs/radius");
  assert.ok(elevationRadiusReport, "updated elevation radius report should include the changed variable");
  assert.strictEqual(elevationRadiusReport.id, "existing-elevation-radius");
  assertJsonEqual(elevationRadiusReport.scopes, ["EFFECT_FLOAT"]);
  assertJsonEqual(elevationRadiusReport.valuesByMode, [{
    modeId: "value",
    modeName: "Value",
    value: { type: "VARIABLE_ALIAS", id: "shadow-1-radius", name: "shadow/1/radius" },
  }]);

  const styleByName = new Map(effectStyles.map(style => [style.name, style]));
  const elevationOneStyle = styleByName.get("elevation/1");
  assert.strictEqual(elevationOneStyle.id, "existing-effect-1", "existing elevation style ID should be preserved");
  assert.strictEqual(elevationOneStyle.effects.length, 1);
  assertJsonEqual(elevationOneStyle.effects[0].boundVariables.offsetY, { id: elevationOffset.id, type: "FLOAT" });
  assertJsonEqual(elevationOneStyle.effects[0].boundVariables.radius, { id: "existing-elevation-radius", type: "FLOAT" });
  assertJsonEqual(elevationOneStyle.effects[0].boundVariables.color, { id: "color-shadow-key", type: "COLOR" });

  const elevationTwoStyle = styleByName.get("elevation/2");
  assert.strictEqual(elevationTwoStyle.effects.length, 2);
  assertJsonEqual(elevationTwoStyle.effects[1].boundVariables.color, { id: "color-shadow-ambient", type: "COLOR" });
  assertJsonEqual(elevationTwoStyle.effects[1].boundVariables.radius, { id: "shadow-ambient-2-radius", type: "FLOAT" });

  const lineHeightReport = result.report["typography-variables"].createdVariables.find(item => item.name === "type/body/md/line-height");
  assert.ok(lineHeightReport, "created raw typography variable should include value details");
  assertJsonEqual(lineHeightReport.valuesByMode, [
    { modeId: "mobile", modeName: "Mobile", value: 20 },
    { modeId: "tablet", modeName: "Tablet", value: 20 },
    { modeId: "desktop", modeName: "Desktop", value: 24 },
  ]);
})();
