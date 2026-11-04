const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { planPrimitiveOpacityRepairs } = require("../../packages/figlets-mcp-server/src/tools/primitive-opacity-repair.js");

module.exports = (async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");
  const start = source.indexOf("  if (msg.type === 'extract-all') {");
  const end = source.indexOf("  if (msg.type === 'extract-selection') {", start);
  assert.ok(start >= 0 && end > start);
  const variables = [{
    id: "scrim", name: "color/scrim/black/40", variableCollectionId: "prim",
    resolvedType: "COLOR", valuesByMode: { value: { r: 0, g: 0, b: 0, a: 0.4 } },
  }];
  const collections = [{ id: "prim", name: "1. Primitives", variableIds: ["scrim"], modes: [{ modeId: "value", name: "Value" }] }];
  let payload;
  const context = {
    msg: { type: "extract-all" }, _bridgeBuild: "test", _appendSessionLog() {},
    _getFigletsFileKey() { return "test-file"; },
    figma: {
      root: { name: "Disposable", findAllWithCriteria() { return []; } },
      variables: {
        async getLocalVariablesAsync() { return variables; },
        async getLocalVariableCollectionsAsync() { return collections; },
      },
      async getLocalTextStylesAsync() { return []; },
      async getLocalEffectStylesAsync() { return []; },
      ui: { postMessage(message) { payload = JSON.parse(JSON.stringify(message.data)); } },
    },
  };
  vm.createContext(context);
  await vm.runInContext("(async () => {\n" + source.slice(start, end) + "\n})()", context);
  assert.strictEqual(payload.variables[0].variableCollectionId, "prim");
  const plan = planPrimitiveOpacityRepairs({ collections: { primitives: "1. Primitives" } }, payload);
  assert.deepStrictEqual(plan.blocked, []);
  assert.strictEqual(plan.entries.find(entry => entry.scrim.name === variables[0].name).scrim.id, "scrim");
})();
