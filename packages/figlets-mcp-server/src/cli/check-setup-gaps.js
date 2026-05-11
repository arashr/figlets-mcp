const http = require("http");
const { checkPort, RECEIVER_PORT } = require("../utils/ensure-receiver.js");
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
  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || `http://127.0.0.1:${RECEIVER_PORT}`;
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

function _formatGap(gap) {
  if (gap.status !== "proposed") {
    return [`Missing foreground for "${gap.bg}" → unresolved (no matching source token found)`];
  }
  const lines = [`Missing foreground for "${gap.bg}" → would add "${gap.recommended}"`];
  if (gap.plannedAliases) {
    const parts = [];
    const upgraded = gap.plannedUpgrades || {};
    if (gap.plannedAliases.Light) parts.push(`Light → ${gap.plannedAliases.Light}${upgraded.Light ? " (upgraded for contrast)" : ""}`);
    if (gap.plannedAliases.Dark)  parts.push(`Dark → ${gap.plannedAliases.Dark}${upgraded.Dark ? " (upgraded for contrast)" : ""}`);
    if (parts.length) lines.push(`    aliases: ${parts.join(", ")}`);
  }
  lines.push(`    source: ${gap.source}`);
  return lines;
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
    lines.push(`Step 3/3 Setup gaps: could not inspect (${gaps.error})`);
    if (gaps.hint) lines.push(`  Hint: ${gaps.hint}`);
  } else {
    const total = gaps.summary ? gaps.summary.semanticGapCount : (gaps.semanticGaps ? gaps.semanticGaps.length : 0);
    if (!total) {
      lines.push("Step 3/3 Setup gaps: none found");
    } else {
      const proposed = gaps.summary ? gaps.summary.proposedCount : 0;
      const unresolved = gaps.summary ? gaps.summary.unresolvedCount : 0;
      lines.push(`Step 3/3 Setup gaps: ${total} found (${proposed} ready to repair, ${unresolved} need a designer decision)`);
      const preview = gaps.semanticGaps.slice(0, 8);
      for (const gap of preview) {
        const gapLines = _formatGap(gap);
        lines.push(`  - ${gapLines[0]}`);
        for (let i = 1; i < gapLines.length; i++) lines.push(`  ${gapLines[i]}`);
      }
      if (gaps.semanticGaps.length > preview.length) {
        lines.push(`  ...and ${gaps.semanticGaps.length - preview.length} more.`);
      }
    }
  }

  lines.push("");
  lines.push("What this means:");
  const refreshCount = refresh.summary ? refresh.summary.changedCount : 0;
  const gapCount = gaps.summary ? gaps.summary.semanticGapCount : 0;
  if (!refreshCount && !gapCount && !refresh.error && !gaps.error) {
    lines.push("- Your Figma file's setup looks clean. Nothing to repair right now.");
  } else {
    if (refreshCount) lines.push(`- Your local config is out of date in ${refreshCount} place${refreshCount === 1 ? "" : "s"} compared to Figma.`);
    if (gapCount) lines.push(`- Figma has ${gapCount} semantic token${gapCount === 1 ? "" : "s"} that could use a foreground companion.`);
    lines.push("- Review the list above with your designer/agent before applying any repairs.");
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
