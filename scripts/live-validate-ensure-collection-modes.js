#!/usr/bin/env node
// Developer-only live validation for ensure_collection_modes (roadmap item 14).
process.env.FIGLETS_DEV_BRIDGE = process.env.FIGLETS_DEV_BRIDGE || "1";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { ensureReceiverRunning, waitForPluginConnection } = require("../packages/figlets-mcp-server/src/utils/ensure-receiver.js");
const { getReceiverUrl } = require("../packages/figlets-mcp-server/src/utils/receiver-url.js");
const { handleSyncFigmaData } = require("../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
const { handleInspectDsTokenGaps } = require("../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");
const { handleUpdateDsTokens } = require("../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

const configPath = path.resolve(".local/local_mpcspbgz_7gq8yy0l/design-system.config.js");
const outDir = path.join(".local", "ensure-collection-modes-live-validation");
const spacingCollectionName = "4. Spacing";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postJson(url, body, timeoutMs) {
  const payload = JSON.stringify(body || {});
  return new Promise((resolve) => {
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (err) {}
        resolve({ statusCode: res.statusCode, body: parsed, raw: data });
      });
    });
    req.setTimeout(timeoutMs || 35000, () => {
      req.destroy();
      resolve({ statusCode: 0, body: { error: "Request timed out" } });
    });
    req.on("error", (err) => resolve({ statusCode: 0, body: { error: err.message } }));
    req.write(payload);
    req.end();
  });
}

async function trimSpacingModesToMobileOnly() {
  const receiverUrl = getReceiverUrl();
  const response = await postJson(`${receiverUrl}/request-trim-collection-modes`, {
    collectionName: spacingCollectionName,
    keepModeNames: ["Mobile"],
  }, 35000);
  if (response.statusCode === 404) {
    throw new Error(
      (response.body && response.body.error) ||
        "trim-collection-modes is disabled. Restart the bridge receiver with FIGLETS_DEV_BRIDGE=1."
    );
  }
  if (response.statusCode !== 200) {
    throw new Error(response.body.error || `Mode trim failed with status ${response.statusCode}`);
  }
  return response.body.result || response.body;
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
  if (process.env.FIGLETS_DEV_BRIDGE !== "1") {
    throw new Error("FIGLETS_DEV_BRIDGE=1 is required for this developer-only validation script.");
  }
  await ensureReceiverRunning();
  await waitForPluginConnection();
  const log = [];

  const trimmed = await trimSpacingModesToMobileOnly();
  save("00-trim-spacing-modes.json", trimmed);
  log.push({ step: "trim-spacing-modes", removedModes: trimmed.removedModes || [], keptModes: trimmed.keptModes || [] });
  if (trimmed.error) throw new Error(trimmed.error);
  if (!(trimmed.removedModes || []).length) {
    throw new Error(`Expected to remove Tablet/Desktop from ${spacingCollectionName}; got ${JSON.stringify(trimmed)}`);
  }

  await syncWithRetry();
  const inspectPrep = handleInspectDsTokenGaps({
    config_path: configPath,
    categories: ["spacing-semantics"],
  });
  save("01-inspect-after-trim.json", inspectPrep);
  log.push({
    step: "inspect-after-trim",
    missingModeNotes: (inspectPrep.repairPlan?.missingCapabilityNotes || [])
      .filter(note => note.kind === "missing-foundation-modes").length,
    ensureCollectionModes: inspectPrep.repairPlan?.applyInput?.ensure_collection_modes || false,
    applyCategories: inspectPrep.repairPlan?.applyInput?.categories || [],
  });
  if (!inspectPrep.repairPlan?.applyInput?.ensure_collection_modes) {
    throw new Error("Expected repairPlan.applyInput.ensure_collection_modes after trimming breakpoint modes");
  }
  if (inspectPrep.repairPlan.applyInput.categories.includes("spacing-semantics")) {
    throw new Error("spacing-semantics apply should stay blocked until modes are ensured");
  }

  await sleep(1500);
  const applyEnsure = await applyWithRetry({
    config_path: configPath,
    categories: ["spacing-semantics"],
    create_missing: true,
    dry_run: false,
    ensure_collection_modes: true,
  });
  save("02-apply-ensure-collection-modes.json", applyEnsure);
  log.push({
    step: "apply-ensure-collection-modes",
    error: applyEnsure.error || null,
    ensuredModes: applyEnsure.ensuredModes || [],
    createdVariables: (applyEnsure.report?.["spacing-semantics"]?.createdVariables || []).length,
    message: applyEnsure.message,
  });
  if (applyEnsure.error) throw new Error(applyEnsure.error);
  if (!(applyEnsure.ensuredModes || []).some(item => item.collection === spacingCollectionName && (item.createdModes || []).length)) {
    throw new Error(`Expected created modes on ${spacingCollectionName}; got ${JSON.stringify(applyEnsure.ensuredModes)}`);
  }

  await syncWithRetry();
  const inspectFinal = handleInspectDsTokenGaps({
    config_path: configPath,
    categories: ["spacing-semantics"],
  });
  save("03-inspect-final.json", inspectFinal);
  log.push({
    step: "inspect-final",
    missingModeNotes: (inspectFinal.repairPlan?.missingCapabilityNotes || [])
      .filter(note => note.kind === "missing-foundation-modes").length,
    applyCategories: inspectFinal.repairPlan?.applyInput?.categories || [],
    missingVariableCount: inspectFinal.summary?.missingVariableCount,
  });
  if ((inspectFinal.repairPlan?.missingCapabilityNotes || []).some(note => note.kind === "missing-foundation-modes")) {
    throw new Error("Expected missing-foundation-modes to clear after ensure_collection_modes apply");
  }

  console.log(JSON.stringify({ status: "ok", log, artifactsDir: outDir }, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
