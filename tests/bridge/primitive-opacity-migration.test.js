const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { planPrimitiveOpacityRepairs } = require("../../packages/figlets-mcp-server/src/tools/primitive-opacity-repair.js");

const sourceCode = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");

function extractFunction(name, isAsync) {
  const prefix = isAsync ? `async function ${name}` : `function ${name}`;
  const start = sourceCode.indexOf(prefix);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = sourceCode.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < sourceCode.length; index++) {
    if (sourceCode[index] === "{") depth += 1;
    if (sourceCode[index] === "}") depth -= 1;
    if (depth === 0) return sourceCode.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function makeVariable(id, name, type, value, scopes) {
  return {
    id,
    name,
    resolvedType: type,
    variableCollectionId: "prim",
    valuesByMode: { default: value },
    scopes: scopes || [],
    setValueForMode(modeId, next) { this.valuesByMode[modeId] = next; },
    remove() { this.removed = true; },
  };
}

module.exports = (async () => {
  const collection = { id: "prim", name: "1. Primitives", modes: [{ modeId: "default", name: "Default" }] };
  const variables = [
    makeVariable("white", "color/neutral/0", "COLOR", { r: 1, g: 1, b: 1 }),
    makeVariable("black", "color/neutral/100", "COLOR", { r: 0, g: 0, b: 0 }),
    makeVariable("scrim-black-40", "color/scrim/black/40", "COLOR", { r: 0, g: 0, b: 0, a: 0.4 }, ["ALL_FILLS"]),
  ];
  const semanticOverlay = makeVariable("overlay", "color/overlay/default", "COLOR", { type: "VARIABLE_ALIAS", id: "scrim-black-40" }, ["ALL_FILLS"]);
  semanticOverlay.variableCollectionId = "color";
  variables.push(semanticOverlay);
  const snapshot = () => ({
    capabilities: { composedColorVariables: true, exactVariableWriteSupport: true },
    collections: [collection],
    variables: variables.filter(item => !item.removed).map(item => ({
      id: item.id,
      name: item.name,
      resolvedType: item.resolvedType,
      variableCollectionId: item.variableCollectionId,
      valuesByMode: item.valuesByMode,
      scopes: item.scopes,
    })),
  });
  const plan = planPrimitiveOpacityRepairs({ collections: { primitives: "1. Primitives" } }, snapshot());
  const approved = plan.entries.filter(entry => entry.scrim.name === "color/scrim/black/40");
  assert.strictEqual(approved.length, 1);

  let nextId = 1;
  const figma = {
    variables: {
      async getLocalVariableCollectionsAsync() { return [collection]; },
      async getLocalVariablesAsync() { return variables.filter(item => !item.removed); },
      createVariable(name, targetCollection, type) {
        const created = makeVariable(`created-${nextId++}`, name, type, undefined, []);
        created.variableCollectionId = targetCollection.id;
        created.valuesByMode = {};
        variables.push(created);
        return created;
      },
    },
  };

  const functions = [
    ["_scopeForVariableName", false],
    ["_sameVariableScopes", false],
    ["_setVariableScopes", false],
    ["_setVariableScopesForName", false],
    ["_primitiveOpacitySignature", false],
    ["_preflightPrimitiveOpacityRepairs", false],
    ["_updateDsPrimitives", true],
  ];
  const source = "var UPDATE_PRIMITIVE_SPECS = { 'primitive-opacity': function () { return null; } };\n"
    + functions.map(([name, isAsync]) => extractFunction(name, isAsync)).join("\n")
    + "\nmodule.exports = { _updateDsPrimitives };";
  const context = { figma, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "primitive-opacity-migration.vm.js" });

  const payload = {
    DS: { collections: { primitives: "1. Primitives" } },
    categories: ["primitive-opacity"],
    opacityRepairs: approved,
    createMissing: true,
  };
  const dryRun = await context.module.exports._updateDsPrimitives(Object.assign({}, payload, { dryRun: true }));
  assert.ok(!dryRun.error, dryRun.error);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(dryRun.report["primitive-opacity"].wouldCreateNames)), ["opacity/40"]);
  assert.deepStrictEqual(variables.map(item => item.name), ["color/neutral/0", "color/neutral/100", "color/scrim/black/40", "color/overlay/default"]);

  const originalScrimId = variables.find(item => item.name === "color/scrim/black/40").id;
  const applied = await context.module.exports._updateDsPrimitives(Object.assign({}, payload, { dryRun: false }));
  assert.ok(!applied.error, applied.error);
  const opacity = variables.find(item => item.name === "opacity/40");
  const scrim = variables.find(item => item.name === "color/scrim/black/40");
  assert.strictEqual(scrim.id, originalScrimId, "scrim ID should survive migration");
  assert.strictEqual(opacity.valuesByMode.default, 40);
  assert.strictEqual(JSON.stringify(opacity.scopes), JSON.stringify(["OPACITY", "COLOR_OPACITY"]));
  assert.strictEqual(scrim.valuesByMode.default.color.id, "black");
  assert.strictEqual(scrim.valuesByMode.default.opacity.id, opacity.id);
  assert.strictEqual(semanticOverlay.valuesByMode.default.id, originalScrimId, "downstream semantic aliases should remain intact");

  const countBeforeStaleApply = variables.length;
  const valueBeforeStaleApply = JSON.stringify(scrim.valuesByMode.default);
  const stale = await context.module.exports._updateDsPrimitives(Object.assign({}, payload, { dryRun: false }));
  assert.ok(stale.error && stale.error.includes("since approval"));
  assert.strictEqual(variables.length, countBeforeStaleApply, "stale approval should not create another variable");
  assert.strictEqual(JSON.stringify(scrim.valuesByMode.default), valueBeforeStaleApply, "stale approval should not mutate the scrim");

  const freshPlan = planPrimitiveOpacityRepairs({ collections: { primitives: "1. Primitives" } }, snapshot());
  assert.ok(!freshPlan.entries.some(entry => entry.scrim.name === "color/scrim/black/40"), "reinspection should make the migration idempotent");
})();
