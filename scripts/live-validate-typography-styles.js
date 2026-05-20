#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const path = require("path");
const { ensureReceiverRunning } = require("../packages/figlets-mcp-server/src/utils/ensure-receiver.js");
const { getReceiverUrl } = require("../packages/figlets-mcp-server/src/utils/receiver-url.js");
const { handleSyncFigmaData } = require("../packages/figlets-mcp-server/src/tools/sync-figma-data.js");
const { handleInspectDsTokenGaps } = require("../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");
const { handleUpdateDsTokens } = require("../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

const configPath = path.resolve(".local/local_mpcspbgz_7gq8yy0l/design-system.config.js");
const outDir = path.join(".local", "typography-styles-live-validation");
const STYLE_TO_REMOVE = "type/body/md";

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
  if (response.statusCode !== 200) {
    throw new Error(response.body.error || `Remove text styles failed with status ${response.statusCode}`);
  }
  return response.body.result || response.body;
}

async function syncWithRetry() {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await handleSyncFigmaData();
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

(async () => {
  await ensureReceiverRunning();
  const log = [];

  const removed = await removeTextStyles([STYLE_TO_REMOVE]);
  save("00-remove-text-styles.json", removed);
  log.push({ step: "remove-text-styles", removed });
  if (removed.error) throw new Error(removed.error);
  const removedOk = (removed.removedStyleNames || []).includes(STYLE_TO_REMOVE)
    || ((removed.removedTextStyles || 0) > 0 && !(removed.missingStyleNames || []).includes(STYLE_TO_REMOVE));
  if (!removedOk) {
    throw new Error(`Expected to remove ${STYLE_TO_REMOVE}; got ${JSON.stringify(removed)}. Reload the Figlets Bridge plugin if this command is unsupported.`);
  }

  await syncWithRetry();
  log.push({ step: "sync-after-remove" });

  const inspectBefore = handleInspectDsTokenGaps({ categories: ["typography"], config_path: configPath });
  save("02-inspect-typography.json", inspectBefore);
  const applyCategories = inspectBefore.repairPlan?.applyInput?.categories || [];
  log.push({
    step: "inspect-typography-before",
    missingStyles: inspectBefore.summary?.missingStyleCount,
    applyCategories,
  });
  if (!applyCategories.includes("typography-styles")) {
    throw new Error(`Expected typography-styles in applyInput; got ${JSON.stringify(applyCategories)}`);
  }

  const dryRun = await handleUpdateDsTokens({
    config_path: configPath,
    dry_run: true,
    categories: ["typography-styles"],
  });
  save("03-dry-run-typography-styles.json", dryRun);
  const dryReport = dryRun.report?.["typography-styles"] || {};
  log.push({
    step: "dry-run-typography-styles",
    wouldCreate: (dryReport.wouldCreateStyles || []).length,
    wouldRefresh: (dryReport.wouldRefreshStyles || []).length,
  });
  if (dryRun.error) throw new Error(dryRun.error);
  if ((dryReport.wouldCreateStyles || []).length < 1) {
    throw new Error(`Expected at least one would-create style for ${STYLE_TO_REMOVE}`);
  }

  const apply = await handleUpdateDsTokens({
    config_path: configPath,
    dry_run: false,
    categories: ["typography-styles"],
  });
  save("04-apply-typography-styles.json", apply);
  const applyReport = apply.report?.["typography-styles"] || {};
  const created = applyReport.createdStyles || [];
  log.push({
    step: "apply-typography-styles",
    created: created.length,
    refreshed: (applyReport.refreshedStyles || []).length,
    createdBodyMd: created.find((item) => item.name === STYLE_TO_REMOVE) || null,
    fontLoadFailures: applyReport.fontLoadFailures || [],
    bindingWarnings: applyReport.bindingWarnings || [],
  });
  if (apply.error) throw new Error(apply.error);
  if (!created.some((item) => item.name === STYLE_TO_REMOVE)) {
    throw new Error(`Apply did not create ${STYLE_TO_REMOVE}`);
  }

  await syncWithRetry();
  const inspectAfter = handleInspectDsTokenGaps({ categories: ["typography"], config_path: configPath });
  save("06-inspect-typography-final.json", inspectAfter);
  log.push({
    step: "inspect-typography-after",
    missingStyles: inspectAfter.summary?.missingStyleCount,
    applyCategories: inspectAfter.repairPlan?.applyInput?.categories || [],
  });
  if (inspectAfter.summary?.missingStyleCount !== 0) {
    throw new Error(`Expected zero missing styles after apply; got ${inspectAfter.summary?.missingStyleCount}`);
  }

  console.log(JSON.stringify({ status: "ok", log, artifactsDir: outDir }, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
