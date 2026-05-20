const assert = require("assert");
const { formatCheckReport } = require("../../packages/figlets-mcp-server/src/cli/check-setup-gaps.js");

const NO_CHANGES = "No changes were made to Figma.";

function emptySummary(extra) {
  return Object.assign({
    semanticGapCount: 0,
    proposedCount: 0,
    unresolvedCount: 0,
    missingBackgroundCount: 0,
    missingSemanticRoleCount: 0,
    highConfidenceSemanticRoleGapCount: 0,
    incompleteModeCount: 0,
    contrastFailureCount: 0,
    iconContrastFailureCount: 0,
    brokenAliasCount: 0,
    foundationRoleFindingCount: 0,
    companionAdvisoryCount: 0,
  }, extra || {});
}

module.exports = (async () => {
  // Bridge not running
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: false,
      pluginConnected: false,
      activeFileKey: null,
      sync: null,
      refresh: null,
      gaps: null,
      blocked: "receiver-not-running",
    });
    assert.ok(out.includes("Bridge receiver: not running"));
    assert.ok(out.includes("local bridge isn't running"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
    assert.ok(!out.includes("Step 1/3"));
  }

  // Plugin not connected
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: false,
      activeFileKey: null,
      sync: null,
      refresh: null,
      gaps: null,
      blocked: "plugin-not-connected",
    });
    assert.ok(out.includes("Figma plugin: not connected"));
    assert.ok(out.includes("Figlets Bridge plugin"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
    assert.ok(!out.includes("Step 1/3"));
  }

  // Sync failed
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: false, error: "Sync failed with status 504" },
      refresh: null,
      gaps: null,
      blocked: "sync-failed",
    });
    assert.ok(out.includes("Step 1/3 Sync from Figma: failed"));
    assert.ok(out.includes("Sync failed with status 504"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
    assert.ok(!out.includes("Step 2/3"));
  }

  // Happy path with no findings
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: { dryRun: true, changes: [], skipped: [], summary: { changedCount: 0, skippedCount: 0 } },
      gaps: { semanticGaps: [], missingBackgrounds: [], incompleteModes: [], contrastFailures: [], brokenAliases: [], companionAdvisories: [], contrastAlgorithm: "wcag", summary: emptySummary() },
    });
    assert.ok(out.includes("Active Figma file: abc123"));
    assert.ok(out.includes("Step 1/3 Sync from Figma: ok"));
    assert.ok(out.includes("Step 2/3 Config refresh (dry-run): config already matches Figma"));
    assert.ok(out.includes("Step 3/3 Semantic-layer QA: clean"));
    assert.ok(out.includes("semantic color layer looks clean"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
  }

  // No config yet — Figma is the source of truth
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: { error: "Config not found: /path/to/design-system.config.js" },
      gaps: { semanticGaps: [], missingBackgrounds: [], incompleteModes: [], contrastFailures: [], brokenAliases: [], companionAdvisories: [], contrastAlgorithm: "wcag", summary: emptySummary() },
    });
    assert.ok(out.includes("no design-system.config.js for this Figma file"));
    assert.ok(out.includes("Figma is the source of truth"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
  }

  // Findings across every QA category
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: {
        dryRun: true,
        changes: [
          { kind: "brand", name: "Primary", step: "500", from: "#4F46E5", to: "#5B5BD6" },
          { kind: "semantic-alias", token: "color/text/default", mode: "Light", slot: "text", from: "color/neutral/800", to: "color/neutral/900" },
        ],
        skipped: [],
        summary: { changedCount: 2, skippedCount: 0 },
      },
      gaps: {
        semanticGaps: [
          { kind: "missing-foreground-companion", bg: "color/surface/hover-variant", recommended: "color/on-surface/hover-variant", source: "color/on-surface/default", status: "proposed" },
          { kind: "missing-foreground-companion", bg: "color/bg/danger/variant", recommended: "color/text/danger/variant", source: null, status: "unresolved" },
        ],
        missingBackgrounds: [
          { kind: "missing-background-for-foreground", fg: "color/on-surface/info", expectedBg: "color/surface/info" },
        ],
        missingSemanticRoles: [
          {
            kind: "missing-semantic-role",
            family: "success",
            missingRole: "icon",
            suggestedName: "color/icon/success",
            evidence: ["color/bg/success", "color/text/success", "color/border/success"],
            confidence: "high",
          },
        ],
        incompleteModes: [
          { kind: "incomplete-modes", token: "color/surface/warning", collection: "Color", missingModes: ["Dark"] },
        ],
        contrastFailures: [
          { kind: "contrast-failure", bg: "color/surface/warning", fg: "color/on-surface/warning", mode: "Light", algorithm: "wcag", score: 2.1, threshold: 4.5 },
        ],
        iconContrastFailures: [
          { kind: "icon-contrast-failure", bg: "color/surface/danger", icon: "color/icon/danger", mode: "Light", algorithm: "wcag-non-text", score: 1, threshold: 3 },
        ],
        brokenAliases: [
          { kind: "broken-alias", holder: "color/surface/danger", mode: "Dark", missingTargetId: "deleted-id" },
        ],
        foundationRoleFindings: [
          {
            kind: "missing-foundation-role",
            role: "focus-border",
            suggestedNames: ["color/border/focus", "color/border/focus-ring"],
            confidence: "high",
            reason: "This DS uses border/outline semantics but has no focus indicator border token. Keyboard focus needs a deliberate, prominent role.",
          },
        ],
        companionAdvisories: [
          { kind: "missing-companion-advisory", bg: "color/surface/brand", fg: "color/on-surface/brand", missing: [{ role: "border", suggestedNames: ["color/border/brand"] }] },
        ],
        contrastAlgorithm: "wcag",
        summary: emptySummary({
          semanticGapCount: 2, proposedCount: 1, unresolvedCount: 1,
          missingSemanticRoleCount: 1, highConfidenceSemanticRoleGapCount: 1,
          missingBackgroundCount: 1, incompleteModeCount: 1, contrastFailureCount: 1,
          iconContrastFailureCount: 1,
          brokenAliasCount: 1, foundationRoleFindingCount: 1, companionAdvisoryCount: 1,
        }),
      },
    });
    assert.ok(out.includes("would update 2 entries"));
    assert.ok(out.includes('Brand "Primary" step 500'));

    // Header summarizes total findings + algorithm
    assert.ok(out.includes("Step 3/3 Semantic-layer QA: 10 findings (contrast checked with WCAG ratio)"));

    // Severity ordering: broken aliases first, then contrast, then missing fg/bg, modes, advisories
    const orderTokens = [
      "Broken aliases in the semantic layer:",
      "Contrast failures:",
      "Icon contrast failures:",
      "Likely semantic-family gaps:",
      "Foundational role gaps:",
      "Possible naming gaps:",
      "Foregrounds without a background:",
      "Tokens with incomplete modes:",
      "Pairs missing border/icon companions (advisory):",
    ];
    let cursor = 0;
    for (const tok of orderTokens) {
      const idx = out.indexOf(tok, cursor);
      assert.ok(idx >= cursor, `section "${tok}" should appear after the previous one`);
      cursor = idx + tok.length;
    }

    // Missing-fg framing: no "ready to repair", no "would add", no plannedAliases preview
    assert.ok(out.includes("Likely semantic-family gaps: 1 (1 high-confidence)"));
    assert.ok(out.includes('high confidence: "success" is missing icon'));
    assert.ok(out.includes('possible token: "color/icon/success"'));
    assert.ok(out.includes("next step: ask the designer before treating this as a repair"));
    assert.ok(out.includes("Foundational role gaps: 1"));
    assert.ok(out.includes("high confidence: missing focus-border"));
    assert.ok(out.includes('possible token: "color/border/focus"'));

    assert.ok(out.includes("Possible naming gaps: 2"));
    assert.ok(!/ready to repair/.test(out), "should not say 'ready to repair'");
    assert.ok(!/would add/.test(out), "should not preview the apply step in QA");
    assert.ok(!/upgraded for contrast/.test(out), "should not surface plannedAliases-driven copy");
    assert.ok(out.includes('Missing foreground for "color/surface/hover-variant"'));
    assert.ok(out.includes('convention would suggest: "color/on-surface/hover-variant"'));
    assert.ok(out.includes('closest existing token: "color/on-surface/default"'));
    assert.ok(out.includes("no nearest token in Figma"), "unresolved variant must say no nearest token");

    // Missing-bg / incomplete / advisory
    assert.ok(out.includes("Foregrounds without a background: 1"));
    assert.ok(out.includes('"color/on-surface/info" expects "color/surface/info"'));
    assert.ok(out.includes("Tokens with incomplete modes: 1"));
    assert.ok(out.includes('"color/surface/warning" missing value in: Dark'));
    assert.ok(out.includes("Pairs missing border/icon companions (advisory): 1"));
    assert.ok(out.includes('"color/surface/brand" + "color/on-surface/brand" — no border'));

    // Contrast failures: hex + primitive + near-miss tag
    assert.ok(out.includes("Contrast failures: 1"));
    assert.ok(out.includes('"color/surface/warning" + "color/on-surface/warning" (Light) → 2.1:1 (needs ≥ 4.5:1)'));
    assert.ok(out.includes("Icon contrast failures: 1"));
    assert.ok(out.includes('"color/icon/danger" on "color/surface/danger" (Light) → 1:1, needs 3:1'));

    // Broken aliases
    assert.ok(out.includes("Broken aliases in the semantic layer: 1"));
    assert.ok(out.includes('"color/surface/danger" (Dark) → points at a deleted variable'));

    // What this means — severity-ordered
    assert.ok(out.includes("URGENT: 1 semantic token references variables that were deleted"));
    assert.ok(out.includes("A11Y: 1 pair fails the contrast threshold") || out.includes("A11Y: 1 pairs fail"));
    assert.ok(out.includes("A11Y: 1 icon role fails WCAG non-text contrast (3:1)."));
    assert.ok(out.includes("1 semantic family looks incomplete (1 high-confidence). Ask before repairing."));
    assert.ok(out.includes("1 foundational semantic role missing."));
    assert.ok(out.includes("2 backgrounds missing a foreground companion"));
    assert.ok(out.includes("1 foreground (on-*) without a matching background"));
    assert.ok(out.includes("Side note: your local config is out of date in 2 places"));
    assert.ok(out.includes("This is a QA report — nothing was changed"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
  }

  // High-confidence neighboring-outline gaps should not be hidden behind medium variant advisories.
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: { dryRun: true, changes: [], skipped: [], summary: { changedCount: 0, skippedCount: 0 } },
      gaps: {
        semanticGaps: [], missingBackgrounds: [], incompleteModes: [], contrastFailures: [], iconContrastFailures: [], brokenAliases: [], foundationRoleFindings: [], companionAdvisories: [],
        missingSemanticRoles: [
          { kind: "missing-semantic-role", family: "info", missingRole: "border", suggestedName: "color/outline/info", evidence: ["color/surface/info"], confidence: "high" },
          { kind: "missing-semantic-role", family: "success", missingRole: "border", suggestedName: "color/outline/success", evidence: ["color/surface/success"], confidence: "high" },
          { kind: "missing-semantic-role", family: "warning", missingRole: "border", suggestedName: "color/outline/warning", evidence: ["color/surface/warning"], confidence: "high" },
          { kind: "missing-semantic-role", family: "brand-variant", missingRole: "border", suggestedName: "color/outline/brand-variant", evidence: ["color/surface/brand-variant"], confidence: "medium" },
        ],
        contrastAlgorithm: "wcag",
        summary: emptySummary({ missingSemanticRoleCount: 4, highConfidenceSemanticRoleGapCount: 3 }),
      },
    });
    const infoIdx = out.indexOf('possible token: "color/outline/info"');
    const brandIdx = out.indexOf('possible token: "color/outline/brand-variant"');
    assert.ok(infoIdx >= 0, "high-confidence info outline should be visible");
    assert.ok(brandIdx >= 0, "medium variant advisory should still be visible when room allows");
    assert.ok(infoIdx < brandIdx, "high-confidence neighboring outlines should render before medium advisories");
  }

  // APCA-mode label propagates + near-miss tag + hex render + snapshot
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: { dryRun: true, changes: [], skipped: [], summary: { changedCount: 0, skippedCount: 0 } },
      gaps: {
        semanticGaps: [],
        missingBackgrounds: [],
        incompleteModes: [],
        contrastFailures: [{
          kind: "contrast-failure", bg: "a", fg: "b", mode: "Light", algorithm: "apca",
          score: 74, threshold: 75, nearMiss: true, gap: 1,
          bgPrimitive: { name: "color/yellow/950", rgb: { r: 0.18, g: 0.12, b: 0 } },
          fgPrimitive: { name: "color/yellow/200", rgb: { r: 1, g: 0.84, b: 0.47 } },
        }],
        brokenAliases: [], companionAdvisories: [], contrastAlgorithm: "apca",
        snapshot: { path: "/x", syncedAt: "2026-05-12T12:00:00.000Z", variableCount: 42, collectionCount: 3 },
        summary: emptySummary({ contrastFailureCount: 1, contrastNearMissCount: 1 }),
      },
    });
    assert.ok(out.includes("contrast checked with APCA Lc"));
    assert.ok(out.includes("Snapshot: 42 variables, 3 collections"));
    assert.ok(out.includes('"a" + "b" (Light) → 74Lc (needs ≥ 75Lc) (near-miss, off by 1Lc)'));
    assert.ok(out.includes("bg → color/yellow/950 #2E1F00"));
    assert.ok(out.includes("fg → color/yellow/200 #FFD678"));
    assert.ok(out.includes("Contrast failures: 1 (1 near-miss)"));
    assert.ok(out.includes("(all near-miss)"));
  }

  // Advisory suppression: render the DS-level note when a role is universally absent
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:17337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: { dryRun: true, changes: [], skipped: [], summary: { changedCount: 0, skippedCount: 0 } },
      gaps: {
        semanticGaps: [], missingBackgrounds: [], incompleteModes: [], contrastFailures: [], brokenAliases: [],
        companionAdvisories: [],
        suppressedAdvisoryRoles: [{ role: "icon", suppressedCount: 10 }],
        contrastAlgorithm: "wcag",
        summary: emptySummary({ companionAdvisoryCount: 0, suppressedAdvisoryRoleCount: 1 }),
      },
    });
    assert.ok(out.includes("This DS doesn't use per-role icon tokens — suppressing 10 icon advisories."));
  }
})();
