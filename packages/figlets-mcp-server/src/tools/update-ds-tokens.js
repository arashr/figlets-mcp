"use strict";

const fs = require("fs");
const path = require("path");
const { requestBridgePost } = require("../bridges/bridge-request.js");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { getConfigPathGuardError } = require("../utils/paths.js");
const {
  expandTokenApplyCategories,
  inspectDsTokenGapsFromConfigAndFigmaData,
  ORCHESTRATION_APPLY_CATEGORIES,
  planTokenPruneFromSnapshot,
} = require("./inspect-ds-token-gaps.js");
const { withEffectiveSpacingSemantic } = require("./semantic-alias-repair.js");

const updateDsTokensTool = {
  name: "update_ds_tokens",
  description:
    "Preview and apply config-backed non-color token completion. dry_run=true reports missing variables/styles, type mismatches, optional off-config prune candidates, and unsupported categories without mutating Figma. Apply supports radius, border-width, semantic spacing, narrow typography/elevation variable and style slices, broad typography/elevation orchestration, optional ensure_collection_modes, and approved off-config prune/delete for managed token variables and config-derived text/effect styles.",
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
        description: "When true, report what would happen without mutating Figma. When false, apply supports radius, border-width, semantic spacing, narrow typography/elevation slices, and broad typography/elevation orchestration."
      },
      ensure_collection_modes: {
        type: "boolean",
        description: "When true on apply, add configured breakpoint modes to existing Spacing and Typography collections before responsive token writes. Prefer inspect_ds_token_gaps.repairPlan.applyInput.ensure_collection_modes after designer approval."
      },
      prune: {
        type: "object",
        properties: {
          off_config_variables: { type: "boolean" },
          off_config_text_styles: { type: "boolean" },
          off_config_effect_styles: { type: "boolean" },
          config_authoritative: {
            type: "boolean",
            description: "Required for dry_run:false when any token prune flag is set. Confirms the active config is the full source of truth for managed token variables and styles.",
          },
          off_scale_color_steps: { type: "boolean" },
          unused_color_ramps: { type: "boolean" }
        },
        additionalProperties: false,
        description: "Optional approved prune scope. Token prune deletes managed off-config variables/styles only when config_authoritative is true on apply. Color ramp prune belongs on update_ds_primitives."
      }
    },
    required: ["config_path"],
    additionalProperties: false
  }
};

const APPLY_CATEGORIES = new Set(["radius", "border-width", "spacing-semantics", "typography-variables", "typography-styles", "elevation-variables", "elevation-styles"]);
const SUPPORTED_APPLY_CATEGORIES = new Set([...APPLY_CATEGORIES, ...ORCHESTRATION_APPLY_CATEGORIES]);

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
    } else if (gap.gapType === "spacing-alias-repair") {
      _pushCategoryItem(report, gap.category, "wouldUpdateVariables", Object.assign(_toPreviewItem(gap), {
        updates: gap.updates || [],
        reason: gap.reason,
      }));
    }
  }
  for (const update of plannerResult.existingUpdates || []) {
    if (update.gapType === "existing-style-refresh") {
      _pushCategoryItem(report, update.category, "wouldRefreshStyles", _toPreviewItem(update));
    }
  }

  return report;
}

function _messageForReport(report, unknownCategories, createMissing) {
  const parts = [];
  const categories = Object.keys(report).filter(key => key !== "prune").sort();
  for (const category of categories) {
    const item = report[category];
    const createCount = item.wouldCreateVariables.length + item.wouldCreateStyles.length;
    const updateCount = item.wouldUpdateVariables.length;
    const refreshCount = item.wouldRefreshStyles.length;
    const missingCount = item.unmatched.length;
    const mismatchCount = item.typeMismatch.length;
    if (createMissing) {
      const createPart = `${createCount} would create`;
      const updatePart = updateCount ? `, ${updateCount} would update` : "";
      const refreshPart = refreshCount ? `, ${refreshCount} would refresh` : "";
      parts.push(`${category}: ${createPart}${updatePart}${refreshPart}, ${mismatchCount} type mismatch${mismatchCount === 1 ? "" : "es"}`);
    } else {
      parts.push(`${category}: ${missingCount} missing, ${mismatchCount} type mismatch${mismatchCount === 1 ? "" : "es"}`);
    }
  }
  if (unknownCategories && unknownCategories.length) {
    parts.push(`${unknownCategories.length} unsupported categor${unknownCategories.length === 1 ? "y" : "ies"}`);
  }
  return parts.length ? parts.join("; ") : "No config-backed token changes would be made.";
}

