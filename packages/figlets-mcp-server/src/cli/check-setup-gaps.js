const http = require("http");
const { checkPort, RECEIVER_PORT } = require("../utils/ensure-receiver.js");
const { getReceiverUrl } = require("../utils/receiver-url.js");
const { getActiveFileKey } = require("../utils/paths.js");
const { handleSyncFigmaData } = require("../tools/sync-figma-data.js");
const { handleRefreshDsConfigFromFigma } = require("../tools/refresh-ds-config-from-figma.js");
const { handleInspectDsSetupGaps } = require("../tools/inspect-ds-setup-gaps.js");

function _getJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json: JSON.parse(body) });
        } catch (err) {
          resolve({ ok: false, statusCode: res.statusCode, error: "Invalid JSON response" });
        }
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(timeoutMs || 2000, () => {
      req.destroy();
      resolve({ ok: false, error: "Timed out" });
    });
  });
}

async function _readBridgeHealth() {
  const receiverUrl = getReceiverUrl();
  let receiverPort = RECEIVER_PORT;
  try {
    receiverPort = Number(new URL(receiverUrl).port || RECEIVER_PORT);
  } catch (err) {}

  const receiverRunning = await checkPort(receiverPort);
  let health = null;
  if (receiverRunning) {
    const result = await _getJson(`${receiverUrl}/health`, 2000);
    health = result.ok ? result.json : { error: result.error || `HTTP ${result.statusCode}` };
  }
  return { receiverUrl, receiverRunning, health };
}

async function gatherCheckReport() {
  const bridge = await _readBridgeHealth();
  const pluginConnected = Boolean(bridge.health && bridge.health.pluginConnected);
  const activeFileKey = (bridge.health && bridge.health.activeFileKey) || getActiveFileKey();

  const state = {
    receiverUrl: bridge.receiverUrl,
    receiverRunning: bridge.receiverRunning,
    pluginConnected,
    activeFileKey: activeFileKey || null,
    sync: null,
    refresh: null,
    gaps: null,
  };

  if (!bridge.receiverRunning) {
    state.blocked = "receiver-not-running";
    return state;
  }
  if (!pluginConnected) {
    state.blocked = "plugin-not-connected";
    return state;
  }

  try {
    await handleSyncFigmaData();
    state.sync = { ok: true };
  } catch (err) {
    state.sync = { ok: false, error: err.message };
    state.blocked = "sync-failed";
    return state;
  }

  state.activeFileKey = getActiveFileKey() || state.activeFileKey;

  state.refresh = handleRefreshDsConfigFromFigma({ dry_run: true });
  state.gaps = handleInspectDsSetupGaps({});

  return state;
}

function _formatRgb(value) {
  if (!value || typeof value !== "object") return "";
  const c = (n) => Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 255).toString(16).padStart(2, "0").toUpperCase();
  return "#" + c(value.r) + c(value.g) + c(value.b);
}

function _formatRefreshChange(change) {
  if (change.kind === "brand") {
    return `Brand "${change.name}" step ${change.step}: ${change.from || "(none)"} → ${change.to}`;
  }
  if (change.kind === "ramp-step") {
    return `Ramp step "${change.name}": ${_formatRgb(change.from)} → ${_formatRgb(change.to)}`;
  }
  if (change.kind === "semantic-alias") {
    return `Semantic alias "${change.token}" (${change.mode}, ${change.slot}): ${change.from || "(none)"} → ${change.to}`;
  }
  return `${change.kind}: ${change.name || change.token || ""}`;
}

function _formatMissingFgGap(gap) {
  // Pure QA framing: report the gap and the closest existing token in the
  // file so the agent can ask the designer what to do. The picker's
  // plannedAliases stay on the JSON for apply_ds_setup_repairs but are
  // intentionally not rendered here — they bias the conversation toward
  // "ready to repair" before the designer has decided anything.
  const lines = [`Missing foreground for "${gap.bg}"`];
  lines.push(`    convention would suggest: "${gap.recommended}"`);
  if (gap.source) {
    const aliasParts = [];
    const sa = gap.sourceAliases || {};
    if (sa.Light) aliasParts.push(`Light → ${sa.Light}`);
    if (sa.Dark)  aliasParts.push(`Dark → ${sa.Dark}`);
    const aliasText = aliasParts.length ? ` (currently aliases ${aliasParts.join(", ")})` : "";
    lines.push(`    closest existing token: "${gap.source}"${aliasText}`);
  } else {
    lines.push(`    no nearest token in Figma — designer decides what to alias`);
  }
  return lines;
}

