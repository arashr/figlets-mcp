#!/usr/bin/env node
// Developer-only live validation for broad typography/elevation orchestration (roadmap item 13).
process.env.FIGLETS_DEV_BRIDGE = process.env.FIGLETS_DEV_BRIDGE || "1";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { ensureReceiverRunning } = require("../packages/figlets-mcp-server/src/utils/ensure-receiver.js");
const { getReceiverUrl } = require("../packages/figlets-mcp-server/src/utils/receiver-url.js");
const { handleSyncFigmaData } = require("../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
const { handleInspectDsTokenGaps } = require("../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");
const { handleUpdateDsTokens } = require("../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

const configPath = path.resolve(".local/local_mpcspbgz_7gq8yy0l/design-system.config.js");
const outDir = path.join(".local", "broad-orchestration-live-validation");
const STYLE_TO_REMOVE = "type/body/md";
const ELEVATION_STYLES = ["elevation/0", "elevation/1", "elevation/2", "elevation/3", "elevation/4", "elevation/5"];

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
    req.setTimeout(timeoutMs || 65000, () => {
      req.destroy();
      resolve({ statusCode: 0, body: { error: "Request timed out" } });
    });
    req.on("error", (err) => resolve({ statusCode: 0, body: { error: err.message } }));
    req.write(payload);
    req.end();
  });
}

async function removeTextStyles(names) {
  const receiverUrl = getReceiverUrl();
  const response = await postJson(`${receiverUrl}/request-remove-text-styles`, { names }, 35000);
  if (response.statusCode === 404) {
    throw new Error(
      (response.body && response.body.error) ||
        "remove-text-styles is disabled. Restart the bridge receiver with FIGLETS_DEV_BRIDGE=1."
    );
  }
  if (response.statusCode !== 200) {
    throw new Error(response.body.error || `Remove text styles failed with status ${response.statusCode}`);
  }
  return response.body.result || response.body;
}

async function syncWithRetry() {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await handleSyncFigmaData();
      const text = result.content && result.content[0] && result.content[0].text;
      if (text) return JSON.parse(text);
      return result;
    } catch (err) {
      if (attempt === 5) throw err;
      await sleep(2000);
    }
  }
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

function save(name, data) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2));
}

function inspect(categories) {
  return handleInspectDsTokenGaps({ categories, config_path: configPath });
}

function summarizeInspect(label, result) {
  return {
    label,
    message: result.message,
    summary: result.summary,
    applyCategories: result.repairPlan?.applyInput?.categories || [],
    previewCategories: result.repairPlan?.previewInput?.categories || [],
  };
}

function summarizeApply(label, result) {
  const report = result.report || {};
  const sliceKeys = Object.keys(report);
  return {
    label,
    error: result.error || null,
    dryRun: result.dryRun,
    categories: result.categories,
    requestedCategories: result.requestedCategories,
    orchestratedFrom: result.orchestratedFrom,
    sliceKeys,
    refreshedStyles: sliceKeys.reduce((n, key) => n + (report[key].refreshedStyles || []).length, 0),
    createdStyles: sliceKeys.reduce((n, key) => n + (report[key].createdStyles || []).length, 0),
    createdVariables: sliceKeys.reduce((n, key) => n + (report[key].createdVariables || []).length, 0),
    bindingWarnings: sliceKeys.flatMap((key) => report[key].bindingWarnings || []),
    fontLoadFailures: sliceKeys.flatMap((key) => report[key].fontLoadFailures || []),
  };
}