function _normalizePruneOptions(prune) {
  if (!prune || typeof prune !== "object") return {};
  return {
    off_config_variables: !!prune.off_config_variables,
    off_config_text_styles: !!prune.off_config_text_styles,
    off_config_effect_styles: !!prune.off_config_effect_styles,
    config_authoritative: !!prune.config_authoritative,
    off_scale_color_steps: !!prune.off_scale_color_steps,
    unused_color_ramps: !!prune.unused_color_ramps,
  };
}

function _legacyColorPruneRequested(prune) {
  const normalized = _normalizePruneOptions(prune);
  return normalized.off_scale_color_steps || normalized.unused_color_ramps;
}

function _tokenPruneRequested(prune) {
  const normalized = _normalizePruneOptions(prune);
  return normalized.off_config_variables || normalized.off_config_text_styles || normalized.off_config_effect_styles;
}

function _pruneCategoriesForRequest(args, plannerCategories) {
  const requested = _requestedCategories(args);
  return requested.length ? requested : (plannerCategories || []);
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
  return categories.filter(category => !SUPPORTED_APPLY_CATEGORIES.has(category));
}

function _resolveApplyCategories(args, configPath, ds) {
  const requested = _requestedCategories(args);
  const dataSource = args.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: args.figmaDataPath })
    : (loadActiveFigmaDataSource(args) || loadFigmaDataSource(args));
  if (!dataSource) {
    return {
      requested,
      bridgeCategories: expandTokenApplyCategories(requested, null),
      orchestratedFrom: requested.filter(category => ORCHESTRATION_APPLY_CATEGORIES.has(category)),
    };
  }
  const plannerResult = inspectDsTokenGapsFromConfigAndFigmaData(ds, dataSource.figmaData, {
    configPath,
    categories: requested,
    include_existing_updates: false,
    include_existing_style_refreshes: false,
  });
  return {
    requested,
    bridgeCategories: expandTokenApplyCategories(requested, {
      missingVariables: plannerResult.tokenGaps.filter(gap => gap.gapType === "missing-variable"),
      missingStyles: plannerResult.tokenGaps.filter(gap => gap.gapType === "missing-style"),
      typeMismatches: plannerResult.tokenGaps.filter(gap => gap.gapType === "type-mismatch"),
    }),
    orchestratedFrom: requested.filter(category => ORCHESTRATION_APPLY_CATEGORIES.has(category)),
  };
}