function _formatHex(rgb) {
  if (!rgb || typeof rgb !== "object") return "";
  const c = (n) => Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 255).toString(16).padStart(2, "0").toUpperCase();
  return "#" + c(rgb.r) + c(rgb.g) + c(rgb.b);
}

function _formatContrastFailure(item) {
  const unit = item.algorithm === "apca" ? "Lc" : ":1";
  const nearMissTag = item.nearMiss ? ` (near-miss, off by ${item.gap}${unit === ":1" ? "" : unit})` : "";
  const lines = [
    `"${item.bg}" + "${item.fg}" (${item.mode}) → ${item.score}${unit} (needs ≥ ${item.threshold}${unit})${nearMissTag}`
  ];
  if (item.bgPrimitive) lines.push(`    bg → ${item.bgPrimitive.name} ${_formatHex(item.bgPrimitive.rgb)}`);
  if (item.fgPrimitive) lines.push(`    fg → ${item.fgPrimitive.name} ${_formatHex(item.fgPrimitive.rgb)}`);
  if (item.plannedReAlias) {
    lines.push(`    suggested fix: re-alias "${item.plannedReAlias.token}" (${item.plannedReAlias.mode}) → ${item.plannedReAlias.to}`);
  }
  return lines;
}

function _formatIconContrastFailure(item) {
  const lines = [
    `"${item.icon}" on "${item.bg}" (${item.mode}) → ${item.score}:1, needs ${item.threshold}:1`
  ];
  if (item.bgPrimitive) lines.push(`    bg → ${item.bgPrimitive.name} ${_formatHex(item.bgPrimitive.rgb)}`);
  if (item.iconPrimitive) lines.push(`    icon → ${item.iconPrimitive.name} ${_formatHex(item.iconPrimitive.rgb)}`);
  if (item.plannedReAlias) {
    lines.push(`    suggested fix: re-alias "${item.plannedReAlias.token}" (${item.plannedReAlias.mode}) → ${item.plannedReAlias.to}`);
  } else {
    lines.push("    no deterministic same-ramp fix found — ask the designer");
  }
  return lines;
}

function _formatMissingSemanticRole(item) {
  const lines = [
    `${item.confidence || "medium"} confidence: "${item.family}" is missing ${item.missingRole}`
  ];
  if (item.suggestedName) lines.push(`    possible token: "${item.suggestedName}"`);
  if (item.plannedRoleRepair && item.plannedRoleRepair.aliases) {
    const aliasPairs = Object.keys(item.plannedRoleRepair.aliases)
      .sort()
      .map(mode => `${mode} → ${item.plannedRoleRepair.aliases[mode]}`);
    if (aliasPairs.length) {
      lines.push(`    suggested aliases: ${aliasPairs.join(", ")}`);
    }
  }
  if (Array.isArray(item.evidence) && item.evidence.length) {
    lines.push(`    evidence: ${item.evidence.slice(0, 4).map(name => `"${name}"`).join(", ")}`);
  }
  lines.push(`    next step: ask the designer before treating this as a repair`);
  return lines;
}

function _formatFoundationRole(item) {
  const lines = [
    `${item.confidence || "medium"} confidence: missing ${item.role}`
  ];
  if (Array.isArray(item.suggestedNames) && item.suggestedNames.length) {
    lines.push(`    possible token: "${item.suggestedNames[0]}"`);
  }
  lines.push(`    reason: ${item.reason}`);
  lines.push("    next step: ask the designer before treating this as a repair");
  return lines;
}

function _formatSemanticNamingConflict(item) {
  const tokens = item.tokens || {};
  const surfaceBased = Array.isArray(tokens.surfaceBased) ? tokens.surfaceBased : [];
  const roleBased = Array.isArray(tokens.roleBased) ? tokens.roleBased : [];
  const recommendation = item.canonicalRecommendation || {};
  const lines = [
    `"${item.family}" ${item.role} mixes surface-based and role-based names`
  ];
  if (surfaceBased.length) lines.push(`    surface-based: ${surfaceBased.map(name => `"${name}"`).join(", ")}`);
  if (roleBased.length) lines.push(`    role-based: ${roleBased.map(name => `"${name}"`).join(", ")}`);
  if (recommendation.convention) {
    lines.push(`    recommendation: ${recommendation.convention}`);
  }
  if (recommendation.reason) {
    lines.push(`    reason: ${recommendation.reason}`);
  }
  lines.push("    next step: choose one canonical naming path before migration/deprecation");
  return lines;
}

