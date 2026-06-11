/**
 * Coverage for the QA gap kinds added on top of the original
 * missing-foreground inspector: missing-bg, broken-alias, incomplete-modes,
 * contrast failures, and companion advisories. Uses literal RGB primitives so
 * contrast can be evaluated without a config.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  inspectDsSetupGapsFromFigmaData,
  handleInspectDsSetupGaps,
  _buildRepairPlan,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

function prim(id, name, r, g, b) {
  return {
    id, name, resolvedType: "COLOR", variableCollectionId: "primColl",
    valuesByMode: { primMode: { r, g, b } },
  };
}
function sem(id, name, lightVal, darkVal) {
  const valuesByMode = {};
  if (lightVal !== undefined) valuesByMode.lightId = lightVal;
  if (darkVal !== undefined) valuesByMode.darkId = darkVal;
  return { id, name, resolvedType: "COLOR", variableCollectionId: "semColl", valuesByMode };
}
function alias(id) { return { type: "VARIABLE_ALIAS", id }; }

// ── Snapshot ────────────────────────────────────────────────────────────────
// Primitives:
const primitives = [
  prim("n0",   "color/neutral/0",    1.00, 1.00, 1.00),
  prim("n50",  "color/neutral/50",   0.98, 0.98, 0.98),
  prim("n300", "color/neutral/300",  0.78, 0.78, 0.78),  // failing fg on light bg
  prim("n950", "color/neutral/950",  0.05, 0.05, 0.05),
  prim("r700", "color/red/700",      0.55, 0.10, 0.10),
];

// Semantic tokens:
const semantics = [
  // Pair where fg fails contrast in Light: bg=neutral/50 (very light) vs fg=neutral/300 (also light).
  sem("contrastBg", "color/surface/danger", alias("n50"), alias("n950")),
  sem("contrastFg", "color/on-surface/danger", alias("n300"), alias("n0")),
  // Icon companion also fails legal non-text contrast on the paired surface in both modes.
  sem("contrastIcon", "color/icon/danger", alias("n50"), alias("n950")),

  // Orphan fg: on-surface/info exists but no surface/info.
  sem("orphanFg", "color/on-surface/info", alias("n950"), alias("n50")),

  // Broken alias: dark mode points to a variable id that is not in the snapshot.
  sem("brokenSem", "color/surface/warning", alias("n50"), alias("ghost-id")),

  // Incomplete modes: Light has a value, Dark is undefined.
  sem("modeMiss", "color/surface/success", alias("n50"), undefined),

  // Complete pair with no border/icon: triggers companion advisory.
  sem("brandBg", "color/surface/brand-variant", alias("r700"), alias("n950")),
  sem("brandFg", "color/on-surface/brand-variant", alias("n0"), alias("r700")),
];

const figmaData = {
  variables: primitives.concat(semantics),
  collections: [
    { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
    { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: semantics.map(v => v.id) },
  ],
};

module.exports = (() => {
  {
    const emptyResult = inspectDsSetupGapsFromFigmaData({ variables: [], collections: [] });
    const emptyPlan = _buildRepairPlan(emptyResult);
    assert.deepStrictEqual(
      Object.keys(emptyPlan).slice(0, 6),
      ["tool", "approvalRequired", "applyInput", "optionalApplyInput", "counts", "designerSummary"],
      "repairPlan should keep apply-ready fields before explanatory text"
    );
    assert.deepStrictEqual(emptyPlan.applyInput, { repairs: [], aliasUpdates: [], roleRepairs: [] });
    assert.deepStrictEqual(emptyPlan.optionalApplyInput, { repairs: [], aliasUpdates: [], roleRepairs: [] });
    assert.deepStrictEqual(emptyPlan.counts, {
      repairs: 0,
      aliasUpdates: 0,
      roleRepairs: 0,
      optionalRoleRepairs: 0,
      total: 0,
      optionalTotal: 0,
    });
    assert.deepStrictEqual(emptyPlan.missingCapabilityNotes, []);
    assert.ok(
      emptyPlan.agentInstruction.includes("Do not invent repairs"),
      "empty repair plans should explicitly tell agents not to invent repairs"
    );
    assert.ok(
      emptyPlan.designerPresentation.sayToDesigner[0].includes("semantic color setup looks clean"),
      "empty repair plans should still include a designer-facing presentation"
    );
  }

  const result = inspectDsSetupGapsFromFigmaData(figmaData);

  // ── Contrast failure: surface/danger Light pair fails WCAG ──
  const failures = result.contrastFailures.filter(f => f.bg === "color/surface/danger");
  assert.strictEqual(failures.length, 1, "exactly one mode should fail contrast for surface/danger");
  assert.strictEqual(failures[0].mode, "Light");
  assert.strictEqual(failures[0].algorithm, "wcag");
  assert.ok(failures[0].score < failures[0].threshold, "score should be below threshold for a failure");
  assert.strictEqual(failures[0].threshold, 4.5);
  // Resolved primitives must be captured for debugging
  assert.strictEqual(failures[0].bgPrimitive.name, "color/neutral/50");
  assert.strictEqual(failures[0].fgPrimitive.name, "color/neutral/300");
  assert.ok(failures[0].bgPrimitive.rgb && "r" in failures[0].bgPrimitive.rgb);
  // Near-miss flag is computed
  assert.strictEqual(typeof failures[0].nearMiss, "boolean");
  assert.strictEqual(typeof failures[0].gap, "number");

  // ── Icon contrast: always WCAG non-text 3:1, regardless of selected text algorithm ──
  const iconFailures = result.iconContrastFailures.filter(f => f.bg === "color/surface/danger");
  assert.strictEqual(iconFailures.length, 2, "icon/danger should fail on both Light and Dark paired surfaces");
  assert.ok(iconFailures.every(f => f.algorithm === "wcag-non-text"));
  assert.ok(iconFailures.every(f => f.threshold === 3));
  const lightIconFailure = iconFailures.find(f => f.mode === "Light");
  assert.ok(lightIconFailure.plannedReAlias, "icon contrast failures should carry a deterministic re-alias suggestion when one exists");
  assert.strictEqual(lightIconFailure.plannedReAlias.token, "color/icon/danger");
  assert.strictEqual(lightIconFailure.plannedReAlias.mode, "Light");
  assert.strictEqual(lightIconFailure.plannedReAlias.from, "color/neutral/50");
  assert.strictEqual(lightIconFailure.plannedReAlias.to, "color/neutral/950");
  assert.strictEqual(lightIconFailure.plannedReAlias.threshold, 3);
  assert.strictEqual(result.summary.iconContrastFailureCount, iconFailures.length);
  assert.ok(
    result.topFindings.highConfidenceIssues.some(item => item.kind === "icon-contrast-failure"),
    "topFindings.highConfidenceIssues should lead with high-confidence findings across types"
  );

  // ── Broken alias: warning Dark points at ghost-id ──
  assert.strictEqual(result.brokenAliases.length, 1);
  assert.strictEqual(result.brokenAliases[0].holder, "color/surface/warning");
  assert.strictEqual(result.brokenAliases[0].mode, "Dark");
  assert.strictEqual(result.brokenAliases[0].missingTargetId, "ghost-id");

  // ── Incomplete modes: success has Light only ──
  const incomplete = result.incompleteModes.find(m => m.token === "color/surface/success");
  assert.ok(incomplete, "success token should be flagged as incomplete-modes");
  assert.deepStrictEqual(incomplete.missingModes, ["Dark"]);

  // ── Missing-bg for orphanFg ──
  const orphan = result.missingBackgrounds.find(m => m.fg === "color/on-surface/info");
  assert.ok(orphan, "on-surface/info should be reported as missing its surface");
  assert.strictEqual(orphan.expectedBg, "color/surface/info");
  assert.strictEqual(orphan.agentAction, "ask-designer");
  assert.ok(
    orphan.reason.includes("does not infer background aliases"),
    "missing background findings should tell agents not to infer aliases from foreground usage"
  );
  const planWithMissingBg = _buildRepairPlan(result);
  assert.ok(
    planWithMissingBg.missingCapabilityNotes.some(note =>
      note.kind === "missing-background" &&
      note.token === "color/on-surface/info" &&
      note.expectedBg === "color/surface/info"
    ),
    "repair plan should expose missing background limitations near the apply payload"
  );
  assert.ok(
    planWithMissingBg.agentInstruction.includes("Do not infer or create missing backgrounds"),
    "repair plan should explicitly prevent ad hoc background creation"
  );
  assert.ok(
    planWithMissingBg.designerPresentation.sayToDesigner.some(line =>
      line.includes("background role") && line.includes("design decision")
    ),
    "repair plan should include a human-readable missing-background summary"
  );
  assert.ok(
    planWithMissingBg.designerPresentation.avoid.some(line => line.includes("verification checklist")),
    "designer presentation should steer agents away from technical verification tables"
  );

  // ── Companion advisory + icon bulk gap for brand-variant pair ──
  const advisory = result.companionAdvisories.find(a => a.bg === "color/surface/brand-variant");
  assert.ok(advisory, "complete brand-variant pair without border should advise");
  const roles = advisory.missing.map(m => m.role).sort();
  assert.deepStrictEqual(roles, ["border"]);
  assert.ok(
    result.missingSemanticRoles.some(gap => gap.family === "brand-variant" && gap.missingRole === "icon"),
    "missing icon roles should be promoted to semantic role gaps instead of staying as advisories"
  );

  // ── Summary aggregates ──
  // contrastFailureCount counts failures across ALL pairs, not just surface/danger.
  assert.ok(result.summary.contrastFailureCount >= failures.length);
  assert.strictEqual(result.summary.brokenAliasCount, 1);
  assert.strictEqual(result.summary.incompleteModeCount, 1);
  assert.ok(result.summary.missingBackgroundCount >= 1);
  assert.ok(result.summary.companionAdvisoryCount >= 1);
  assert.strictEqual(result.contrastAlgorithm, "wcag");

  // ── APCA option propagates and uses the APCA threshold ──
  const apcaResult = inspectDsSetupGapsFromFigmaData(figmaData, { algorithm: "apca" });
  assert.strictEqual(apcaResult.contrastAlgorithm, "apca");
  for (const f of apcaResult.contrastFailures) {
    assert.strictEqual(f.algorithm, "apca");
    assert.strictEqual(f.threshold, 75);
  }
  assert.ok(apcaResult.iconContrastFailures.every(f => f.algorithm === "wcag-non-text"));

  // ── Advisory suppression vs bulk icon repair: when ≥3 complete pairs are
  // all missing passive borders, the inspector suppresses that as DS-wide
  // absence. Missing icons are different: they can be planned as structured
  // bulk repairs from the paired foreground aliases.
  const pairs = [];
  for (const role of ["alpha", "beta", "gamma", "delta"]) {
    pairs.push({ id: `bg-${role}`, name: `color/surface/${role}`, resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n50" }, darkId: { type: "VARIABLE_ALIAS", id: "n950" } } });
    pairs.push({ id: `fg-${role}`, name: `color/on-surface/${role}`, resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n950" }, darkId: { type: "VARIABLE_ALIAS", id: "n50" } } });
  }
  const universalSnapshot = {
    variables: primitives.concat(pairs),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: pairs.map(v => v.id) },
    ],
  };
  const universal = inspectDsSetupGapsFromFigmaData(universalSnapshot);
  assert.strictEqual(universal.counts.completePairs, 4, "fixture should produce 4 complete pairs");
  const suppressedRoles = universal.suppressedAdvisoryRoles.map(s => s.role).sort();
  assert.deepStrictEqual(suppressedRoles, ["border"], "DS-wide absence should still suppress passive border advisories");
  assert.strictEqual(universal.companionAdvisories.length, 0, "planned icon role gaps and suppressed borders should not leave duplicate advisories");
  const universalIconGaps = universal.missingSemanticRoles.filter(gap => gap.missingRole === "icon");
  assert.strictEqual(universalIconGaps.length, 4, "universal missing icons should become bulk-repairable role gaps");
  assert.ok(
    universalIconGaps.every(gap => gap.confidence === "high" && gap.plannedRoleRepair && gap.plannedRoleRepair.role === "icon"),
    "bulk icon gaps should carry high-confidence planned role repairs"
  );
  assert.deepStrictEqual(
    _buildRepairPlan(universal).applyInput.roleRepairs.map(repair => repair.name).sort(),
    ["color/icon/alpha", "color/icon/beta", "color/icon/delta", "color/icon/gamma"],
    "repairPlan should expose all missing icon creations for direct approved apply"
  );
  const universalPlan = _buildRepairPlan(universal);
  assert.deepStrictEqual(
    universalPlan.applyInput.roleRepairs.filter(repair => repair.role === "border"),
    [],
    "suppressed DS-wide passive borders should not enter the default health-check repair payload"
  );
  assert.deepStrictEqual(
    universalPlan.optionalApplyInput.roleRepairs.map(repair => repair.name).sort(),
    ["color/border/alpha", "color/border/beta", "color/border/delta", "color/border/gamma"],
    "suppressed DS-wide passive borders should still expose an optional bulk apply payload"
  );
  assert.deepStrictEqual(
    universalPlan.optionalApplyInput.roleRepairs.find(repair => repair.name === "color/border/alpha"),
    {
      name: "color/border/alpha",
      role: "border",
      aliases: { Light: "color/neutral/300", Dark: "color/neutral/950" },
    },
    "optional passive border repairs should use standard passive ramp steps/nearest available steps"
  );
  assert.strictEqual(
    universal.optionalSemanticRoleFindings[0].plannedRoleRepair.contrast,
    undefined,
    "optional passive border repairs should not carry contrast metadata"
  );
  assert.ok(
    universalPlan.agentInstruction.includes("separate designer approval") ||
      universalPlan.agentInstruction.includes("explicit approval"),
    "agents must be instructed to ask before applying optional convention-level repairs"
  );
  assert.ok(
    universalPlan.designerPresentation.sayToDesigner.some(line => line.includes("optional convention-level role")),
    "optional convention repairs should have a plain-language designer summary"
  );
  assert.strictEqual(
    universalPlan.designerPresentation.proposedChanges.readyToApply.length,
    universalPlan.counts.total,
    "ready-to-apply proposedChanges should match repair count"
  );
  assert.strictEqual(
    universalPlan.designerPresentation.proposedChanges.optional.length,
    universalPlan.counts.optionalTotal,
    "optional proposedChanges should match optional repair count"
  );
  assert.ok(
    universalPlan.designerPresentation.proposedChanges.readyToApply.every(change =>
      change.token && change.action && change.summaryLine
    ),
    "each ready repair should expose token, action, and summary line"
  );

  // ── plannedReAlias: contrast failures should carry the picker's upgrade ──
  // The handler-level path is the one that attaches plannedReAlias, since the
  // picker requires the snapshot. Use a temp dir + FIGLETS_LOCAL_DIR isolation
  // mirroring the planned-aliases test.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-realias-"));
    const snapPath = path.join(tmp, "figma-data.json");
    fs.writeFileSync(snapPath, JSON.stringify(figmaData), "utf8");
    const prevLocal = process.env.FIGLETS_LOCAL_DIR;
    const prevFig = process.env.FIGLETS_FIGMA_DATA_PATH;
    process.env.FIGLETS_LOCAL_DIR = tmp;
    process.env.FIGLETS_FIGMA_DATA_PATH = snapPath;
    try {
      const handlerResult = handleInspectDsSetupGaps({ figmaDataPath: snapPath });
      assert.ok(!handlerResult.error, "handler should succeed");
      const dangerLight = handlerResult.contrastFailures.find(
        f => f.bg === "color/surface/danger" && f.mode === "Light"
      );
      assert.ok(dangerLight, "danger Light should be a contrast failure");
      assert.ok(dangerLight.plannedReAlias, "failing pair must carry a re-alias suggestion");
      assert.strictEqual(dangerLight.plannedReAlias.token, "color/on-surface/danger");
      assert.strictEqual(dangerLight.plannedReAlias.mode, "Light");
      assert.strictEqual(dangerLight.plannedReAlias.from, "color/neutral/300");
      // The picker walks the same ramp; with only n950 left as a darker step,
      // that's the upgrade target.
      assert.strictEqual(dangerLight.plannedReAlias.to, "color/neutral/950");
      assert.strictEqual(dangerLight.plannedReAlias.expectedCurrentAlias, "color/neutral/300");
      assert.strictEqual(dangerLight.plannedReAlias.newAliasTarget, "color/neutral/950");
      assert.ok(handlerResult.repairPlan, "handler should expose an agent-ready repair plan");
      assert.ok(handlerResult.semanticColorGrammar, "handler result should expose semantic color grammar to agents");
      assert.ok(
        Object.prototype.hasOwnProperty.call(handlerResult, "semanticNamingAdvisories"),
        "handler result should expose low-priority semantic naming advisories"
      );
      const topKeys = Object.keys(handlerResult).slice(0, 4);
      assert.deepStrictEqual(
        topKeys,
        ["message", "summary", "repairPlan", "topFindings"],
        "agent-actionable keys must appear before long diagnostic arrays"
      );
      assert.strictEqual(handlerResult.repairPlan.tool, "apply_ds_setup_repairs");
      assert.strictEqual(handlerResult.repairPlan.approvalRequired, true);
      assert.ok(
        Object.prototype.hasOwnProperty.call(handlerResult.repairPlan, "optionalApplyInput"),
        "repair plan should always expose the optional apply channel"
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(handlerResult.repairPlan, "missingCapabilityNotes"),
        "repair plan should always expose missing capability notes"
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(handlerResult.repairPlan, "designerPresentation"),
        "repair plan should expose a human-readable designer presentation"
      );
      assert.ok(
        handlerResult.repairPlan.agentInstruction.includes("do not parse local tool-results files"),
        "repair plan should explicitly forbid local tool-result scraping"
      );
      assert.ok(
        handlerResult.repairPlan.applyInput.aliasUpdates.some(update =>
          update.token === "color/on-surface/danger"
          && update.mode === "Light"
          && update.newAliasTarget === "color/neutral/950"
        ),
        "repair plan should collect contrast plannedReAlias updates for direct apply"
      );
    } finally {
      if (prevLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocal;
      else delete process.env.FIGLETS_LOCAL_DIR;
      if (prevFig !== undefined) process.env.FIGLETS_FIGMA_DATA_PATH = prevFig;
      else delete process.env.FIGLETS_FIGMA_DATA_PATH;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ── plannedReAlias guard: shared tokens must not receive oscillating fixes ──
  // A local repair that fixes one pair but breaks another pair using the same
  // semantic token is not a safe one-click repair. It should remain visible as
  // a designer/tooling decision and stay out of repairPlan.applyInput.aliasUpdates.
  {
    const sharedVars = [
      sem("shared-bg-light", "color/bg/shared-light", alias("n50"), undefined),
      sem("shared-bg-dark", "color/bg/shared-dark", alias("n950"), undefined),
      sem("shared-text-brand", "color/text/brand", alias("n300"), undefined),
    ];
    const sharedSnapshot = {
      variables: primitives.concat(sharedVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }], variableIds: sharedVars.map(v => v.id) },
      ],
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-shared-realias-"));
    const snapPath = path.join(tmp, "figma-data.json");
    const configPath = path.join(tmp, "design-system.config.js");
    fs.writeFileSync(snapPath, JSON.stringify(sharedSnapshot), "utf8");
    fs.writeFileSync(configPath, "const DS = " + JSON.stringify({
      collections: { color: "Color" },
      color: {
        contrastAlgorithm: "wcag",
        semantics: {
          pairs: [
            { bg: "color/bg/shared-light", text: "color/text/brand" },
            { bg: "color/bg/shared-dark", text: "color/text/brand" },
          ],
        },
      },
    }, null, 2) + ";\n", "utf8");

    try {
      const sharedResult = handleInspectDsSetupGaps({ figmaDataPath: snapPath, config_path: configPath });
      assert.ok(!sharedResult.error, sharedResult.error);
      const lightFailure = sharedResult.contrastFailures.find(item =>
        item.bg === "color/bg/shared-light" &&
        item.fg === "color/text/brand" &&
        item.mode === "Light"
      );
      assert.ok(lightFailure, "shared light background should fail with the current shared foreground");
      assert.strictEqual(
        lightFailure.plannedReAlias,
        null,
        "shared token candidate that breaks another pairing should not be offered as ready to apply"
      );
      assert.ok(
        lightFailure.plannedReAliasBlocked &&
          lightFailure.plannedReAliasBlocked.blockingContexts.some(context => context.bg === "color/bg/shared-dark"),
        "blocked re-alias should explain the other pairing that would fail"
      );
      assert.ok(
        !sharedResult.repairPlan.applyInput.aliasUpdates.some(update =>
          update.token === "color/text/brand" &&
          update.mode === "Light"
        ),
        "unsafe shared-token re-alias should stay out of the approved apply payload"
      );
      assert.ok(
        sharedResult.repairPlan.missingCapabilityNotes.some(note =>
          note.kind === "shared-token-contrast-repair-blocked" &&
          note.token === "color/text/brand" &&
          note.blockingContexts.some(context => context.bg === "color/bg/shared-dark")
        ),
        "repair plan should surface the blocked shared-token repair as a designer/tooling decision"
      );
      assert.ok(
        sharedResult.repairPlan.designerPresentation.proposedChanges.needsDesignerDecision.some(change =>
          change.reason === "shared token contrast" &&
          change.summaryLine.includes("no one-click contrast re-alias")
        ),
        "designer presentation should explain why the contrast repair is not one-click safe"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ── Threshold guard: with only 2 complete pairs, suppression must NOT fire
  const tinyPairs = [
    { id: "bg-x", name: "color/surface/x", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n50" } } },
    { id: "fg-x", name: "color/on-surface/x", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n950" } } },
    { id: "bg-y", name: "color/surface/y", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n50" } } },
    { id: "fg-y", name: "color/on-surface/y", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n950" } } },
  ];
  const tinySnap = {
    variables: primitives.concat(tinyPairs),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }], variableIds: tinyPairs.map(v => v.id) },
    ],
  };
  const tiny = inspectDsSetupGapsFromFigmaData(tinySnap);
  assert.strictEqual(tiny.counts.completePairs, 2);
  assert.strictEqual(tiny.suppressedAdvisoryRoles.length, 0, "below threshold (3 pairs) suppression should not trigger");
  assert.ok(tiny.companionAdvisories.length >= 2, "small files should still see per-pair advisories");

  // ── Semantic-family completeness: inherited DS QA should catch a family
  // that lost one text role and one icon role without relying on a saved
  // config contract. This is still read-only: findings carry agentAction and
  // confidence so the next step is designer confirmation, not mutation.
  const familyVars = [
    sem("bg-success", "color/bg/success", alias("n50"), alias("n950")),
    sem("text-success", "color/text/success", alias("n950"), alias("n50")),
    sem("border-success", "color/border/success", alias("r700"), alias("r700")),
    // color/icon/success intentionally missing

    sem("bg-warning", "color/bg/warning", alias("n50"), alias("n950")),
    sem("icon-warning", "color/icon/warning", alias("r700"), alias("r700")),
    sem("border-warning", "color/border/warning", alias("r700"), alias("r700")),
    // color/text/warning intentionally missing

    sem("bg-info", "color/bg/info", alias("n50"), alias("n950")),
    sem("text-info", "color/text/info", alias("n950"), alias("n50")),
    sem("icon-info", "color/icon/info", alias("r700"), alias("r700")),

    sem("bg-danger", "color/bg/danger", alias("n50"), alias("n950")),
    sem("text-danger", "color/text/danger", alias("n950"), alias("n50")),
    sem("icon-danger", "color/icon/danger", alias("r700"), alias("r700")),
  ];
  const familySnap = {
    variables: primitives.concat(familyVars),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: familyVars.map(v => v.id) },
    ],
  };
  const familyResult = inspectDsSetupGapsFromFigmaData(familySnap);
  const missingFocus = familyResult.foundationRoleFindings.find(
    gap => gap.role === "focus-border"
  );
  assert.ok(missingFocus, "files with border semantics but no focus border should flag the foundational focus role");
  assert.strictEqual(missingFocus.confidence, "high");
  assert.strictEqual(missingFocus.agentAction, "ask-designer");
  assert.ok(missingFocus.suggestedNames.includes("color/border/focus"));
  assert.strictEqual(familyResult.summary.foundationRoleFindingCount, 1);

  const missingSuccessIcon = familyResult.missingSemanticRoles.find(
    gap => gap.family === "success" && gap.missingRole === "icon"
  );
  assert.ok(missingSuccessIcon, "success family should report the deleted icon role");
  assert.strictEqual(missingSuccessIcon.confidence, "high");
  assert.strictEqual(missingSuccessIcon.agentAction, "ask-designer");
  assert.strictEqual(missingSuccessIcon.suggestedName, "color/icon/success");
  assert.ok(missingSuccessIcon.evidence.includes("color/bg/success"));
  assert.ok(missingSuccessIcon.evidence.includes("color/text/success"));
  assert.ok(missingSuccessIcon.evidence.includes("color/border/success"));
  assert.ok(
    missingSuccessIcon.plannedRoleRepair,
    "Figlets-created missing icon suggestions should include an accessibility-checked repair plan"
  );
  assert.strictEqual(missingSuccessIcon.plannedRoleRepair.role, "icon");
  assert.ok(missingSuccessIcon.plannedRoleRepair.reason.includes("pre-checked against WCAG non-text contrast"));
  assert.ok(missingSuccessIcon.plannedRoleRepair.contrast.Light.pass);
  assert.ok(missingSuccessIcon.plannedRoleRepair.contrast.Light.wcagRatio >= 3);
  assert.ok(missingSuccessIcon.plannedRoleRepair.contrast.Dark.pass);
  assert.ok(missingSuccessIcon.plannedRoleRepair.contrast.Dark.wcagRatio >= 3);

  const missingWarningText = familyResult.missingSemanticRoles.find(
    gap => gap.family === "warning" && gap.missingRole === "foreground"
  );
  assert.ok(missingWarningText, "warning family should report the deleted text role");
  assert.strictEqual(missingWarningText.confidence, "high");
  assert.strictEqual(missingWarningText.agentAction, "ask-designer");
  assert.strictEqual(missingWarningText.suggestedName, "color/text/warning");
  assert.strictEqual(
    familyResult.summary.missingSemanticRoleCount,
    familyResult.missingSemanticRoles.length,
    "summary should count semantic-family role gaps"
  );

  const foregroundOnlyVars = [
    sem("text-accent", "color/text/accent", alias("n950"), alias("n50")),
    sem("icon-accent", "color/icon/accent", alias("r700"), alias("r700")),
    sem("border-accent", "color/border/accent", alias("r700"), alias("r700")),
  ];
  const foregroundOnlySnap = {
    variables: primitives.concat(foregroundOnlyVars),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: foregroundOnlyVars.map(v => v.id) },
    ],
  };
  const foregroundOnlyResult = inspectDsSetupGapsFromFigmaData(foregroundOnlySnap);
  const missingAccentBg = foregroundOnlyResult.missingSemanticRoles.find(
    gap => gap.family === "accent" && gap.missingRole === "background"
  );
  assert.ok(missingAccentBg, "foreground/icon/border-only semantic family should report missing background");
  assert.strictEqual(missingAccentBg.agentAction, "ask-designer");
  assert.strictEqual(missingAccentBg.plannedRoleRepair, undefined);
  const foregroundOnlyPlan = _buildRepairPlan(foregroundOnlyResult);
  assert.strictEqual(
    foregroundOnlyPlan.applyInput.roleRepairs.some(repair => repair.role === "background" || repair.name === "color/bg/accent"),
    false,
    "missing backgrounds should never be lifted into applyInput without an explicit background planner"
  );
  assert.ok(
    foregroundOnlyPlan.missingCapabilityNotes.some(note =>
      note.kind === "missing-background" &&
      note.family === "accent" &&
      note.suggestedName === "color/bg/accent"
    ),
    "repair plan should name missing semantic-family backgrounds as designer/product decisions"
  );

  const roleBasedForegroundOnlyVars = [
    sem("text-on-danger", "color/text/on-danger", alias("n50"), alias("n950")),
    sem("icon-on-danger", "color/icon/on-danger", alias("n50"), alias("n950")),
    sem("border-danger", "color/border/danger", alias("r700"), alias("r700")),
  ];
  const roleBasedForegroundOnlySnap = {
    variables: primitives.concat(roleBasedForegroundOnlyVars),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: roleBasedForegroundOnlyVars.map(v => v.id) },
    ],
  };
  const roleBasedForegroundOnlyResult = inspectDsSetupGapsFromFigmaData(roleBasedForegroundOnlySnap);
  const missingDangerBg = roleBasedForegroundOnlyResult.missingSemanticRoles.find(
    gap => gap.family === "danger" && gap.missingRole === "background"
  );
  assert.ok(missingDangerBg, "role-based on-* foreground family should still report missing background");
  assert.strictEqual(
    missingDangerBg.suggestedName,
    "color/fill/danger",
    "role-based on-* foreground families should resolve to fill/* backgrounds, not bg/on-*"
  );
  const roleBasedForegroundOnlyPlan = _buildRepairPlan(roleBasedForegroundOnlyResult);
  assert.ok(
    roleBasedForegroundOnlyPlan.missingCapabilityNotes.some(note =>
      note.kind === "missing-background" &&
      note.family === "danger" &&
      note.suggestedName === "color/fill/danger"
    ),
    "missing-background notes should preserve role-based fill/* naming for on-* foreground families"
  );
  assert.strictEqual(
    roleBasedForegroundOnlyPlan.missingCapabilityNotes.some(note => /color\/bg\/on-/.test(String(note.suggestedName || ""))),
    false,
    "repair notes should never synthesize color/bg/on-* from role-based on-* foreground leaves"
  );
  {
    const onFillForegroundOnlyVars = [
      sem("text-on-fill-danger", "color/text/on-fill-danger", alias("n50"), alias("n950")),
      sem("icon-on-fill-danger", "color/icon/on-fill-danger", alias("n50"), alias("n950")),
      sem("border-on-fill-danger", "color/border/on-fill-danger", alias("r700"), alias("r700")),
    ];
    const onFillForegroundOnlySnap = {
      variables: primitives.concat(onFillForegroundOnlyVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: onFillForegroundOnlyVars.map(v => v.id) },
      ],
    };
    const onFillForegroundOnlyResult = inspectDsSetupGapsFromFigmaData(onFillForegroundOnlySnap);
    const missingOnFillDangerBg = onFillForegroundOnlyResult.missingSemanticRoles.find(
      gap => gap.family === "danger" && gap.missingRole === "background"
    );
    assert.ok(missingOnFillDangerBg, "on-fill foreground family should report missing fill background under the base family");
    assert.strictEqual(
      missingOnFillDangerBg.suggestedName,
      "color/fill/danger",
      "on-fill foreground leaves should not synthesize color/fill/fill-* background names"
    );
    assert.strictEqual(
      onFillForegroundOnlyResult.missingSemanticRoles.some(gap => /color\/fill\/fill-/.test(String(gap.suggestedName || ""))),
      false,
      "setup-gap QA should never surface duplicate fill/fill-* background suggestions"
    );
  }
  {
    const onFillWithExistingBgVars = [
      sem("fill-danger", "color/fill/danger", alias("r700"), alias("r200")),
      sem("text-on-fill-danger", "color/text/on-fill-danger", alias("n50"), alias("n950")),
      sem("icon-on-fill-danger", "color/icon/on-fill-danger", alias("n50"), alias("n950")),
    ];
    const onFillWithExistingBgSnap = {
      variables: primitives.concat(onFillWithExistingBgVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: onFillWithExistingBgVars.map(v => v.id) },
      ],
    };
    const onFillWithExistingBgResult = inspectDsSetupGapsFromFigmaData(onFillWithExistingBgSnap);
    assert.strictEqual(
      onFillWithExistingBgResult.missingSemanticRoles.some(gap => gap.family === "danger" && gap.missingRole === "background"),
      false,
      "existing color/fill/danger should satisfy on-fill foreground families"
    );
  }

  const mixedNamingVars = [
    sem("text-on-info", "color/text/on-info", alias("n50"), alias("n950")),
    sem("icon-on-info", "color/icon/on-info", alias("n50"), alias("n950")),
    sem("on-surface-brand", "color/on-surface/brand", alias("n950"), alias("n50")),
    sem("icon-brand", "color/icon/brand", alias("n950"), alias("n50")),
  ];
  const mixedNamingSnap = {
    variables: primitives.concat(mixedNamingVars),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: mixedNamingVars.map(v => v.id) },
    ],
  };
  const mixedNamingResult = inspectDsSetupGapsFromFigmaData(mixedNamingSnap);
  assert.ok(
    mixedNamingResult.missingSemanticRoles.some(gap => gap.family === "info" && gap.suggestedName === "color/fill/info"),
    "mixed naming should keep role-based on-* family mapped to fill/* background expectations"
  );
  assert.ok(
    mixedNamingResult.missingSemanticRoles.some(gap => gap.family === "brand" && gap.suggestedName === "color/surface/brand"),
    "mixed naming should preserve valid surface-based on-surface/* background expectations"
  );
  {
    const roleBasedWithFillVars = [
      sem("fill-danger", "color/fill/danger", alias("r700"), alias("r200")),
      sem("text-on-danger", "color/text/on-danger", alias("n50"), alias("n950")),
      sem("icon-on-danger", "color/icon/on-danger", alias("r700"), alias("r200")),
    ];
    const roleBasedWithFillSnap = {
      variables: primitives.concat(roleBasedWithFillVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: roleBasedWithFillVars.map(v => v.id) },
      ],
    };
    const roleBasedWithFillResult = inspectDsSetupGapsFromFigmaData(roleBasedWithFillSnap);
    assert.strictEqual(
      roleBasedWithFillResult.missingSemanticRoles.some(gap => gap.family === "danger" && gap.missingRole === "background"),
      false,
      "role-based families with existing color/fill/* backgrounds should not report missing background"
    );
    const dangerFamily = roleBasedWithFillResult.semanticFamilies.find(family => family.family === "danger");
    assert.ok(dangerFamily, "role-based fill/text-on family should be clustered");
    assert.ok(
      dangerFamily.roles.background.includes("color/fill/danger"),
      "role-based fill token should participate as the background role for setup-gap family checks"
    );
    const fillDangerAdvisory = roleBasedWithFillResult.companionAdvisories.find(item => item.bg === "color/fill/danger");
    assert.ok(
      !fillDangerAdvisory || fillDangerAdvisory.missing.every(item => item.role !== "icon"),
      "existing color/icon/on-* companions should prevent missing icon advisories for fill/* backgrounds"
    );
    assert.ok(
      roleBasedWithFillResult.iconContrastFailures.some(item =>
        item.bg === "color/fill/danger" && item.icon === "color/icon/on-danger"
      ),
      "icon contrast QA should evaluate fill/* backgrounds against existing icon/on-* companions"
    );
    assert.strictEqual(
      roleBasedWithFillResult.semanticNamingConflicts.length,
      0,
      "role-based-only fill/text-on/icon-on naming should not be treated as duplicate intent"
    );
    assert.strictEqual(
      roleBasedWithFillResult.semanticNamingAdvisories.some(item => item.token === "color/text/on-danger"),
      false,
      "role-based-only fill/text-on/icon-on naming should not produce ambiguous shorthand advisories"
    );
  }
  {
    const surfaceBasedOnlyVars = [
      sem("bg-danger", "color/bg/danger", alias("r700"), alias("r700")),
      sem("text-danger", "color/text/danger", alias("n950"), alias("n50")),
      sem("icon-danger", "color/icon/danger", alias("n950"), alias("n50")),
    ];
    const surfaceBasedOnlySnap = {
      variables: primitives.concat(surfaceBasedOnlyVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: surfaceBasedOnlyVars.map(v => v.id) },
      ],
    };
    const surfaceBasedOnlyResult = inspectDsSetupGapsFromFigmaData(surfaceBasedOnlySnap);
    assert.strictEqual(
      surfaceBasedOnlyResult.semanticNamingConflicts.length,
      0,
      "surface-based-only bg/text/icon naming should not be treated as duplicate intent"
    );
  }
  {
    const surfaceAndOnFillVars = [
      sem("bg-danger", "color/bg/danger", alias("r700"), alias("r700")),
      sem("text-danger", "color/text/danger", alias("n950"), alias("n50")),
      sem("icon-danger", "color/icon/danger", alias("n950"), alias("n50")),
      sem("fill-danger", "color/fill/danger", alias("r700"), alias("r200")),
      sem("text-on-fill-danger", "color/text/on-fill-danger", alias("r700"), alias("r200")),
      sem("icon-on-fill-danger", "color/icon/on-fill-danger", alias("r700"), alias("r200")),
    ];
    const surfaceAndOnFillSnap = {
      variables: primitives.concat(surfaceAndOnFillVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: surfaceAndOnFillVars.map(v => v.id) },
      ],
    };
    const surfaceAndOnFillResult = inspectDsSetupGapsFromFigmaData(surfaceAndOnFillSnap);
    assert.strictEqual(
      surfaceAndOnFillResult.semanticNamingConflicts.length,
      0,
      "surface text/icon and on-fill text/icon roles should not be treated as duplicate naming intent"
    );
    assert.ok(
      surfaceAndOnFillResult.contrastFailures.some(item =>
        item.bg === "color/fill/danger" &&
        item.fg === "color/text/on-fill-danger"
      ),
      "fill backgrounds should pair with text/on-fill-* roles for contrast diagnosis"
    );
    assert.ok(
      surfaceAndOnFillResult.iconContrastFailures.some(item =>
        item.bg === "color/fill/danger" &&
        item.icon === "color/icon/on-fill-danger"
      ),
      "fill backgrounds should pair with icon/on-fill-* roles for icon contrast diagnosis"
    );
  }
  {
    const mixedDuplicateIntentVars = [
      sem("fill-danger", "color/fill/danger", alias("r700"), alias("r700")),
      sem("text-danger", "color/text/danger", alias("r700"), alias("r700")),
      sem("text-on-danger", "color/text/on-danger", alias("n50"), alias("n950")),
      sem("icon-danger", "color/icon/danger", alias("r700"), alias("r700")),
      sem("icon-on-danger", "color/icon/on-danger", alias("n50"), alias("n950")),
      sem("bg-info", "color/bg/info", alias("n50"), alias("n950")),
      sem("fill-info", "color/fill/info", alias("r700"), alias("r700")),
      sem("text-on-info", "color/text/on-info", alias("n50"), alias("n950")),
    ];
    const mixedDuplicateIntentSnap = {
      variables: primitives.concat(mixedDuplicateIntentVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: mixedDuplicateIntentVars.map(v => v.id) },
      ],
    };
    const mixedDuplicateIntentResult = inspectDsSetupGapsFromFigmaData(mixedDuplicateIntentSnap);
    assert.strictEqual(
      mixedDuplicateIntentResult.summary.semanticNamingConflictCount,
      0,
      "plain text/icon roles and ambiguous on-* shorthand should not be treated as automatic duplicate conflicts"
    );
    assert.strictEqual(
      mixedDuplicateIntentResult.semanticNamingAdvisories.some(item =>
        item.token === "color/text/on-danger" ||
        item.token === "color/icon/on-danger"
      ),
      false,
      "text/icon on-danger should be clean when color/fill/danger is the matching context"
    );
    const infoBackgroundConflict = mixedDuplicateIntentResult.semanticNamingConflicts.find(item =>
      item.family === "info" && item.role === "background"
    );
    assert.strictEqual(
      infoBackgroundConflict,
      undefined,
      "bg/info and fill/info are related background roles, not duplicate competitors"
    );
    assert.ok(
      !mixedDuplicateIntentResult.topFindings.highConfidenceIssues.some(item => item.kind === "semantic-naming-diagnostic"),
      "semantic naming advisories should not appear as high-priority health-check findings"
    );
    const mixedPlan = _buildRepairPlan(mixedDuplicateIntentResult);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(mixedPlan.applyInput, "namingMigrations"),
      false,
      "naming conflicts should not be exposed as auto-migration payloads"
    );
    assert.strictEqual(
      mixedPlan.missingCapabilityNotes.some(note => note.kind === "semantic-naming-advisory"),
      false,
      "clean role-based fill/on-* naming should not surface advisory notes"
    );
  }
  {
    const ambiguousNoContextVars = [
      sem("text-on-danger", "color/text/on-danger", alias("n50"), alias("n950")),
      sem("icon-on-danger", "color/icon/on-danger", alias("n50"), alias("n950")),
    ];
    const ambiguousNoContextSnap = {
      variables: primitives.concat(ambiguousNoContextVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: ambiguousNoContextVars.map(v => v.id) },
      ],
    };
    const ambiguousNoContextResult = inspectDsSetupGapsFromFigmaData(ambiguousNoContextSnap);
    assert.ok(
      ambiguousNoContextResult.semanticNamingAdvisories.some(item =>
        item.token === "color/text/on-danger" &&
        item.kind === "ambiguous-name"
      ),
      "text/on-danger should be an advisory when no matching background context exists"
    );
    const ambiguousPlan = _buildRepairPlan(ambiguousNoContextResult);
    assert.ok(
      ambiguousPlan.missingCapabilityNotes.some(note =>
        note.kind === "semantic-naming-advisory" &&
        note.token === "color/text/on-danger"
      ),
      "repair plan should surface ambiguous shorthand naming as an advisory"
    );
    assert.ok(
      ambiguousPlan.designerPresentation.proposedChanges.needsDesignerDecision.some(change =>
        change.reason === "semantic naming advisory" &&
        change.summaryLine.includes("color/text/on-danger")
      ),
      "designer presentation should list ambiguous shorthand as a naming advisory"
    );
  }
  {
    const invalidOnBackgroundVars = [
      sem("bg-danger", "color/bg/danger", alias("r700"), alias("r700")),
      sem("bg-on-danger", "color/bg/on-danger", alias("r700"), alias("r700")),
      sem("text-on-danger", "color/text/on-danger", alias("n50"), alias("n950")),
      sem("icon-on-danger", "color/icon/on-danger", alias("n50"), alias("n950")),
      sem("surface-info", "color/surface/info", alias("n50"), alias("n950")),
      sem("surface-on-info", "color/surface/on-info", alias("n50"), alias("n950")),
    ];
    const invalidOnBackgroundSnap = {
      variables: primitives.concat(invalidOnBackgroundVars),
      collections: [
        { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: invalidOnBackgroundVars.map(v => v.id) },
      ],
    };
    const invalidOnBackgroundResult = inspectDsSetupGapsFromFigmaData(invalidOnBackgroundSnap);
    assert.strictEqual(
      invalidOnBackgroundResult.summary.semanticNamingConflictCount,
      2,
      "bg/on-* and surface/on-* backgrounds should be grouped with their plain background family"
    );
    const dangerBgConflict = invalidOnBackgroundResult.semanticNamingConflicts.find(item =>
      item.family === "danger" && item.role === "background"
    );
    assert.ok(dangerBgConflict, "bg/danger vs bg/on-danger should be a semantic naming conflict");
    assert.strictEqual(dangerBgConflict.conflictType, "invalid-on-background");
    assert.deepStrictEqual(dangerBgConflict.tokens.surfaceBased, ["color/bg/danger"]);
    assert.deepStrictEqual(dangerBgConflict.tokens.roleBased, ["color/bg/on-danger"]);
    assert.deepStrictEqual(dangerBgConflict.tokens.invalidOnBackground, ["color/bg/on-danger"]);
    assert.strictEqual(dangerBgConflict.canonicalRecommendation.convention, "plain-background");
    assert.deepStrictEqual(dangerBgConflict.canonicalRecommendation.keep, ["color/bg/danger"]);
    assert.deepStrictEqual(dangerBgConflict.canonicalRecommendation.review, ["color/bg/on-danger"]);
    assert.ok(
      dangerBgConflict.canonicalRecommendation.reason.includes("should not use on-* leaves"),
      "invalid on-* background conflicts should explain why the plain background is canonical"
    );
    const infoSurfaceConflict = invalidOnBackgroundResult.semanticNamingConflicts.find(item =>
      item.family === "info" && item.role === "background"
    );
    assert.ok(infoSurfaceConflict, "surface/info vs surface/on-info should also be caught");
    assert.strictEqual(infoSurfaceConflict.conflictType, "invalid-on-background");
    assert.deepStrictEqual(infoSurfaceConflict.tokens.surfaceBased, ["color/surface/info"]);
    assert.deepStrictEqual(infoSurfaceConflict.tokens.roleBased, ["color/surface/on-info"]);
    assert.deepStrictEqual(
      invalidOnBackgroundResult.contrastFailures.filter(item => item.bg === "color/bg/on-danger"),
      [],
      "invalid bg/on-* variables should not drive text contrast repair suggestions"
    );
    assert.deepStrictEqual(
      invalidOnBackgroundResult.iconContrastFailures.filter(item => item.bg === "color/bg/on-danger"),
      [],
      "invalid bg/on-* variables should not drive icon contrast repair suggestions"
    );
  }

  // ── Config context is a suppressive hint, not the source of truth. When a
  // bg is explicitly paired to a shared foreground, the naming fallback should
  // stop asking for a same-leaf foreground.
  const sharedFgVars = [
    sem("bg-brand-subtle", "color/bg/brand-subtle", alias("n50"), alias("n950")),
    sem("text-brand", "color/text/brand", alias("n950"), alias("n50")),
  ];
  const sharedFgSnap = {
    variables: primitives.concat(sharedFgVars),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: sharedFgVars.map(v => v.id) },
    ],
  };
  const namingOnly = inspectDsSetupGapsFromFigmaData(sharedFgSnap);
  assert.ok(namingOnly.semanticGaps.some(gap => gap.bg === "color/bg/brand-subtle"));
  const withConfigHint = inspectDsSetupGapsFromFigmaData(sharedFgSnap, {
    existingDs: {
      color: {
        semantics: {
          pairs: [{ bg: "color/bg/brand-subtle", text: "color/text/brand" }],
        },
      },
    },
  });
  assert.ok(!withConfigHint.semanticGaps.some(gap => gap.bg === "color/bg/brand-subtle"));
  assert.ok(!withConfigHint.missingSemanticRoles.some(gap => gap.family === "brand-subtle"));
})();
