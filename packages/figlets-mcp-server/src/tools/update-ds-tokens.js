"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { getConfigPathGuardError } = require("../utils/paths.js");
const { getReceiverUrl } = require("../utils/receiver-url.js");
const { inspectDsTokenGapsFromConfigAndFigmaData } = require("./inspect-ds-token-gaps.js");

const updateDsTokensTool = {
  name: "update_ds_tokens",
  description:
    "Preview and apply narrow config-backed token completion for non-color token categories. dry_run=true reports missing variables/styles, type mismatches, and unsupported categories without mutating Figma. Phase 3C/3D apply support is intentionally limited to radius, border-width, semantic spacing, typography variables/text styles, elevation variables, and elevation effect styles.",
  inputSchema: {
    type: "object",
    properties: {
      config_path: {
        type: "string",
        description: "Absolute path to design-system.config.js."
      },
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      },
      categories: {
        type: "array",
        items: { type: "string" },
        description: "Optional categories to preview. Phase 3B supports non-color config-backed categories such as primitive-typography, primitive-shadow, spacing-semantics, radius, border-width, typography, typography-variables, typography-styles, elevation, elevation-variables, and elevation-styles."
      },
      create_missing: {
        type: "boolean",
        description: "When true, missing variables/styles are reported as wouldCreate*. When false, they remain unmatched/missing only."
      },
      dry_run: {
        type: "boolean",
        description: "When true, report what would happen without mutating Figma. When false, Phase 3C/3D apply support is limited to radius, border-width, semantic spacing, typography variables/text styles, elevation variables, and elevation effect styles."
      },
      prune: {
        type: "object",
        properties: {
          off_scale_color_steps: { type: "boolean" },
          unused_color_ramps: { type: "boolean" }
        },
        additionalProperties: false,
        description: "Future prune options. Phase 3B reports them as unsupported rather than deleting anything."
      }
    },
    required: ["config_path"],
    additionalProperties: false
  }
};

const APPLY_CATEGORIES = new Set(["radius", "border-width", "spacing-semantics", "typography-variables", "typography-styles", "elevation-variables", "elevation-styles"]);

