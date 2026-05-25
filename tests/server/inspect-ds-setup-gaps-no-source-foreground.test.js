const assert = require("assert");
const {
  inspectDsSetupGapsFromFigmaData,
  _buildRepairPlan,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

// BNN-34 regression test: missing foreground companions should emit bulk-repair
// payloads even when no source foreground token exists, by deriving accessible
// aliases from the background's primitive ramp.

function colorVar(id, name, valuesByMode = {}) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "color-coll",
    valuesByMode,
  };
}

const figmaData = {
  variables: [
    // Primitive ramps
    colorVar("p-neutral-50", "color/neutral/50", {
      light: { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      dark: { r: 0.98, g: 0.98, b: 0.98, a: 1 },
    }),
    colorVar("p-neutral-100", "color/neutral/100", {
      light: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
      dark: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
    }),
    colorVar("p-neutral-200", "color/neutral/200", {
      light: { r: 0.90, g: 0.90, b: 0.90, a: 1 },
      dark: { r: 0.90, g: 0.90, b: 0.90, a: 1 },
    }),
    colorVar("p-neutral-800", "color/neutral/800", {
      light: { r: 0.20, g: 0.20, b: 0.20, a: 1 },
      dark: { r: 0.20, g: 0.20, b: 0.20, a: 1 },
    }),
    colorVar("p-neutral-900", "color/neutral/900", {
      light: { r: 0.10, g: 0.10, b: 0.10, a: 1 },
      dark: { r: 0.10, g: 0.10, b: 0.10, a: 1 },
    }),
    // Background semantic tokens that alias to primitives, but no foreground companions
    colorVar("v-surface-default", "color/surface/default", {
      light: { type: "VARIABLE_ALIAS", id: "p-neutral-50" },
      dark: { type: "VARIABLE_ALIAS", id: "p-neutral-900" },
    }),
    colorVar("v-surface-overlay", "color/surface/overlay", {
      light: { type: "VARIABLE_ALIAS", id: "p-neutral-100" },
      dark: { type: "VARIABLE_ALIAS", id: "p-neutral-800" },
    }),
    colorVar("v-surface-raised", "color/surface/raised", {
      light: { type: "VARIABLE_ALIAS", id: "p-neutral-100" },
      dark: { type: "VARIABLE_ALIAS", id: "p-neutral-800" },
    }),
    colorVar("v-surface-sunken", "color/surface/sunken", {
      light: { type: "VARIABLE_ALIAS", id: "p-neutral-200" },
      dark: { type: "VARIABLE_ALIAS", id: "p-neutral-900" },
    }),
  ],
  collections: [
    {
      id: "color-coll",
      name: "Color / Semantics",
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
    },
  ],
};

// Config with no configured pairs (simulates the scenario from BNN-34)
const existingDs = {
  color: {
    semantics: {
      pairs: [],
    },
  },
};

module.exports = (() => {
  const result = inspectDsSetupGapsFromFigmaData(figmaData, { existingDs });

  // ── Verify missing-foreground gaps are detected ────────────────────────────
  assert.strictEqual(
    result.summary.semanticGapCount,
    4,
    "Should detect 4 missing foreground companions"
  );

  // ── Verify ALL gaps are marked as "proposed" (not "unresolved") ────────────
  assert.strictEqual(
    result.summary.proposedCount,
    4,
    "All 4 gaps should be proposed (no dead-end unresolved gaps)"
  );
  assert.strictEqual(
    result.summary.unresolvedCount,
    0,
    "No gaps should be unresolved when deterministic aliases can be derived"
  );

  // ── Verify each gap has planned aliases from background-ramp derivation ────
  const byBg = Object.fromEntries(result.semanticGaps.map((gap) => [gap.bg, gap]));

  const defaultGap = byBg["color/surface/default"];
  assert.ok(defaultGap, "color/surface/default gap should exist");
  assert.strictEqual(
    defaultGap.status,
    "proposed",
    "Gap status should be 'proposed'"
  );
  assert.strictEqual(
    defaultGap.source,
    "background-ramp",
    "Source should be 'background-ramp' when derived from bg"
  );
  assert.ok(
    defaultGap.plannedAliases,
    "Gap should have plannedAliases"
  );
  assert.ok(
    defaultGap.plannedAliases.Light,
    "plannedAliases should have Light mode"
  );
  assert.ok(
    defaultGap.plannedAliases.Dark,
    "plannedAliases should have Dark mode"
  );
  assert.ok(
    /^color\/neutral\/\d+$/.test(defaultGap.plannedAliases.Light),
    "Light mode alias should be a primitive on the neutral ramp"
  );
  assert.ok(
    /^color\/neutral\/\d+$/.test(defaultGap.plannedAliases.Dark),
    "Dark mode alias should be a primitive on the neutral ramp"
  );

  // ── Verify plannedContrast shows accessible aliases were selected ──────────
  assert.ok(
    defaultGap.plannedContrast,
    "Gap should have plannedContrast metadata"
  );
  assert.ok(
    defaultGap.plannedContrast.Light,
    "plannedContrast should have Light mode"
  );
  assert.ok(
    defaultGap.plannedContrast.Light.pass,
    "Light mode contrast should pass"
  );
  const lightThreshold = defaultGap.plannedContrast.Light.threshold;
  const lightScore =
    defaultGap.plannedContrast.Light.wcagRatio ||
    defaultGap.plannedContrast.Light.apcaLc;
  assert.ok(
    lightScore >= lightThreshold,
    `Light mode score (${lightScore}) should meet threshold (${lightThreshold})`
  );

  // ── Verify repair plan includes these gaps ─────────────────────────────────
  const repairPlan = _buildRepairPlan(result);
  assert.strictEqual(
    repairPlan.counts.repairs,
    4,
    "repairPlan should include all 4 background-ramp-derived repairs"
  );
  assert.strictEqual(
    repairPlan.counts.total,
    4,
    "repairPlan total should be 4"
  );
  assert.ok(
    repairPlan.applyInput.repairs.length === 4,
    "applyInput.repairs should contain 4 items"
  );

  // ── Verify each repair in applyInput has the required fields ───────────────
  for (const repair of repairPlan.applyInput.repairs) {
    assert.ok(repair.bg, "Repair should have bg field");
    assert.ok(repair.name, "Repair should have name field");
    assert.strictEqual(
      repair.source,
      "background-ramp",
      "Repair source should be 'background-ramp'"
    );
    assert.ok(repair.aliases, "Repair should have aliases field");
    assert.ok(repair.aliases.Light, "Repair should have Light alias");
    assert.ok(repair.aliases.Dark, "Repair should have Dark alias");
  }

  // ── Verify agent instruction does NOT say "no repair payload" ──────────────
  assert.ok(
    !repairPlan.agentInstruction.includes("invent repairs"),
    "Agent instruction should not tell agents to invent repairs when payload exists"
  );
  assert.ok(
    repairPlan.agentInstruction.includes("apply_ds_setup_repairs"),
    "Agent instruction should mention apply_ds_setup_repairs tool"
  );

  console.log("BNN-34 regression test passed: missing foreground companions with no source now emit bulk-repair payloads");
})();