function assertBroadDryRun(category, result) {
  if (result.error) throw new Error(result.error);
  const report = result.report || {};
  const broad = report[category];
  const variableSlice = report[`${category}-variables`];
  const styleSlice = report[`${category}-styles`];
  const refreshCount = (broad && broad.wouldRefreshStyles ? broad.wouldRefreshStyles.length : 0)
    + (styleSlice && styleSlice.wouldRefreshStyles ? styleSlice.wouldRefreshStyles.length : 0);
  const createCount = ((broad && broad.wouldCreateStyles) ? broad.wouldCreateStyles.length : 0)
    + ((broad && broad.wouldCreateVariables) ? broad.wouldCreateVariables.length : 0)
    + ((variableSlice && variableSlice.wouldCreateVariables) ? variableSlice.wouldCreateVariables.length : 0)
    + ((styleSlice && styleSlice.wouldCreateStyles) ? styleSlice.wouldCreateStyles.length : 0);
  if (!refreshCount && !createCount) {
    throw new Error(`Broad ${category} dry-run reported no refresh or create work`);
  }
}

function assertBroadLiveApply(category, result, options) {
  if (result.error) throw new Error(result.error);
  if (!result.orchestratedFrom || !result.orchestratedFrom.includes(category)) {
    throw new Error(`Expected orchestratedFrom to include ${category}; got ${JSON.stringify(result.orchestratedFrom)}`);
  }
  const categories = result.categories || [];
  if (!categories.length) {
    throw new Error(`Expected at least one resolved slice for broad ${category}; got []`);
  }
  const expectedSlices = options && options.expectedSlices
    ? options.expectedSlices
    : [`${category}-variables`, `${category}-styles`];
  if (!expectedSlices.every((slice) => categories.includes(slice))) {
    throw new Error(`Expected live apply to run ${expectedSlices.join(" and ")}; got ${JSON.stringify(categories)}`);
  }
}

