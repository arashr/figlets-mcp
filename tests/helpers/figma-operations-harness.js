const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");

function extract(name, async = false) {
  const start = source.indexOf(`${async ? "async " : ""}function ${name}(`);
  assert.ok(start >= 0);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Cannot extract ${name}`);
}

function harness({ failWrite = false, failRollback = false, failRemove = false, nativeNumbers = false, failMode = false, empty = false, failWriteName = 'motion/easing/new' } = {}) {
  const collection = { id: "motion", name: "6. Motion", modes: [{ modeId: "d", name: "Default" }, { modeId: "r", name: "Reduced Motion" }], variableIds: ["timing"] };
  const collections = empty ? [] : [collection];
  const writes = [];
  const variables = [];
  let threw = false;
  function nativeValue(value) {
    if (typeof value === "number") return Math.fround(value);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nativeValue(item)]));
  }
  function make(id, name, type, values = {}) {
    return {
      id, name, resolvedType: type, variableCollectionId: "motion", scopes: [], valuesByMode: { ...values },
      setValueForMode(modeId, value) {
        writes.push({ name: this.name, modeId, value });
        if (failWrite && !threw && this.name === failWriteName && (modeId === "r" || modeId === "mode-1")) { threw = true; throw new Error("Injected write failure"); }
        if (failRollback && threw && this.id === "timing") throw new Error("Injected restore failure");
        this.valuesByMode[modeId] = nativeNumbers ? nativeValue(value) : value;
      },
      remove() { if (failRemove) throw new Error("Injected remove failure"); this.removed = true; },
    };
  }
  const timing = make("timing", "motion/duration/standard", "TIMING", { d: Math.fround(0.2), r: 0 });
  if (!empty) variables.push(timing);
  const figma = {
    variables: {
      async getLocalVariableCollectionsAsync() { return collections.filter(c => !c.removed); },
      createVariableCollection(name) {
        const created = { id: 'new-collection', name, variableIds: [], modes: [{ modeId: 'first', name: 'Mode 1' }],
          renameMode(id, name) { this.modes.find(mode => mode.modeId === id).name = name; },
          addMode(name) { if (failMode) throw new Error('Plan permits only one mode'); const id = `mode-${this.modes.length}`; this.modes.push({ modeId: id, name }); return id; },
          remove() { this.removed = true; },
        };
        collections.push(created); return created;
      },
      async getLocalVariablesAsync() { return variables.filter(v => !v.removed); },
      createVariable(name, target, type) { const v = make(`new-${variables.length}`, name, type); v.variableCollectionId = target.id; variables.push(v); target.variableIds.push(v.id); return v; },
    },
    async getLocalTextStylesAsync() { return []; }, async getLocalEffectStylesAsync() { return []; },
  };
  const context = { figma, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(["_scopeForVariableName", "_sameVariableScopes", "_setVariableScopes", "_setVariableScopesForName"].map(name => extract(name)).join("\n") + "\n" + extract("_applyFigmaOperations", true) + "\nmodule.exports = _applyFigmaOperations;", context);
  return { apply: context.module.exports, variables, timing, writes, make, collections, figma,
    snapshot(fileKey = 'setup-test') {
      const active = variables.filter(v => !v.removed);
      return JSON.parse(JSON.stringify({ fileKey, capabilities: { atomicVariableValueBatches: true, variableResolvedTypes: ['FLOAT', 'COLOR', 'STRING', 'BOOLEAN', 'TIMING', 'EASING'] },
        collections: collections.filter(c => !c.removed).map(c => ({ ...c, variableIds: active.filter(v => v.variableCollectionId === c.id).map(v => v.id) })), variables: active, textStyles: [], effectStyles: [] }));
    },
  };
}

module.exports = { harness };
