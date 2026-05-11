const assert = require("assert");
const { formatCheckReport } = require("../../packages/figlets-mcp-server/src/cli/check-setup-gaps.js");

const NO_CHANGES = "No changes were made to Figma.";

module.exports = (async () => {
  // Bridge not running
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:1337",
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
      receiverUrl: "http://127.0.0.1:1337",
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
      receiverUrl: "http://127.0.0.1:1337",
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

  // Happy path with no changes
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:1337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: { dryRun: true, changes: [], skipped: [], summary: { changedCount: 0, skippedCount: 0 } },
      gaps: { semanticGaps: [], summary: { semanticGapCount: 0, proposedCount: 0, unresolvedCount: 0 } },
    });
    assert.ok(out.includes("Active Figma file: abc123"));
    assert.ok(out.includes("Step 1/3 Sync from Figma: ok"));
    assert.ok(out.includes("Step 2/3 Config refresh (dry-run): config already matches Figma"));
    assert.ok(out.includes("Step 3/3 Setup gaps: none found"));
    assert.ok(out.includes("setup looks clean"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
  }

  // No config yet
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:1337",
      receiverRunning: true,
      pluginConnected: true,
      activeFileKey: "abc123",
      sync: { ok: true },
      refresh: { error: "Config not found: /path/to/design-system.config.js" },
      gaps: { semanticGaps: [], summary: { semanticGapCount: 0, proposedCount: 0, unresolvedCount: 0 } },
    });
    assert.ok(out.includes("no design-system.config.js for this Figma file"));
    assert.ok(out.includes("Figma is the source of truth"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
  }

  // Changes pending + gaps
  {
    const out = formatCheckReport({
      receiverUrl: "http://127.0.0.1:1337",
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
        summary: { semanticGapCount: 2, proposedCount: 1, unresolvedCount: 1 },
      },
    });
    assert.ok(out.includes("would update 2 entries"));
    assert.ok(out.includes('Brand "Primary" step 500'));
    assert.ok(out.includes("2 found (1 ready to repair, 1 need a designer decision)"));
    assert.ok(out.includes('would add "color/on-surface/hover-variant"'));
    assert.ok(out.includes("unresolved"));
    assert.ok(out.includes("local config is out of date in 2 places"));
    assert.ok(out.includes("Figma has 2 semantic tokens"));
    assert.ok(out.trim().endsWith(NO_CHANGES));
  }
})();
