"use strict";

const fs = require("fs");
const path = require("path");
const { bridgeStatusError, requestBridgePost } = require("../bridges/bridge-request.js");
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
      spacing_semantic_repairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  modeId: { type: "string" },
                  modeName: { type: "string" },
                  toAliasId: { type: "string" },
                  toAliasName: { type: "string" },
                  configExpected: { type: "number" }
                },
                additionalProperties: true
              }
            }
          },
          required: ["name", "updates"],
          additionalProperties: false
        },
        description: "Optional exact semantic spacing alias repairs copied from inspect_ds_token_gaps. When provided, update_ds_tokens applies only these token/mode entries instead of the whole spacing-semantics category."
      },
      effect_style_repairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            styleId: { type: ["string", "null"] },
            name: { type: "string" },
            bindings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  effectIndex: { type: "number" },
                  shadowRole: { type: "string" },
                  property: { type: "string" },
                  rawValue: {},
                  expectedVariable: { type: "string" },
                  expectedVariableId: { type: ["string", "null"] },
                  expectedVariableExists: { type: "boolean" }
                },
                required: ["effectIndex", "property", "expectedVariable"],
                additionalProperties: false
              }
            }
          },
          required: ["name", "bindings"],
          additionalProperties: false
        },
        description: "Optional exact elevation effect-style binding repairs copied from inspect_ds_token_gaps. Preview and apply use this audited set directly instead of rediscovering or widening the style refresh scope."
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
    styleId: gap.styleId || undefined,
    kind: gap.kind,
    expectedType: gap.expectedType || undefined,
    styleType: gap.styleType || undefined,
    collection: gap.collection || undefined,
    bindings: gap.bindings || undefined,
    reason: gap.reason || undefined,
  };
}

