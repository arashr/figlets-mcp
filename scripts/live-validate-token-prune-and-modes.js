#!/usr/bin/env node
// Developer live validation for roadmap item 14: token prune + ensure_collection_modes.
process.env.FIGLETS_DEV_BRIDGE = process.env.FIGLETS_DEV_BRIDGE || "1";
const fs = require("fs");
const path = require("path");
const { ensureReceiverRunning } = require("../packages/figlets-mcp-server/src/utils/ensure-receiver.js");
const { handleSyncFigmaData } = require("../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
const { handleInspectDsTokenGaps } = require("../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");
const { handleUpdateDsTokens } = require("../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

const configPath = path.resolve(".local/local_mpcspbgz_7gq8yy0l/design-system.config.js");
const outDir = path.join(".local", "token-prune-modes-live-validation");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncWithRetry() {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await handleSyncFigmaData();
      const text = result.content && result.content[0] && result.content[0].text;
      return text ? JSON.parse(text) : result;
    } catch (err) {
      if (attempt === 5) throw err;
      await sleep(2000);
    }
  }
}

function save(name, data) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2));
}

function summarizePrune(prune) {
  if (!prune) return { variables: 0, textStyles: 0, effectStyles: 0 };
  return {
    variables: (prune.wouldPruneVariables || prune.prunedVariables || []).length,
    textStyles: (prune.wouldPruneTextStyles || prune.prunedTextStyles || []).length,
    effectStyles: (prune.wouldPruneEffectStyles || prune.prunedEffectStyles || []).length,
  };
}

async function applyWithRetry(input) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await handleUpdateDsTokens(input);
    if (!result.error || !/not listening for token updates|not listening for a new command/i.test(result.error)) {
      return result;
    }
    if (attempt === 7) return result;
    await sleep(3000);
  }
}

(async () => {
  await ensureReceiverRunning();
  const log = [];

  const sync1 = await syncWithRetry();
  save("01-sync-baseline.json", sync1);
  log.push({ step: "sync-baseline", fileKey: sync1.activeFile?.fileKey });

  const inspectBaseline = handleInspectDsTokenGaps({
    config_path: configPath,
    categories: ["spacing-semantics", "typography", "elevation"],
  });
  save("02-inspect-baseline.json", inspectBaseline);
  const missingModeNotes = (inspectBaseline.repairPlan?.missingCapabilityNotes || [])
    .filter(note => note.kind === "missing-foundation-modes");
  log.push({
    step: "inspect-baseline",
    message: inspectBaseline.message,
    applyCategories: inspectBaseline.repairPlan?.applyInput?.categories || [],
    ensureCollectionModes: inspectBaseline.repairPlan?.applyInput?.ensure_collection_modes || false,
    missingFoundationModesNotes: missingModeNotes.length,
  });

  const dryRunPrune = await handleUpdateDsTokens({
    config_path: configPath,
    categories: ["spacing-semantics", "typography-variables", "typography-styles", "elevation-variables", "elevation-styles"],
    create_missing: true,
    dry_run: true,
    prune: {
      off_config_variables: true,
      off_config_text_styles: true,
      off_config_effect_styles: true,
    },
  });
  save("03-dry-run-prune.json", dryRunPrune);
  const pruneDrySummary = summarizePrune(dryRunPrune.report?.prune);
  log.push({ step: "dry-run-prune", ...pruneDrySummary, error: dryRunPrune.error || null });
  if (dryRunPrune.error) throw new Error(dryRunPrune.error);

  const dryRunEnsure = await handleUpdateDsTokens({
    config_path: configPath,
    categories: ["elevation-styles"],
    create_missing: true,
    dry_run: true,
    ensure_collection_modes: true,
  });
  save("04-dry-run-ensure-modes.json", dryRunEnsure);
  log.push({ step: "dry-run-ensure-modes-flag", error: dryRunEnsure.error || null });

  await sleep(1500);
  const applyEnsure = await applyWithRetry({
    config_path: configPath,
    categories: ["elevation-styles"],
    create_missing: true,
    dry_run: false,
    ensure_collection_modes: true,
  });
  save("05-apply-ensure-modes-plus-elevation-styles.json", applyEnsure);
  log.push({
    step: "apply-ensure-modes",
    error: applyEnsure.error || null,
    ensuredModes: applyEnsure.ensuredModes || [],
    refreshedStyles: (applyEnsure.report?.["elevation-styles"]?.refreshedStyles || []).length,
    message: applyEnsure.message,
  });
  if (applyEnsure.error) throw new Error(applyEnsure.error);

  const blockedPruneApply = await handleUpdateDsTokens({
    config_path: configPath,
    categories: ["radius"],
    dry_run: false,
    prune: { off_config_variables: true },
  });
  save("06-apply-prune-blocked-without-flag.json", blockedPruneApply);
  log.push({
    step: "apply-prune-blocked-without-config-authoritative",
    error: blockedPruneApply.error || null,
    hasGuardNote: (blockedPruneApply.missingCapabilityNotes || []).some(note => note.kind === "prune-requires-config-authoritative"),
  });
  if (!blockedPruneApply.error || !/config_authoritative/i.test(blockedPruneApply.error)) {
    throw new Error("Prune apply without config_authoritative should be blocked");
  }

  log.push({
    step: "apply-prune",
    skipped: true,
    reason: "Destructive prune apply is skipped by default. Re-run with FIGLETS_LIVE_APPLY_PRUNE=1 and prune.config_authoritative=true only after dry-run review.",
  });
  if (process.env.FIGLETS_LIVE_APPLY_PRUNE === "1" && pruneDrySummary.variables + pruneDrySummary.textStyles + pruneDrySummary.effectStyles > 0) {
    await sleep(1500);
    const applyPrune = await applyWithRetry({
      config_path: configPath,
      categories: ["spacing-semantics", "typography-variables", "typography-styles", "elevation-variables", "elevation-styles"],
      create_missing: true,
      dry_run: false,
      prune: {
        off_config_variables: true,
        off_config_text_styles: true,
        off_config_effect_styles: true,
        config_authoritative: true,
      },
    });
    save("07-apply-prune-opt-in.json", applyPrune);
    log.push({
      step: "apply-prune-opt-in",
      ...summarizePrune(applyPrune.prune),
      pruned: applyPrune.pruned,
      error: applyPrune.error || null,
    });
    if (applyPrune.error) throw new Error(applyPrune.error);
  }

  await syncWithRetry();
  const inspectFinal = handleInspectDsTokenGaps({
    config_path: configPath,
    categories: ["spacing-semantics", "typography", "elevation"],
  });
  save("07-inspect-final.json", inspectFinal);
  log.push({
    step: "inspect-final",
    message: inspectFinal.message,
    missingStyleCount: inspectFinal.summary?.missingStyleCount,
    missingVariableCount: inspectFinal.summary?.missingVariableCount,
    missingFoundationModesNotes: (inspectFinal.repairPlan?.missingCapabilityNotes || [])
      .filter(note => note.kind === "missing-foundation-modes").length,
  });

  console.log(JSON.stringify({
    status: "ok",
    log,
    artifactsDir: outDir,
  }, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
