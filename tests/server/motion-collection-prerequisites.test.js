const assert = require("assert");
const { planDsFigmaOperationsFromFigmaData: plan } = require("../../packages/figlets-mcp-server/src/tools/figma-operations.js");

const snapshot = {
  capabilities: { variableResolvedTypes: ["TIMING", "EASING"] },
  collections: ["Primitives", "Color", "Typography", "Spacing", "Elevation"].map((name, index) => ({
    id: `collection-${index}`, name: `${index + 1}. ${name}`, modes: [{ name: "Default", modeId: `mode-${index}` }], variableIds: [],
  })),
  variables: [],
};
const operations = [
  { kind: "create_variable", name: "motion/duration/standard", type: "TIMING", values: { Default: { milliseconds: 200 }, "Reduced Motion": { milliseconds: 0 } } },
  { kind: "create_variable", name: "motion/easing/standard", type: "EASING", values: { Default: { type: "EASE_IN_AND_OUT" }, "Reduced Motion": { type: "LINEAR" } } },
];

const first = plan(snapshot, { operations });
assert.strictEqual(first.phase, "create_missing_motion_collections");
assert.strictEqual(first.repairPlan.counts.blocked, 0);
assert.deepStrictEqual(first.repairPlan.applyInput.operations, [{ kind: "create_collection", name: "6. Motion", modes: ["Default", "Reduced Motion"] }]);
assert.strictEqual(first.continuation.input.operations.length, 2);
assert.ok(first.continuation.input.operations.every(operation => operation.collection === "6. Motion"));
assert.ok(!JSON.stringify(first).includes("pending-mode-"), "validation IDs must never enter approval payloads");
assert.ok(first.repairPlan.agentInstruction.includes("Do not call the missing collection an error"));

const created = { id: "real-motion", name: "6. Motion", modes: [{ name: "Default", modeId: "real-default" }, { name: "Reduced Motion", modeId: "real-reduced" }], variableIds: [] };
const second = plan({ ...snapshot, collections: [...snapshot.collections, created] }, first.continuation.input);
assert.strictEqual(second.repairPlan.counts.ready, 2);
assert.strictEqual(second.repairPlan.counts.blocked, 0);
assert.ok(second.repairPlan.applyInput.operations.every(operation => operation.collectionId === created.id));
assert.strictEqual(second.repairPlan.applyInput.operations[0].modeValues[0].value, 0.2);
assert.strictEqual(second.repairPlan.applyInput.operations[0].modeValues[0].modeId, "real-default");
assert.ok(!second.repairPlan.applyInput.operations.some(operation => operation.kind === "create_collection"));

const existingDefault = plan({ ...snapshot, collections: [...snapshot.collections, created] }, { operations });
assert.strictEqual(existingDefault.repairPlan.counts.ready, 2);
assert.ok(existingDefault.repairPlan.applyInput.operations.every(operation => operation.collection === "6. Motion"));

const plain = plan({ ...snapshot, collections: [] }, { operations });
assert.strictEqual(plain.repairPlan.applyInput.operations[0].name, "Motion");
const custom = plan(snapshot, { operations: operations.map(operation => ({ ...operation, collection: "Transitions" })) });
assert.strictEqual(custom.repairPlan.applyInput.operations[0].name, "Transitions");

const invalid = plan(snapshot, { operations: [{ ...operations[0], values: { Default: { milliseconds: -1 } } }] });
assert.strictEqual(invalid.repairPlan.counts.ready, 0, "invalid variable input must not produce a foundation write");
const unsupported = plan({ ...snapshot, capabilities: {} }, { operations });
assert.strictEqual(unsupported.repairPlan.counts.ready, 0);
const otherType = plan(snapshot, { operations: [{ ...operations[0], type: "FLOAT", collection: "Missing", values: { Default: 100 } }] });
assert.strictEqual(otherType.repairPlan.counts.ready, 0, "unrelated missing collections must not be inferred");
assert.ok(!first.repairPlan.applyInput.operations.some(operation => operation.kind === "create_variable"), "collection and variables have separate fresh approval payloads");