function _handleApplyDsTokens(args, configPath, ds) {
  const categories = _requestedCategories(args);
  if (!categories.length) {
    return {
      error: "categories is required for update_ds_tokens apply. Supported apply categories include radius, border-width, semantic spacing, typography/elevation orchestration, and the narrow typography/elevation variable/style slices.",
      dryRun: false,
      configPath,
      supportedApplyCategories: Array.from(SUPPORTED_APPLY_CATEGORIES).sort(),
    };
  }
  const unsupported = _applyUnsupportedCategories(categories);
  if (unsupported.length) {
    return {
      error: "update_ds_tokens apply support is limited to radius, border-width, semantic spacing, typography/elevation orchestration, and the narrow typography/elevation variable/style slices.",
      dryRun: false,
      configPath,
      categories: categories.filter(category => SUPPORTED_APPLY_CATEGORIES.has(category)),
      unknownCategories: unsupported,
      missingCapabilityNotes: unsupported.map(category => ({
        kind: "unsupported-apply-category",
        category,
        reason: "Apply support covers radius, border-width, semantic spacing, typography/elevation orchestration, and narrow typography/elevation slices. Primitive and color categories belong on update_ds_primitives; other categories remain dry-run/product-gap scope.",
        productGap: true,
      })),
    };
  }
  const resolved = _resolveApplyCategories(args, configPath, ds);
  if (!resolved.bridgeCategories.length) {
    return {
      dryRun: false,
      configPath,
      categories: resolved.requested,
      bridgeCategories: [],
      orchestratedFrom: resolved.orchestratedFrom,
      message: "No apply-ready token categories were resolved from the requested scope.",
      applySupported: true,
    };
  }
  const prune = _normalizePruneOptions(args.prune);
  const missingCapabilityNotes = [];
  if (_legacyColorPruneRequested(prune)) {
    missingCapabilityNotes.push({
      kind: "unsupported-prune",
      reason: "Color ramp prune belongs on update_ds_primitives with prune_off_scale or prune_unused_ramps. update_ds_tokens prune only covers off-config token variables and config-derived text/effect styles.",
      productGap: false,
    });
  }
  if (_tokenPruneRequested(prune) && !categories.length) {
    return {
      error: "categories is required when prune is requested so Figlets can compute the managed config-backed keep set.",
      dryRun: false,
      configPath,
      missingCapabilityNotes,
    };
  }
  if (_tokenPruneRequested(prune) && !prune.config_authoritative) {
    return {
      error: "Token prune apply requires prune.config_authoritative=true after the designer confirms the active config is the full source of truth for managed token variables and styles.",
      dryRun: false,
      configPath,
      missingCapabilityNotes: missingCapabilityNotes.concat([{
        kind: "prune-requires-config-authoritative",
        reason: "Off-config token prune deletes managed variables/styles that exist in Figma but are absent from the active config. Set prune.config_authoritative=true only after dry-run review when the config is authoritative.",
        productGap: false,
      }]),
    };
  }

  const dataSource = args.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: args.figmaDataPath })
    : (loadActiveFigmaDataSource(args) || loadFigmaDataSource(args));
  let bridgeDs = ds;
  if (dataSource && resolved.bridgeCategories.indexOf("spacing-semantics") >= 0) {
    const variableMap = new Map();
    for (const variable of dataSource.figmaData.variables || []) {
      if (variable && typeof variable.name === "string") variableMap.set(variable.name, variable);
    }
    bridgeDs = withEffectiveSpacingSemantic(ds, dataSource.figmaData, variableMap).ds;
  }

  const needsSpacingModes = resolved.bridgeCategories.indexOf("spacing-semantics") >= 0
    && bridgeDs
    && bridgeDs.spacing
    && bridgeDs.spacing.semantic
    && Object.keys(bridgeDs.spacing.semantic).some(key => {
      const vals = bridgeDs.spacing.semantic[key];
      return Array.isArray(vals) ? vals.length > 1 : false;
    });

  return requestBridgePost("/request-update-tokens", {
    DS: bridgeDs,
    categories: resolved.bridgeCategories,
    createMissing: args.create_missing !== false,
    dryRun: false,
    ensureCollectionModes: args.ensure_collection_modes === true || needsSpacingModes,
    pruneOffConfigVariables: prune.off_config_variables,
    pruneOffConfigTextStyles: prune.off_config_text_styles,
    pruneOffConfigEffectStyles: prune.off_config_effect_styles,
    pruneConfigAuthoritative: prune.config_authoritative,
  }, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
  }).then((response) => {
    if (response.connectionError) {
      return { error: response.connectionError };
    }
    const statusCode = response.statusCode;
    const parsed = response.data || {};
    if (statusCode === 200) {
      const result = parsed.result || {};
      return {
        dryRun: !!result.dryRun,
        categories: result.categories || resolved.bridgeCategories,
        requestedCategories: resolved.requested,
        orchestratedFrom: resolved.orchestratedFrom.length ? resolved.orchestratedFrom : undefined,
        unknownCategories: result.unknownCategories || [],
        report: result.report || {},
        prune: result.prune || undefined,
        ensuredModes: result.ensuredModes || undefined,
        pruned: result.pruned,
        wouldPrune: result.wouldPrune,
        message: result.message || "Token update complete.",
        configPath,
        error: result.error,
        missingCapabilityNotes: missingCapabilityNotes.concat(result.missingCapabilityNotes || []),
        applySupported: true,
      };
    }
    if (statusCode === 503) {
      const retryHint = parsed.pluginRecentlySeen
        ? "The plugin was connected recently and may be finishing another action; wait a moment, then try again."
        : "Open the Figlets Bridge plugin in Figma Desktop and try again.";
      return {
        error: `Figma plugin is not listening for token updates. ${retryHint}`,
        activeSessionId: parsed.activeSessionId || null,
      };
    }
    if (statusCode === 504) {
      return { error: "Token update timed out — try again with the plugin open." };
    }
    if (statusCode === 409) {
      return {
        error: parsed.error || "The Figlets Bridge plugin is connected but does not advertise the token-update command. Reload the plugin from Figma Desktop so it loads the latest local code.",
        activeSessionId: parsed.activeSessionId || null,
        pluginCapabilities: parsed.pluginCapabilities || [],
      };
    }
    return { error: `Unexpected status ${statusCode}` };
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

  const prune = _normalizePruneOptions(args.prune);
  const plannerResult = inspectDsTokenGapsFromConfigAndFigmaData(ds, dataSource.figmaData, {
    configPath,
    categories: args.categories,
    include_existing_updates: false,
    include_existing_style_refreshes: true,
  });
  const report = _buildDryRunReport(plannerResult, { create_missing: args.create_missing });
  const unknownCategories = (plannerResult.categories && plannerResult.categories.unsupported) || [];
  const missingCapabilityNotes = (plannerResult.repairPlan && plannerResult.repairPlan.missingCapabilityNotes || []).slice();
  if (_legacyColorPruneRequested(prune)) {
    missingCapabilityNotes.push({
      kind: "unsupported-prune",
      reason: "Color ramp prune belongs on update_ds_primitives with prune_off_scale or prune_unused_ramps. update_ds_tokens prune only covers off-config token variables and config-derived text/effect styles.",
      productGap: false,
    });
  }
  let pruneMessage = "";
  if (_tokenPruneRequested(prune)) {
    const pruneCategories = _pruneCategoriesForRequest(args, plannerResult.categories && plannerResult.categories.supported);
    const prunePlan = planTokenPruneFromSnapshot(ds, dataSource.figmaData, pruneCategories, prune);
    report.prune = prunePlan;
    const pruneCount = prunePlan.wouldPruneVariables.length
      + prunePlan.wouldPruneTextStyles.length
      + prunePlan.wouldPruneEffectStyles.length;
    if (pruneCount) pruneMessage = `; prune: ${pruneCount} off-config managed item${pruneCount === 1 ? "" : "s"} would delete`;
    if (!prune.config_authoritative) {
      missingCapabilityNotes.push({
        kind: "prune-requires-config-authoritative",
        reason: "Dry-run prune is informational only until the designer sets prune.config_authoritative=true on apply. Figlets compares against the active config, not the full Figma file history.",
        productGap: false,
      });
    }
  }

  return {
    dryRun: true,
    categories: (plannerResult.categories && plannerResult.categories.supported) || [],
    unknownCategories,
    report,
    missingCapabilityNotes,
    message: _messageForReport(report, unknownCategories, args.create_missing !== false) + pruneMessage,
    configPath,
    snapshot: {
      kind: dataSource.kind,
      path: dataSource.meta && dataSource.meta.path || null,
      fileKey: dataSource.meta && dataSource.meta.fileKey || null,
    },
    applySupported: true,
    supportedApplyCategories: Array.from(SUPPORTED_APPLY_CATEGORIES).sort(),
    nextStep: "Show this dry-run report to the designer. If missingCapabilityNotes includes missing-foundation-collection or missing-foundation-modes, use inspect_ds_token_gaps.repairPlan.foundationRepairPlan and apply_ds_foundation_repairs after approval, or approved update_ds_tokens with ensure_collection_modes. If they approve radius, border-width, semantic spacing, narrow typography/elevation slices, or broad typography/elevation orchestration, call update_ds_tokens with dry_run:false for those approved categories. Approved off-config prune uses repairPlan/preview prune flags only. Broad typography/elevation apply runs typography-variables then typography-styles (and elevation analog) in one call. Primitive/color categories belong on update_ds_primitives.",
  };
}

module.exports = { updateDsTokensTool, handleUpdateDsTokens };
