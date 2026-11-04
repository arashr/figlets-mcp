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

function harness({ failWrite = false, failRollback = false, failRemove = false, nativeNumbers = false, failMode = false } = {}) {
  const collection = { id: "motion", name: "6. Motion", modes: [{ modeId: "d", name: "Default" }, { modeId: "r", name: "Reduced Motion" }], variableIds: ["timing"] };
  const collections = [collection];
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
        if (failWrite && !threw && this.name === "motion/easing/new" && modeId === "r") { threw = true; throw new Error("Injected write failure"); }
        if (failRollback && threw && this.id === "timing") throw new Error("Injected restore failure");
        this.valuesByMode[modeId] = nativeNumbers ? nativeValue(value) : value;
      },
      remove() { if (failRemove) throw new Error("Injected remove failure"); this.removed = true; },
    };
  }
  const timing = make("timing", "motion/duration/standard", "TIMING", { d: Math.fround(0.2), r: 0 });
  variables.push(timing);
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
      createVariable(name, target, type) { const v = make(`new-${variables.length}`, name, type); variables.push(v); return v; },
    },
    async getLocalTextStylesAsync() { return []; }, async getLocalEffectStylesAsync() { return []; },
  };
  const context = { figma, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(["_scopeForVariableName", "_sameVariableScopes", "_setVariableScopes", "_setVariableScopesForName"].map(name => extract(name)).join("\n") + "\n" + extract("_applyFigmaOperations", true) + "\nmodule.exports = _applyFigmaOperations;", context);
  return { apply: context.module.exports, variables, timing, writes, make, collections };
}

const update = value => ({ kind: "update_variable", variableId: "timing", expectedName: "motion/duration/standard", type: "TIMING", collectionId: "motion", collection: "6. Motion", modeValues: [
  { modeId: "d", mode: "Default", kind: "literal", value, expectedCurrentSignature: JSON.stringify(Math.fround(0.2)) },
  { modeId: "r", mode: "Reduced Motion", kind: "literal", value: 0, expectedCurrentSignature: "0" },
] });
const create = () => ({ kind: "create_variable", name: "motion/easing/new", type: "EASING", collectionId: "motion", collection: "6. Motion", modeValues: [
  { modeId: "d", mode: "Default", kind: "literal", value: { type: "LINEAR" } },
  { modeId: "r", mode: "Reduced Motion", kind: "literal", value: { type: "LINEAR" } },
] });