(async () => {
  if (process.env.FIGLETS_DEV_BRIDGE !== "1") {
    throw new Error("FIGLETS_DEV_BRIDGE=1 is required for this developer-only validation script.");
  }
  await ensureReceiverRunning();
  const log = [];

  // --- Step 1: sync ---
  const sync1 = await syncWithRetry();
  save("01-sync-baseline.json", sync1);
  log.push({ step: "sync-baseline", fileKey: sync1.activeFile?.fileKey });

  // --- Step 2: inspect typography + elevation ---
  const inspectBaseline = inspect(["typography", "elevation"]);
  save("02-inspect-baseline.json", inspectBaseline);
  const baselineSummary = summarizeInspect("baseline", inspectBaseline);
  log.push({ step: "inspect-baseline", ...baselineSummary });

  // --- Step 3: dry-run from repairPlan.previewInput ---
  const previewInput = inspectBaseline.repairPlan?.previewInput || {
    config_path: configPath,
    categories: ["typography", "elevation"],
    create_missing: true,
    dry_run: true,
  };
  const dryRunPreview = await handleUpdateDsTokens(previewInput);
  save("03-dry-run-preview-input.json", dryRunPreview);
  log.push({ step: "dry-run-preview-input", ...summarizeApply("preview-input", dryRunPreview) });
  if (dryRunPreview.error) throw new Error(dryRunPreview.error);

  // --- Step 4a: broad orchestration apply on complete file (refresh path) ---
  for (const category of ["typography", "elevation"]) {
    const dryBroad = await handleUpdateDsTokens({
      config_path: configPath,
      categories: [category],
      create_missing: true,
      dry_run: true,
    });
    save(`04-dry-run-broad-${category}.json`, dryBroad);
    log.push({ step: `dry-run-broad-${category}`, ...summarizeApply(`broad-${category}`, dryBroad) });
    assertBroadDryRun(category, dryBroad);

    await sleep(1500);
    const applyBroad = await applyWithRetry({
      config_path: configPath,
      categories: [category],
      create_missing: true,
      dry_run: false,
    });
    save(`05-apply-broad-${category}.json`, applyBroad);
    log.push({ step: `apply-broad-${category}`, ...summarizeApply(`apply-broad-${category}`, applyBroad) });
    assertBroadLiveApply(category, applyBroad);
  }

  const syncAfterBroad = await syncWithRetry();
  save("06-sync-after-broad-refresh.json", syncAfterBroad);
  const inspectAfterBroad = inspect(["typography", "elevation"]);
  save("07-inspect-after-broad-refresh.json", inspectAfterBroad);
  log.push({
    step: "inspect-after-broad-refresh",
    ...summarizeInspect("after-broad-refresh", inspectAfterBroad),
  });
  if (inspectAfterBroad.summary?.missingVariableCount !== 0 || inspectAfterBroad.summary?.missingStyleCount !== 0) {
    throw new Error(`Expected complete file after broad refresh; summary=${JSON.stringify(inspectAfterBroad.summary)}`);
  }

  // --- Step 4b: prep typography style gap + apply via broad orchestration ---
  const removed = await removeTextStyles([STYLE_TO_REMOVE]);
  save("08-remove-text-styles.json", removed);
  log.push({ step: "remove-text-styles", removedStyleNames: removed.removedStyleNames || [] });
  if (removed.error) throw new Error(removed.error);

  await syncWithRetry();
  const inspectPrep = inspect(["typography"]);
  save("09-inspect-typography-prep.json", inspectPrep);
  log.push({ step: "inspect-typography-prep", ...summarizeInspect("typography-prep", inspectPrep) });
  const prepApply = inspectPrep.repairPlan?.applyInput?.categories || [];
  if (!prepApply.includes("typography-styles")) {
    throw new Error(`Expected typography-styles in applyInput after prep; got ${JSON.stringify(prepApply)}`);
  }

  const dryPrep = await handleUpdateDsTokens({
    config_path: configPath,
    categories: ["typography"],
    create_missing: true,
    dry_run: true,
  });
  save("10-dry-run-broad-typography-prep.json", dryPrep);
  log.push({ step: "dry-run-broad-typography-prep", ...summarizeApply("prep-broad", dryPrep) });
  const prepWouldCreate = (dryPrep.report?.typography?.wouldCreateStyles || [])
    .concat(dryPrep.report?.["typography-styles"]?.wouldCreateStyles || []);
  if (dryPrep.error) throw new Error(dryPrep.error);
  if (!prepWouldCreate.some((item) => item.name === STYLE_TO_REMOVE)) {
    throw new Error(`Broad typography dry-run should preview creating ${STYLE_TO_REMOVE}`);
  }

  await sleep(1500);
  const applyPrep = await applyWithRetry({
    config_path: configPath,
    categories: ["typography"],
    create_missing: true,
    dry_run: false,
  });
  save("11-apply-broad-typography-prep.json", applyPrep);
  const createdBody = (applyPrep.report?.["typography-styles"]?.createdStyles || [])
    .find((item) => item.name === STYLE_TO_REMOVE);
  log.push({
    step: "apply-broad-typography-prep",
    ...summarizeApply("apply-broad-prep", applyPrep),
    createdBodyMd: createdBody || null,
  });
  assertBroadLiveApply("typography", applyPrep, { expectedSlices: ["typography-styles"] });
  if (!createdBody) throw new Error(`Broad typography apply did not recreate ${STYLE_TO_REMOVE}`);

  await syncWithRetry();
  const inspectFinal = inspect(["typography", "elevation"]);
  save("12-inspect-final.json", inspectFinal);
  log.push({ step: "inspect-final", ...summarizeInspect("final", inspectFinal) });
  if (inspectFinal.summary?.missingStyleCount !== 0) {
    throw new Error(`Expected zero missing styles after typography prep apply; got ${inspectFinal.summary?.missingStyleCount}`);
  }

  console.log(JSON.stringify({
    status: "ok",
    note: "Disposable file was complete at baseline; broad applyInput with both variable and style gaps was not reproducer-ready without destructive reset. Broad orchestration expansion and typography prep apply were validated live.",
    log,
    artifactsDir: outDir,
  }, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