function _readDsConfig(configPath) {
  let readDsConfig;
  try {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (err) {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  }
  return readDsConfig(configPath);
}

function _emptyCategoryReport() {
  return {
    entries: 0,
    wouldCreateVariables: [],
    createdVariables: [],
    wouldUpdateVariables: [],
    updatedVariables: [],
    wouldCreateStyles: [],
    createdStyles: [],
    wouldRefreshStyles: [],
    refreshedStyles: [],
    unmatched: [],
    typeMismatch: [],
    fontLoadFailures: [],
    bindingWarnings: [],
  };
}

function _reportForCategories(categories) {
  const report = {};
  for (const category of categories) report[category] = _emptyCategoryReport();
  return report;
}

function _pushCategoryItem(report, category, key, item) {
  if (!report[category]) report[category] = _emptyCategoryReport();
  report[category][key].push(item);
  report[category].entries += 1;
}

function _toPreviewItem(gap) {
  return {
    name: gap.name,
    kind: gap.kind,
    expectedType: gap.expectedType || undefined,
    styleType: gap.styleType || undefined,
    collection: gap.collection || undefined,
  };
}

function _buildDryRunReport(plannerResult, options) {
  const createMissing = options.create_missing !== false;
  const report = _reportForCategories(plannerResult.categories.supported || []);

  for (const gap of plannerResult.tokenGaps || []) {
    if (gap.gapType === "missing-variable") {
      _pushCategoryItem(
        report,
        gap.category,
        createMissing ? "wouldCreateVariables" : "unmatched",
        _toPreviewItem(gap)
      );
    } else if (gap.gapType === "missing-style") {
      _pushCategoryItem(
        report,
        gap.category,
        createMissing ? "wouldCreateStyles" : "unmatched",
        _toPreviewItem(gap)
      );
    } else if (gap.gapType === "type-mismatch") {
      _pushCategoryItem(report, gap.category, "typeMismatch", Object.assign(_toPreviewItem(gap), {
        actualType: gap.actualType,
      }));
    }
  }

  return report;
}

function _messageForReport(report, unknownCategories, createMissing) {
  const parts = [];
  const categories = Object.keys(report).sort();
  for (const category of categories) {
    const item = report[category];
    const createCount = item.wouldCreateVariables.length + item.wouldCreateStyles.length;
    const missingCount = item.unmatched.length;
    const mismatchCount = item.typeMismatch.length;
    if (createMissing) {
      parts.push(`${category}: ${createCount} would create, ${mismatchCount} type mismatch${mismatchCount === 1 ? "" : "es"}`);
    } else {
      parts.push(`${category}: ${missingCount} missing, ${mismatchCount} type mismatch${mismatchCount === 1 ? "" : "es"}`);
    }
  }
  if (unknownCategories && unknownCategories.length) {
    parts.push(`${unknownCategories.length} unsupported categor${unknownCategories.length === 1 ? "y" : "ies"}`);
  }
  return parts.length ? parts.join("; ") : "No config-backed token changes would be made.";
}

function _requestedCategories(args) {
  if (args && Array.isArray(args.categories) && args.categories.length) {
    const seen = new Set();
    return args.categories
      .map(item => String(item || "").trim())
      .filter(Boolean)
      .filter(item => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }
  return [];
}

function _applyUnsupportedCategories(categories) {
  return categories.filter(category => !APPLY_CATEGORIES.has(category));
}

function _handleApplyDsTokens(args, configPath, ds) {
  const categories = _requestedCategories(args);
  if (!categories.length) {
    return {
      error: "categories is required for update_ds_tokens apply. Phase 3C/3D supports only radius, border-width, semantic spacing, typography variables/text styles, elevation variables, and elevation effect styles.",
      dryRun: false,
      configPath,
      supportedApplyCategories: Array.from(APPLY_CATEGORIES).sort(),
    };
  }
  const unsupported = _applyUnsupportedCategories(categories);
  if (unsupported.length) {
    return {
      error: "update_ds_tokens apply support is limited to radius, border-width, semantic spacing, typography variables/text styles, elevation variables, and elevation effect styles in Phase 3C/3D.",
      dryRun: false,
      configPath,
      categories: categories.filter(category => APPLY_CATEGORIES.has(category)),
      unknownCategories: unsupported,
      missingCapabilityNotes: unsupported.map(category => ({
        kind: "unsupported-apply-category",
        category,
        reason: "Phase 3C/3D apply support covers radius, border-width, semantic spacing, typography variables/text styles, elevation variables, and elevation effect styles only. Other config-backed token categories remain dry-run/product-gap scope.",
        productGap: true,
      })),
    };
  }
  if (args.prune && (args.prune.off_scale_color_steps || args.prune.unused_color_ramps)) {
    return {
      error: "update_ds_tokens does not support prune/delete operations in Phase 3C.",
      dryRun: false,
      configPath,
      missingCapabilityNotes: [{
        kind: "unsupported-prune",
        reason: "Prune/delete operations are intentionally outside this approved token-completion apply slice.",
        productGap: true,
      }],
    };
  }

  const receiverUrl = getReceiverUrl();
  const body = JSON.stringify({
    DS: ds,
    categories,
    createMissing: args.create_missing !== false,
    dryRun: false,
  });

  return new Promise((resolve) => {
    const req = http.request(`${receiverUrl}/request-update-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (err) {}
          const result = parsed.result || {};
          resolve({
            dryRun: !!result.dryRun,
            categories: result.categories || categories,
            unknownCategories: result.unknownCategories || [],
            report: result.report || {},
            message: result.message || "Token update complete.",
            configPath,
            error: result.error,
            missingCapabilityNotes: result.missingCapabilityNotes || [],
            applySupported: true,
          });
        } else if (res.statusCode === 503) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (err) {}
          const retryHint = parsed.pluginRecentlySeen
            ? "The plugin was connected recently and may be finishing another action; wait a moment, then try again."
            : "Open the Figlets Bridge plugin in Figma Desktop and try again.";
          resolve({
            error: `Figma plugin is not listening for token updates. ${retryHint}`,
            activeSessionId: parsed.activeSessionId || null,
          });
        } else if (res.statusCode === 504) {
          resolve({ error: "Token update timed out — try again with the plugin open." });
        } else if (res.statusCode === 409) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (err) {}
          resolve({
            error: parsed.error || "The Figlets Bridge plugin is connected but does not advertise the token-update command. Reload the plugin from Figma Desktop so it loads the latest local code.",
            activeSessionId: parsed.activeSessionId || null,
            pluginCapabilities: parsed.pluginCapabilities || [],
          });
        } else {
          resolve({ error: `Unexpected status ${res.statusCode}` });
        }
      });
    });

    req.setTimeout(65000, () => {
      req.destroy();
      resolve({ error: "Request timed out. The plugin may still be updating — check Figma." });
    });

    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        resolve({ error: "Bridge receiver is not running. The MCP server should start it automatically — try restarting the MCP host." });
      } else {
        resolve({ error: err.message });
      }
    });

    req.write(body);
    req.end();
  });
}

function handleUpdateDsTokens(args = {}) {
  const configPath = args && args.config_path ? path.resolve(args.config_path) : null;
  if (!configPath) return { error: "config_path is required." };

  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;

  if (!fs.existsSync(configPath)) {
    return {
      error: `Config not found: ${configPath}`,
      hint: "Run sync_figma_data and prepare or create the active file-scoped design-system.config.js first.",
    };
  }

  let ds;
  try {
    ds = _readDsConfig(configPath);
  } catch (err) {
    return {
      error: err.message,
      hint: "Fix design-system.config.js or run prepare_ds_config before previewing token updates.",
      configPath,
    };
  }

  if (args.dry_run === false) {
    return _handleApplyDsTokens(args, configPath, ds);
  }

  const dataSource = args.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: args.figmaDataPath })
    : (loadActiveFigmaDataSource(args) || loadFigmaDataSource(args));
  if (!dataSource) {
    return {
      error: "No synced Figma snapshot found.",
      hint: "Run sync_figma_data first, then preview config-backed token updates again.",
    };
  }

  const pruneRequested = Boolean(args.prune && (
    args.prune.off_scale_color_steps || args.prune.unused_color_ramps
  ));
  const plannerResult = inspectDsTokenGapsFromConfigAndFigmaData(ds, dataSource.figmaData, {
    configPath,
    categories: args.categories,
    include_existing_updates: false,
  });
  const report = _buildDryRunReport(plannerResult, { create_missing: args.create_missing });
  const unknownCategories = (plannerResult.categories && plannerResult.categories.unsupported) || [];
  const missingCapabilityNotes = (plannerResult.repairPlan && plannerResult.repairPlan.missingCapabilityNotes || []).slice();
  if (pruneRequested) {
    missingCapabilityNotes.push({
      kind: "unsupported-prune",
      reason: "update_ds_tokens Phase 3B is dry-run token completion only and does not plan or apply prune/delete operations.",
      productGap: true,
    });
  }

  return {
    dryRun: true,
    categories: (plannerResult.categories && plannerResult.categories.supported) || [],
    unknownCategories,
    report,
    missingCapabilityNotes,
    message: _messageForReport(report, unknownCategories, args.create_missing !== false),
    configPath,
    snapshot: {
      kind: dataSource.kind,
      path: dataSource.meta && dataSource.meta.path || null,
      fileKey: dataSource.meta && dataSource.meta.fileKey || null,
    },
    applySupported: true,
    supportedApplyCategories: Array.from(APPLY_CATEGORIES).sort(),
    nextStep: "Show this dry-run report to the designer. If they approve radius, border-width, semantic spacing, typography variable, elevation variable, or elevation effect-style updates, call update_ds_tokens with dry_run:false for only those approved categories. Text styles, broad elevation, and other categories remain dry-run only.",
  };
}

module.exports = { updateDsTokensTool, handleUpdateDsTokens };