module.exports = (async () => {
  let h = harness();
  let result = await h.apply({ operations: [update(0.2), create()] });
  assert.strictEqual(result.batchStatus, "committed");
  assert.strictEqual(result.unchanged.length, 1, "float32 timing readback must not cause a false update");
  assert.strictEqual(result.created.length, 1);
  assert.ok(h.writes.every(w => w.name !== h.timing.name), "unchanged variables must not be written");
  assert.strictEqual(result.results.length, 2);

  h = harness();
  const stale = update(0.3); stale.modeValues[1].expectedCurrentSignature = "1";
  result = await h.apply({ operations: [create(), stale] });
  assert.strictEqual(result.batchStatus, "blocked");
  assert.strictEqual(result.blocked.length, 2);
  assert.strictEqual(h.writes.length, 0, "a stale later mode must block earlier creates and mode writes");
  assert.strictEqual(h.variables.length, 1);

  h = harness({ failWrite: true });
  const laterCreate = { ...create(), name: "motion/easing/not-attempted" };
  result = await h.apply({ operations: [update(0.3), create(), laterCreate] });
  assert.strictEqual(result.batchStatus, "rolled_back");
  assert.strictEqual(result.applied.length, 0);
  assert.strictEqual(result.failed.length, 1);
  assert.strictEqual(result.rolledBack.length, 1);
  assert.strictEqual(result.rollbackErrors.length, 0);
  assert.strictEqual(result.blocked.length, 1);
  assert.strictEqual(result.failed[0].rollback, "restored");
  assert.deepStrictEqual(h.timing.valuesByMode, { d: Math.fround(0.2), r: 0 });
  assert.strictEqual(h.variables.filter(v => !v.removed).length, 1, "partly initialized creates must be removed");

  h = harness({ failWrite: true, failRollback: true });
  result = await h.apply({ operations: [update(0.3), create()] });
  assert.strictEqual(result.batchStatus, "rollback_failed");
  assert.strictEqual(result.failed.length, 2);
  assert.strictEqual(result.rolledBack.length, 0, "failed restores must not be described as rolled back");
  assert.ok(result.rollbackErrors.length >= 1);

  h = harness({ failWrite: true, failRemove: true });
  result = await h.apply({ operations: [create()] });
  assert.strictEqual(result.batchStatus, "rollback_failed");
  assert.ok(result.rollbackErrors.some(e => e.name === "motion/easing/new"));

  h = harness();
  result = await h.apply({ operations: [update(0.3), update(0.4)] });
  assert.strictEqual(result.batchStatus, "blocked");
  assert.strictEqual(h.writes.length, 0);
  const badAlias = create(); badAlias.modeValues[0] = { modeId: "d", mode: "Default", kind: "alias", targetId: "missing", targetName: "missing" };
  result = await h.apply({ operations: [update(0.3), badAlias] });
  assert.strictEqual(result.batchStatus, "blocked");
  assert.strictEqual(h.writes.length, 0);
  result = await h.apply({ operations: [update(0.3), { kind: "delete_variable", variableId: "timing", expectedName: h.timing.name }] });
  assert.strictEqual(result.batchStatus, "blocked");
  assert.strictEqual(h.writes.length, 0);

  h = harness();
  const extra = [
    ["FLOAT", 3.5], ["STRING", "label"], ["BOOLEAN", true], ["COLOR", { r: 1, g: 0, b: 0 }],
  ].map(([type, value]) => ({ ...create(), name: `test/${type}`, type, modeValues: [
    { modeId: "d", mode: "Default", kind: "literal", value },
  ] }));
  result = await h.apply({ operations: extra });
  assert.strictEqual(result.batchStatus, "committed");
  assert.strictEqual(result.created.length, 4, "atomic create supports the other four variable types");

  h = harness({ nativeNumbers: true });
  const fraction = { ...create(), name: "motion/fraction", type: "FLOAT", modeValues: [{ modeId: "d", mode: "Default", kind: "literal", value: 1.1 }] };
  result = await h.apply({ atomicVariableBatch: { version: 1, operations: [fraction] } });
  assert.strictEqual(result.batchStatus, "committed");
  const storedFraction = h.variables.find(v => v.name === fraction.name);
  assert.strictEqual(storedFraction.valuesByMode.d, Math.fround(1.1));
  const repeatFraction = { ...fraction, kind: "update_variable", variableId: storedFraction.id, expectedName: storedFraction.name, modeValues: [{ ...fraction.modeValues[0], expectedCurrentSignature: JSON.stringify(Math.fround(1.1)) }] };
  result = await h.apply({ operations: [repeatFraction] });
  assert.strictEqual(result.unchanged.length, 1);

  h.variables.push(h.make("base-color", "motion/base-color", "COLOR", { d: { r: 0, g: 0, b: 0, a: 1 } }));
  const composed = { ...fraction, name: "motion/composed-fraction", type: "COLOR", modeValues: [{ modeId: "d", mode: "Default", kind: "literal", value: { color: { type: "VARIABLE_ALIAS", id: "base-color" }, opacity: 12.1 } }] };
  result = await h.apply({ operations: [composed] });
  assert.strictEqual(result.batchStatus, "committed", "raw composed opacity must accept native fractional readback");
  assert.strictEqual(h.variables.find(v => v.name === composed.name).valuesByMode.d.opacity, Math.fround(12.1));

  h = harness({ failWrite: true, failRollback: true });
  const duplicate = h.make("timing-duplicate", h.timing.name, "TIMING", { d: Math.fround(0.2), r: 0 });
  h.variables.push(duplicate);
  result = await h.apply({ operations: [update(0.3), { ...update(0.4), variableId: duplicate.id }, create()] });
  assert.strictEqual(result.batchStatus, "rollback_failed");
  assert.strictEqual(result.results[0].status, "failed");
  assert.strictEqual(result.results[1].status, "rolledBack", "same-named variables must have independent rollback results");
  assert.strictEqual(result.results[1].rollback, "restored");
  assert.ok(result.rollbackErrors.every(error => error.index === 0 && error.variableId === "timing"));
  assert.strictEqual(duplicate.valuesByMode.d, Math.fround(0.2));

  h = harness({ failMode: true });
  result = await h.apply({ operations: [{ kind: 'create_collection', name: 'Motion Limited', modes: ['Default', 'Reduced Motion'] }] });
  assert.strictEqual(result.applied.length, 0);
  assert.strictEqual(result.unresolved.length, 1);
  assert.ok(result.unresolved[0].reason.includes('only one mode'));
  assert.strictEqual(h.collections.filter(c => !c.removed).length, 1, 'a failed second-mode creation must remove the new collection shell');
})();