function _buildDryRunReport(plannerResult, options) {
  const createMissing = options.create_missing !== false;
  const report = _reportForCategories(plannerResult.categories.supported || []);
  const spacingSemanticRepairs = _normalizeSpacingSemanticRepairs(options.spacing_semantic_repairs);
  const exactSpacingRepairByName = new Map(spacingSemanticRepairs.map(repair => [repair.name, repair]));
  const exactSpacingRequested = exactSpacingRepairByName.size > 0;
  const effectStyleRepairs = _normalizeEffectStyleRepairs(options.effect_style_repairs);
  const exactEffectStyleRepairsRequested = effectStyleRepairs.length > 0;
  const rawEffectStyleCategories = new Set();

  for (const gap of plannerResult.tokenGaps || []) {
    if (exactSpacingRequested && gap.category === "spacing-semantics" && gap.gapType !== "spacing-alias-repair") {
      continue;
    }
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
      let updates = gap.updates || [];
      if (exactSpacingRequested && gap.category === "spacing-semantics") {
        const exactRepair = exactSpacingRepairByName.get(gap.name);
        if (!exactRepair) continue;
        const approvedModes = new Set((exactRepair.updates || []).map(update =>
          (update.modeId ? "id:" + update.modeId : "") + "|" + (update.modeName ? "name:" + update.modeName.toLowerCase() : "")
        ));
        updates = updates.filter(update => approvedModes.has(
          (update.modeId ? "id:" + update.modeId : "") + "|" + (update.modeName ? "name:" + String(update.modeName).toLowerCase() : "")
        ));
        if (!updates.length) continue;
      }
      _pushCategoryItem(report, gap.category, "wouldUpdateVariables", Object.assign(_toPreviewItem(gap), {
        updates,
        reason: gap.reason,
      }));
    } else if (gap.gapType === "raw-effect-style-bindings") {
      rawEffectStyleCategories.add(gap.category);
      if (!exactEffectStyleRepairsRequested) {
        _pushCategoryItem(report, gap.category, "wouldRefreshStyles", _toPreviewItem(gap));
      }
    }
  }
  if (exactEffectStyleRepairsRequested) {
    const category = report["elevation-styles"] ? "elevation-styles" : "elevation";
    for (const repair of effectStyleRepairs) {
      _pushCategoryItem(report, category, "wouldRefreshStyles", {
        name: repair.name,
        styleId: repair.styleId || undefined,
        kind: "style",
        styleType: "EFFECT",
        collection: "local effect styles",
        bindings: repair.bindings,
        reason: "Exact raw effect-style binding repair carried forward from inspect_ds_token_gaps.",
      });
    }
  }
  for (const update of plannerResult.existingUpdates || []) {
    if (update.gapType === "existing-style-refresh") {
      if (
        update.styleType === "EFFECT"
        && (exactEffectStyleRepairsRequested || rawEffectStyleCategories.has(update.category))
      ) {
        continue;
      }
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

function _normalizeSpacingSemanticRepairs(input) {
  if (!Array.isArray(input)) return [];
  const repairs = [];
  for (const repair of input) {
    if (!repair || typeof repair !== "object") continue;
    const name = String(repair.name || "").trim();
    if (!name || !Array.isArray(repair.updates)) continue;
    const updates = repair.updates
      .filter(update => update && typeof update === "object")
      .map(update => Object.assign({}, update, {
        modeId: update.modeId != null ? String(update.modeId) : undefined,
        modeName: update.modeName != null ? String(update.modeName) : undefined,
        toAliasId: update.toAliasId != null ? String(update.toAliasId) : undefined,
        toAliasName: update.toAliasName != null ? String(update.toAliasName) : undefined,
      }))
      .filter(update => update.modeId || update.modeName);
    if (updates.length) repairs.push({ name, updates });
  }
  return repairs;
}

function _hasSpacingSemanticRepairsInput(args) {
  return !!(args && Object.prototype.hasOwnProperty.call(args, "spacing_semantic_repairs"));
}

function _normalizeEffectStyleRepairs(input) {
  if (!Array.isArray(input)) return [];
  const repairs = [];
  const seen = new Set();
  for (const repair of input) {
    if (!repair || typeof repair !== "object") continue;
    const name = String(repair.name || "").trim();
    if (!/^elevation\/[1-5]$/.test(name) || seen.has(name) || !Array.isArray(repair.bindings)) continue;
    const bindings = repair.bindings
      .filter(binding => binding && typeof binding === "object")
      .map(binding => ({
        effectIndex: Number(binding.effectIndex),
        shadowRole: binding.shadowRole != null ? String(binding.shadowRole) : undefined,
        property: String(binding.property || ""),
        rawValue: binding.rawValue,
        expectedVariable: String(binding.expectedVariable || ""),
        expectedVariableId: binding.expectedVariableId != null ? String(binding.expectedVariableId) : null,
        expectedVariableExists: !!binding.expectedVariableExists,
      }))
      .filter(binding =>
        Number.isInteger(binding.effectIndex)
        && binding.effectIndex >= 0
        && ["color", "offsetY", "radius"].includes(binding.property)
        && binding.expectedVariable
      );
    if (!bindings.length) continue;
    seen.add(name);
    repairs.push({
      styleId: repair.styleId != null ? String(repair.styleId) : null,
      name,
      bindings,
    });
  }
  return repairs;
}

function _hasEffectStyleRepairsInput(args) {
  return !!(args && Object.prototype.hasOwnProperty.call(args, "effect_style_repairs"));
}

function _invalidEffectStyleRepairsError() {
  return "Invalid approval boundary: effect_style_repairs was provided but did not contain exact elevation style/binding findings copied from inspect_ds_token_gaps. Stop and rerun inspect_ds_token_gaps, then pass the exact approved effect_style_repairs entries or omit the field entirely for a full category refresh.";
}

function _invalidSpacingSemanticRepairsError() {
  return "Invalid approval boundary: spacing_semantic_repairs was provided but did not contain any exact token/mode alias repair entries copied from inspect_ds_token_gaps.repairPlan.applyInput. Stop and rerun inspect_ds_token_gaps, then pass the exact approved spacing_semantic_repairs entries or omit the field entirely for a full category apply.";
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
  if (
    _hasEffectStyleRepairsInput(args)
    && requested.length === 1
    && requested[0] === "elevation-styles"
  ) {
    return {
      requested,
      bridgeCategories: ["elevation-styles"],
      orchestratedFrom: [],
    };
  }
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

  const spacingSemanticRepairsProvided = _hasSpacingSemanticRepairsInput(args);
  const spacingSemanticRepairs = _normalizeSpacingSemanticRepairs(args.spacing_semantic_repairs);
  if (spacingSemanticRepairsProvided && resolved.bridgeCategories.indexOf("spacing-semantics") >= 0 && !spacingSemanticRepairs.length) {
    return {
      error: _invalidSpacingSemanticRepairsError(),
      dryRun: false,
      configPath,
      categories: resolved.requested,
      missingCapabilityNotes,
    };
  }
  if (args.ensure_collection_modes === true && spacingSemanticRepairs.length) {
    return {
      error: "Invalid approval boundary: update_ds_tokens cannot combine ensure_collection_modes with spacing_semantic_repairs. Apply missing collection modes with apply_ds_foundation_repairs after separate approval, then sync/reinspect and request a separate approval for the exact semantic spacing alias repairs.",
      dryRun: false,
      configPath,
      categories: resolved.requested,
      missingCapabilityNotes,
    };
  }
  const effectStyleRepairsProvided = _hasEffectStyleRepairsInput(args);
  const effectStyleRepairs = _normalizeEffectStyleRepairs(args.effect_style_repairs);
  if (effectStyleRepairsProvided && !effectStyleRepairs.length) {
    return {
      error: _invalidEffectStyleRepairsError(),
      dryRun: false,
      configPath,
      categories: resolved.requested,
      missingCapabilityNotes,
    };
  }
  if (
    effectStyleRepairsProvided
    && resolved.bridgeCategories.indexOf("elevation-styles") < 0
  ) {
    return {
      error: "Invalid approval boundary: effect_style_repairs requires the elevation-styles category.",
      dryRun: false,
      configPath,
      categories: resolved.requested,
      missingCapabilityNotes,
    };
  }

  const bridgePayload = {
    DS: bridgeDs,
    categories: resolved.bridgeCategories,
    createMissing: args.create_missing !== false,
    dryRun: false,
    ensureCollectionModes: args.ensure_collection_modes === true,
    pruneOffConfigVariables: prune.off_config_variables,
    pruneOffConfigTextStyles: prune.off_config_text_styles,
    pruneOffConfigEffectStyles: prune.off_config_effect_styles,
    pruneConfigAuthoritative: prune.config_authoritative,
  };
  if (spacingSemanticRepairsProvided) {
    bridgePayload.spacingSemanticRepairs = spacingSemanticRepairs;
  }
  if (effectStyleRepairsProvided) {
    bridgePayload.effectStyleRepairs = effectStyleRepairs;
  }

  return requestBridgePost("/request-update-tokens", bridgePayload, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
  }).then((response) => {
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
    return bridgeStatusError(response, {
      action: "token updates",
      timeoutError: "Token update timed out — try again with the plugin open.",
      conflictError: "The Figlets Bridge plugin is connected but does not advertise the token-update command. Reload the plugin from Figma Desktop so it loads the latest local code.",
    });
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
  const effectStyleRepairsProvided = _hasEffectStyleRepairsInput(args);
  const effectStyleRepairs = _normalizeEffectStyleRepairs(args.effect_style_repairs);
  if (effectStyleRepairsProvided && !effectStyleRepairs.length) {
    return {
      error: _invalidEffectStyleRepairsError(),
      dryRun: true,
      configPath,
      categories: _requestedCategories(args),
    };
  }
  const requestedCategories = _requestedCategories(args);
  if (
    effectStyleRepairsProvided
    && !requestedCategories.some(category => category === "elevation" || category === "elevation-styles")
  ) {
    return {
      error: "Invalid approval boundary: effect_style_repairs requires the elevation-styles category.",
      dryRun: true,
      configPath,
      categories: requestedCategories,
    };
  }
  if (
    effectStyleRepairsProvided
    && requestedCategories.length === 1
    && requestedCategories[0] === "elevation-styles"
  ) {
    const report = _reportForCategories(["elevation-styles"]);
    for (const repair of effectStyleRepairs) {
      _pushCategoryItem(report, "elevation-styles", "wouldRefreshStyles", {
        name: repair.name,
        styleId: repair.styleId || undefined,
        kind: "style",
        styleType: "EFFECT",
        collection: "local effect styles",
        bindings: repair.bindings,
        reason: "Exact raw effect-style binding repair carried forward from inspect_ds_token_gaps.",
      });
    }
    return {
      dryRun: true,
      categories: ["elevation-styles"],
      unknownCategories: [],
      report,
      missingCapabilityNotes: [],
      message: _messageForReport(report, [], true),
      configPath,
      snapshot: {
        kind: dataSource.kind,
        path: dataSource.meta && dataSource.meta.path || null,
        fileKey: dataSource.meta && dataSource.meta.fileKey || null,
      },
      repairSource: "inspect_ds_token_gaps.effect_style_repairs",
      applySupported: true,
      supportedApplyCategories: Array.from(SUPPORTED_APPLY_CATEGORIES).sort(),
      nextStep: "Show these exact audited effect-style repairs to the designer. After explicit approval, pass the same effect_style_repairs unchanged to update_ds_tokens with dry_run:false. Do not rediscover or widen the style set.",
    };
  }
  const plannerResult = inspectDsTokenGapsFromConfigAndFigmaData(ds, dataSource.figmaData, {
    configPath,
    categories: args.categories,
    include_existing_updates: false,
    include_existing_style_refreshes: true,
  });
  const spacingSemanticRepairsProvided = _hasSpacingSemanticRepairsInput(args);
  const spacingSemanticRepairs = _normalizeSpacingSemanticRepairs(args.spacing_semantic_repairs);
  if (
    spacingSemanticRepairsProvided
    && ((plannerResult.categories && plannerResult.categories.supported) || []).indexOf("spacing-semantics") >= 0
    && !spacingSemanticRepairs.length
  ) {
    return {
      error: _invalidSpacingSemanticRepairsError(),
      dryRun: true,
      configPath,
      categories: (plannerResult.categories && plannerResult.categories.supported) || [],
    };
  }
  const report = _buildDryRunReport(plannerResult, {
    create_missing: args.create_missing,
    spacing_semantic_repairs: args.spacing_semantic_repairs,
    effect_style_repairs: args.effect_style_repairs,
  });
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
    nextStep: "Show this dry-run report to the designer. If missingCapabilityNotes includes missing-foundation-collection or missing-foundation-modes, present foundation collection/mode creation as a separate option and approval. If approved, apply only the foundation repair, then sync and reinspect, then stop before semantic spacing or responsive token writes. Do not ask for one approval that covers both foundation repair and token apply. If they separately approve radius, border-width, semantic spacing, narrow typography/elevation slices, or broad typography/elevation orchestration, call update_ds_tokens with dry_run:false for those approved categories. Approved off-config prune uses repairPlan/preview prune flags only. Broad typography/elevation apply runs typography-variables then typography-styles (and elevation analog) in one call. Primitive/color categories belong on update_ds_primitives.",
  };
}

module.exports = { updateDsTokensTool, handleUpdateDsTokens };