function _renderSection(lines, items, header, formatter, max) {
  if (!Array.isArray(items) || !items.length) return;
  lines.push("");
  lines.push(header);
  const limit = Math.max(1, max || 8);
  const preview = items.slice(0, limit);
  for (const item of preview) {
    const out = formatter(item);
    if (Array.isArray(out)) {
      lines.push(`  - ${out[0]}`);
      for (let i = 1; i < out.length; i++) lines.push(`  ${out[i]}`);
    } else {
      lines.push(`  - ${out}`);
    }
  }
  if (items.length > preview.length) {
    lines.push(`  ...and ${items.length - preview.length} more.`);
  }
}

function formatCheckReport(state) {
  const lines = [];
  const NO_CHANGES = "No changes were made to Figma.";
  lines.push("Figlets MCP — Setup Gap Check");
  lines.push("");
  lines.push(`Bridge receiver: ${state.receiverRunning ? "running" : "not running"} (${state.receiverUrl})`);

  if (!state.receiverRunning) {
    lines.push("");
    lines.push("We can't read your Figma file because the local bridge isn't running.");
    lines.push("Next step: start the Figlets MCP server (the bridge starts with it), or relaunch your agent so it boots the bridge.");
    lines.push("");
    lines.push(NO_CHANGES);
    return lines.join("\n");
  }

  lines.push(`Figma plugin: ${state.pluginConnected ? "connected" : "not connected"}`);
  if (state.activeFileKey) lines.push(`Active Figma file: ${state.activeFileKey}`);

  if (!state.pluginConnected) {
    lines.push("");
    lines.push("We can't read your Figma file because the Figlets Bridge plugin isn't open in Figma.");
    lines.push("Next step: in Figma Desktop, open the file you want to check, then run Plugins → Figlets Bridge and keep it open.");
    lines.push("");
    lines.push(NO_CHANGES);
    return lines.join("\n");
  }

  lines.push("");

  if (state.sync && state.sync.ok) {
    lines.push("Step 1/3 Sync from Figma: ok");
  } else {
    lines.push(`Step 1/3 Sync from Figma: failed (${state.sync && state.sync.error ? state.sync.error : "unknown error"})`);
    lines.push("");
    lines.push("The local bridge is running but couldn't read the open Figma file. Make sure the Figlets Bridge plugin is still open, then try again.");
    lines.push("");
    lines.push(NO_CHANGES);
    return lines.join("\n");
  }

  const refresh = state.refresh || {};
  if (refresh.error) {
    if (/No active file-scoped config|Config not found/i.test(refresh.error)) {
      lines.push("Step 2/3 Config refresh (dry-run): no design-system.config.js for this Figma file");
      lines.push("  This is normal for a new project. Nothing to refresh — Figma is the source of truth.");
    } else {
      lines.push(`Step 2/3 Config refresh (dry-run): could not read config (${refresh.error})`);
      if (refresh.hint) lines.push(`  Hint: ${refresh.hint}`);
    }
  } else {
    const changed = refresh.summary ? refresh.summary.changedCount : (refresh.changes ? refresh.changes.length : 0);
    if (!changed) {
      lines.push("Step 2/3 Config refresh (dry-run): config already matches Figma");
    } else {
      lines.push(`Step 2/3 Config refresh (dry-run): would update ${changed} ${changed === 1 ? "entry" : "entries"}`);
      const preview = refresh.changes.slice(0, 8);
      for (const change of preview) lines.push(`  - ${_formatRefreshChange(change)}`);
      if (refresh.changes.length > preview.length) {
        lines.push(`  ...and ${refresh.changes.length - preview.length} more.`);
      }
      lines.push("  Note: nothing was written. Ask your agent to refresh the config when you're ready.");
    }
  }

  const gaps = state.gaps || {};
  if (gaps.error) {
    lines.push(`Step 3/3 Semantic-layer QA: could not inspect (${gaps.error})`);
    if (gaps.hint) lines.push(`  Hint: ${gaps.hint}`);
  } else {
    const summary = gaps.summary || {};
    const totals = (summary.semanticGapCount || 0)
      + (summary.missingSemanticRoleCount || 0)
      + (summary.missingBackgroundCount || 0)
      + (summary.incompleteModeCount || 0)
      + (summary.contrastFailureCount || 0)
      + (summary.iconContrastFailureCount || 0)
      + (summary.semanticNamingConflictCount || 0)
      + (summary.brokenAliasCount || 0)
      + (summary.foundationRoleFindingCount || 0)
      + (summary.companionAdvisoryCount || 0);

    if (!totals) {
      lines.push("Step 3/3 Semantic-layer QA: clean — no findings");
    } else {
      const algoLabel = gaps.contrastAlgorithm === "apca" ? "APCA Lc" : "WCAG ratio";
      lines.push(`Step 3/3 Semantic-layer QA: ${totals} finding${totals === 1 ? "" : "s"} (contrast checked with ${algoLabel})`);
    }

    // Snapshot freshness: helps the designer trust the report and gives the
    // agent a way to verify the snapshot isn't stale.
    if (gaps.snapshot) {
      const snap = gaps.snapshot;
      const synced = snap.syncedAt ? new Date(snap.syncedAt).toLocaleTimeString() : "unknown";
      lines.push(`  Snapshot: ${snap.variableCount} variables, ${snap.collectionCount} collections (synced at ${synced})`);
    }

    // Render sections in severity order so the agent walks the designer
    // through the urgent stuff first and only reaches advisories at the end.

    // 1. Broken aliases (Figma is in a broken state)
    _renderSection(
      lines,
      gaps.brokenAliases || [],
      `Broken aliases in the semantic layer: ${summary.brokenAliasCount || 0}`,
      (item) => `"${item.holder}" (${item.mode}) → points at a deleted variable`
    );

    // 2. Contrast failures (a11y problem)
    _renderSection(
      lines,
      gaps.contrastFailures || [],
      `Contrast failures: ${summary.contrastFailureCount || 0}${summary.contrastNearMissCount ? ` (${summary.contrastNearMissCount} near-miss)` : ""}`,
      _formatContrastFailure
    );

    // 3. Icon contrast failures (WCAG non-text legal baseline)
    _renderSection(
      lines,
      gaps.iconContrastFailures || [],
      `Icon contrast failures: ${summary.iconContrastFailureCount || 0}${summary.iconContrastNearMissCount ? ` (${summary.iconContrastNearMissCount} near-miss)` : ""}`,
      _formatIconContrastFailure
    );

    // 4. Mixed naming systems that create duplicate intent
    _renderSection(
      lines,
      gaps.semanticNamingConflicts || [],
      `Semantic naming conflicts: ${summary.semanticNamingConflictCount || 0}`,
      _formatSemanticNamingConflict
    );

    // 5. Likely family-level setup gaps
    _renderSection(
      lines,
      gaps.missingSemanticRoles || [],
      `Likely semantic-family gaps: ${summary.missingSemanticRoleCount || 0}${summary.highConfidenceSemanticRoleGapCount ? ` (${summary.highConfidenceSemanticRoleGapCount} high-confidence)` : ""}`,
      _formatMissingSemanticRole
    );

    // 6. Required/foundational semantic roles
    _renderSection(
      lines,
      gaps.foundationRoleFindings || [],
      `Foundational role gaps: ${summary.foundationRoleFindingCount || 0}`,
      _formatFoundationRole
    );

    // 7. Missing foregrounds
    _renderSection(
      lines,
      gaps.semanticGaps || [],
      `Possible naming gaps: ${summary.semanticGapCount || 0}`,
      _formatMissingFgGap
    );

    // 8. Missing backgrounds
    _renderSection(
      lines,
      gaps.missingBackgrounds || [],
      `Foregrounds without a background: ${summary.missingBackgroundCount || 0}`,
      (item) => `"${item.fg}" expects "${item.expectedBg}" — missing in Figma`
    );

    // 9. Incomplete modes
    _renderSection(
      lines,
      gaps.incompleteModes || [],
      `Tokens with incomplete modes: ${summary.incompleteModeCount || 0}`,
      (item) => `"${item.token}" missing value in: ${item.missingModes.join(", ")}`
    );

    // 10. Companion advisories (and any DS-wide role suppression)
    if (Array.isArray(gaps.suppressedAdvisoryRoles) && gaps.suppressedAdvisoryRoles.length) {
      lines.push("");
      for (const s of gaps.suppressedAdvisoryRoles) {
        lines.push(`This DS doesn't use per-role ${s.role} tokens — suppressing ${s.suppressedCount} ${s.role} advisor${s.suppressedCount === 1 ? "y" : "ies"}.`);
      }
    }
    _renderSection(
      lines,
      gaps.companionAdvisories || [],
      `Pairs missing border/icon companions (advisory): ${summary.companionAdvisoryCount || 0}`,
      (item) => {
        const roles = item.missing.map(m => m.role).join(", ");
        return `"${item.bg}" + "${item.fg}" — no ${roles}`;
      }
    );
  }

  lines.push("");
  lines.push("What this means (most urgent first):");
  const refreshCount = refresh.summary ? refresh.summary.changedCount : 0;
  const summary = (gaps && gaps.summary) || {};
  const findingCount = (summary.semanticGapCount || 0)
    + (summary.missingSemanticRoleCount || 0)
    + (summary.missingBackgroundCount || 0)
    + (summary.incompleteModeCount || 0)
    + (summary.contrastFailureCount || 0)
    + (summary.iconContrastFailureCount || 0)
    + (summary.semanticNamingConflictCount || 0)
    + (summary.brokenAliasCount || 0)
    + (summary.foundationRoleFindingCount || 0)
    + (summary.companionAdvisoryCount || 0);
  const isCleanQa = !findingCount && !gaps.error;
  if (isCleanQa && !refreshCount && !refresh.error) {
    lines.push("- Your Figma file's semantic color layer looks clean. Nothing to fix right now.");
  } else if (isCleanQa && refresh.error) {
    lines.push("- Your Figma file's semantic color layer looks clean. Create a design-system.config.js when you're ready to lock these tokens in.");
  } else {
    if (summary.brokenAliasCount) {
      const verb = summary.brokenAliasCount === 1 ? "references" : "reference";
      lines.push(`- URGENT: ${summary.brokenAliasCount} semantic token${summary.brokenAliasCount === 1 ? "" : "s"} ${verb} variables that were deleted — Figma is in a broken state.`);
    }
    if (summary.contrastFailureCount) {
      const realFails = summary.contrastFailureCount - (summary.contrastNearMissCount || 0);
      const nearFails = summary.contrastNearMissCount || 0;
      const detail = nearFails && realFails ? ` (${realFails} gross, ${nearFails} near-miss)` : nearFails ? " (all near-miss)" : "";
      const verb = summary.contrastFailureCount === 1 ? "fails" : "fail";
      lines.push(`- A11Y: ${summary.contrastFailureCount} pair${summary.contrastFailureCount === 1 ? "" : "s"} ${verb} the contrast threshold${detail}.`);
    }
    if (summary.iconContrastFailureCount) {
      const verb = summary.iconContrastFailureCount === 1 ? "fails" : "fail";
      lines.push(`- A11Y: ${summary.iconContrastFailureCount} icon role${summary.iconContrastFailureCount === 1 ? "" : "s"} ${verb} WCAG non-text contrast (3:1).`);
    }
    if (summary.semanticNamingConflictCount) {
      lines.push(`- ${summary.semanticNamingConflictCount} semantic naming conflict${summary.semanticNamingConflictCount === 1 ? "" : "s"} could represent duplicate intent. Choose a canonical path before migration/deprecation.`);
    }
    if (summary.missingSemanticRoleCount) {
      const high = summary.highConfidenceSemanticRoleGapCount || 0;
      const detail = high ? ` (${high} high-confidence)` : "";
      lines.push(`- ${summary.missingSemanticRoleCount} semantic famil${summary.missingSemanticRoleCount === 1 ? "y looks" : "ies look"} incomplete${detail}. Ask before repairing.`);
    }
    if (summary.foundationRoleFindingCount) lines.push(`- ${summary.foundationRoleFindingCount} foundational semantic role${summary.foundationRoleFindingCount === 1 ? "" : "s"} missing. These are not tied to one color family, but matter for product states like focus.`);
    if (summary.semanticGapCount) lines.push(`- ${summary.semanticGapCount} background${summary.semanticGapCount === 1 ? "" : "s"} missing a foreground companion.`);
    if (summary.missingBackgroundCount) lines.push(`- ${summary.missingBackgroundCount} foreground${summary.missingBackgroundCount === 1 ? "" : "s"} (on-*) without a matching background.`);
    if (summary.incompleteModeCount) lines.push(`- ${summary.incompleteModeCount} token${summary.incompleteModeCount === 1 ? "" : "s"} have a value in some modes but not others.`);
    if (summary.companionAdvisoryCount) lines.push(`- Advisory: ${summary.companionAdvisoryCount} pair${summary.companionAdvisoryCount === 1 ? "" : "s"} could optionally add border or icon companions.`);
    if (refreshCount) lines.push(`- Side note: your local config is out of date in ${refreshCount} place${refreshCount === 1 ? "" : "s"} compared to Figma.`);
    lines.push("- Review the lists above with your designer/agent. This is a QA report — nothing was changed.");
  }
  lines.push("");
  lines.push(NO_CHANGES);
  return lines.join("\n");
}

async function runCheckSetupGaps() {
  const state = await gatherCheckReport();
  process.stdout.write(formatCheckReport(state) + "\n");
  return state;
}

if (require.main === module) {
  runCheckSetupGaps().catch((err) => {
    process.stderr.write(`Setup gap check failed: ${err.message}\n`);
    process.stderr.write("No changes were made to Figma.\n");
    process.exit(1);
  });
}

module.exports = {
  gatherCheckReport,
  formatCheckReport,
  runCheckSetupGaps,
};
