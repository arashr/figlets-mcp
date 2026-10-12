const assert = require("assert");
const { planPrimitiveOpacityRepairs } = require("../../packages/figlets-mcp-server/src/tools/primitive-opacity-repair.js");

function variable(id, name, type, value, scopes) {
  return {
    id,
    name,
    resolvedType: type,
    variableCollectionId: "prim",
    valuesByMode: { default: value },
    scopes: scopes || [],
  };
}

function snapshot(scrimOverride) {
  const variables = [
    variable("white", "color/neutral/0", "COLOR", { r: 1, g: 1, b: 1 }),
    variable("black", "color/neutral/100", "COLOR", { r: 0, g: 0, b: 0 }),
  ];
  const specs = [
    ["black", 4], ["black", 8], ["black", 12], ["black", 20], ["black", 40], ["black", 60],
    ["white", 8], ["white", 12], ["white", 16], ["white", 20],
  ];
  for (const [channel, percentage] of specs) {
    const color = channel === "white" ? 1 : 0;
    const name = `color/scrim/${channel}/${percentage}`;
    const value = scrimOverride && scrimOverride.name === name
      ? scrimOverride.value
      : { r: color, g: color, b: color, a: percentage / 100 };
    variables.push(variable(`scrim-${channel}-${percentage}`, name, "COLOR", value));
  }
  return {
    capabilities: {
      composedColorVariables: true,
      exactVariableWriteSupport: true,
    },
    collections: [{ id: "prim", name: "1. Primitives", modes: [{ modeId: "default", name: "Default" }] }],
    variables,
  };
}

module.exports = (() => {
  const ds = { collections: { primitives: "1. Primitives" } };
  const plan = planPrimitiveOpacityRepairs(ds, snapshot());
  assert.strictEqual(plan.blocked.length, 0);
  assert.strictEqual(plan.entries.length, 10);
  const black40 = plan.entries.find(entry => entry.scrim.name === "color/scrim/black/40");
  assert.strictEqual(black40.scrim.id, "scrim-black-40", "migration should preserve the scrim ID");
  assert.deepStrictEqual(black40.scrim.colorSource, { kind: "alias", id: "black", name: "color/neutral/100" });
  assert.strictEqual(black40.opacity.name, "opacity/40");
  assert.deepStrictEqual(black40.opacity.scopes, ["OPACITY", "COLOR_OPACITY"]);
  assert.deepStrictEqual(black40.scrim.resolvedRgba, { r: 0, g: 0, b: 0, a: 0.4 });

  const incompatible = planPrimitiveOpacityRepairs(ds, snapshot({
    name: "color/scrim/black/40",
    value: { r: 0, g: 0, b: 0, a: 0.5 },
  }));
  assert.strictEqual(incompatible.entries.length, 9);
  assert.ok(incompatible.blocked.some(item => item.name === "color/scrim/black/40" && item.reason.includes("does not match")));

  const fallbackData = snapshot();
  fallbackData.variables = fallbackData.variables.filter(item => item.id !== "white" && item.id !== "black");
  const fallback = planPrimitiveOpacityRepairs(ds, fallbackData);
  assert.deepStrictEqual(
    fallback.entries.find(entry => entry.scrim.name === "color/scrim/white/16").scrim.colorSource,
    { kind: "raw", value: { r: 1, g: 1, b: 1 } }
  );

  const outdated = snapshot();
  outdated.capabilities = {};
  const blocked = planPrimitiveOpacityRepairs(ds, outdated);
  assert.strictEqual(blocked.entries.length, 0);
  assert.ok(blocked.blocked[0].reason.includes("Reload"));
})();
