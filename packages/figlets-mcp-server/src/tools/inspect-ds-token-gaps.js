"use strict";

const fs = require("fs");
const path = require("path");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { getActiveFileConfigPath, getConfigPathGuardError } = require("../utils/paths.js");

const inspectDsTokenGapsTool = {
  name: "inspect_ds_token_gaps",
  description:
    "Read-only planner for config-backed non-color token gaps in the active Figma snapshot. Compares design-system.config.js to existing variables/styles, reports missing typography, spacing, radius, border-width, shadow, and elevation items, and emits update_ds_tokens dry-run preview input plus future apply input. Never mutates Figma, config, or bridge state.",
  inputSchema: {
    type: "object",
    properties: {
      config_path: {
        type: "string",
        description: "Optional absolute path to design-system.config.js. Defaults to the active file-scoped config."
      },
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      },
      categories: {
        type: "array",
        items: { type: "string" },
        description: "Optional config-backed categories to inspect. Phase 3A supports non-color categories such as primitive-typography, primitive-shadow, spacing-semantics, radius, border-width, typography, and elevation."
      },
      include_existing_updates: {
        type: "boolean",
        description: "When true, request update/staleness planning in the update_ds_tokens payload. Phase 3B still reports value-diffing as a missing capability."
      }
    },
    additionalProperties: false
  }
};

const DEFAULT_CATEGORIES = [
  "primitive-spacing",
  "primitive-typography",
  "primitive-shadow",
  "spacing-semantics",
  "radius",
  "border-width",
  "typography",
  "elevation",
];

const SUPPORTED_CATEGORIES = new Set(DEFAULT_CATEGORIES);
const KNOWN_COLOR_CATEGORIES = new Set(["primitive-color", "color-semantics"]);
const APPLY_CATEGORIES = new Set(["radius", "border-width"]);

function _readDsConfig(configPath) {
  let readDsConfig;
  try {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (err) {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  }
  return readDsConfig(configPath);
}

function _generatePrimitivesData(ds) {
  let generatePrimitivesData;
  try {
    ({ generatePrimitivesData } = require("../figlets-core.js").dsConfig);
  } catch (err) {
    ({ generatePrimitivesData } = require("../figlets-core.js").dsConfig);
  }
  return generatePrimitivesData(ds);
}

function _activeConfigPath() {
  if (process.env.FIGLETS_LOCAL_DIR) {
    const localDir = process.env.FIGLETS_LOCAL_DIR;
    try {
      const activeJson = path.join(localDir, "active-file.json");
      if (fs.existsSync(activeJson)) {
        const active = JSON.parse(fs.readFileSync(activeJson, "utf8"));
        if (active && active.fileKey) return path.join(localDir, active.fileKey, "design-system.config.js");
      }
    } catch (err) {}
  }
  try { return getActiveFileConfigPath(); }
  catch (err) { return null; }
}

function _requestedCategories(input) {
  if (input && Array.isArray(input.categories) && input.categories.length) {
    const seen = new Set();
    return input.categories
      .map(item => String(item || "").trim())
      .filter(Boolean)
      .filter(item => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }
  return DEFAULT_CATEGORIES.slice();
}

function _variableNameSet(figmaData) {
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  return new Set(variables.filter(v => v && typeof v.name === "string").map(v => v.name));
}

function _variableByName(figmaData) {
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  const map = new Map();
  for (const variable of variables) {
    if (variable && typeof variable.name === "string") map.set(variable.name, variable);
  }
  return map;
}

function _styleNameSet(figmaData, key) {
  const styles = Array.isArray(figmaData && figmaData[key]) ? figmaData[key] : [];
  return new Set(styles.filter(s => s && typeof s.name === "string").map(s => s.name));
}

function _collectionNameSet(figmaData) {
  if (!Array.isArray(figmaData && figmaData.collections)) return null;
  return new Set(figmaData.collections.filter(c => c && typeof c.name === "string").map(c => c.name));
}

function _requiredCollectionForCategory(ds, category) {
  if (category === "primitive-spacing" || category === "primitive-typography" || category === "primitive-shadow") {
    return ds && ds.collections && ds.collections.primitives || "1. Primitives";
  }
  if (category === "spacing-semantics" || category === "radius" || category === "border-width") {
    return ds && ds.collections && ds.collections.spacing || "4. Spacing";
  }
  if (category === "typography") return ds && ds.collections && ds.collections.typography || "3. Typography";
  if (category === "elevation") return ds && ds.collections && ds.collections.elevation || "5. Elevation";
  return null;
}

function _sanitizeStep(step) {
  return String(step).replace(".", "-");
}

function _typePrefix(ds) {
  if (ds && ds.naming && ds.naming.typePrefix) return ds.naming.typePrefix;
  if (ds && ds.naming && ds.naming.textStyle) return String(ds.naming.textStyle).split("/")[0] || "type";
  return "type";
}

function _textStyleName(ds, role) {
  const pattern = ds && ds.naming && ds.naming.textStyle ? ds.naming.textStyle : "type/{role}/{size}";
  const parts = String(role).split("/");
  const size = parts.length > 1 ? parts[parts.length - 1] : role;
  const roleName = pattern.indexOf("{size}") >= 0 && parts.length > 1
    ? parts.slice(0, -1).join("/")
    : role;
  return pattern.replace("{role}", roleName).replace("{size}", size);
}

function _pushExpected(list, category, kind, name, extra) {
  if (!name) return;
  list.push(Object.assign({
    category,
    kind,
    name,
  }, extra || {}));
}

function _expectedPrimitiveTokens(ds, category) {
  const expected = [];
  if (category === "primitive-spacing") {
    const spacing = ds && ds.primitives && Array.isArray(ds.primitives.spacing) ? ds.primitives.spacing : [];
    for (const entry of spacing) {
      if (!Array.isArray(entry) || entry.length < 1) continue;
      _pushExpected(expected, category, "variable", "space/" + _sanitizeStep(entry[0]), {
        expectedType: "FLOAT",
        collection: ds.collections && ds.collections.primitives || "1. Primitives",
      });
    }
  }

  if (category === "primitive-typography" || category === "primitive-shadow") {
    try {
      const primitives = _generatePrimitivesData(ds);
      const typePrefix = _typePrefix(ds);
      for (const item of primitives.floats || []) {
        if (category === "primitive-typography" && !String(item.name).startsWith(typePrefix + "/")) continue;
        if (category === "primitive-shadow" && !String(item.name).startsWith("shadow/")) continue;
        _pushExpected(expected, category, "variable", item.name, {
          expectedType: "FLOAT",
          collection: primitives.collectionName,
        });
      }
      if (category === "primitive-typography") {
        for (const item of primitives.strings || []) {
          _pushExpected(expected, category, "variable", item.name, {
            expectedType: "STRING",
            collection: primitives.collectionName,
          });
        }
      }
    } catch (err) {
      _pushExpected(expected, category, "unavailable-source", category, {
        reason: "Config is missing prepared primitive data required to derive this category. Run prepare_ds_config first or add explicit config values.",
      });
    }
  }
  return expected;
}

function _expectedSpacingTokens(ds, category) {
  const expected = [];
  const spacing = ds && ds.spacing ? ds.spacing : {};
  const collection = ds.collections && ds.collections.spacing || "4. Spacing";
  if (category === "spacing-semantics") {
    const semantic = spacing.semantic || {};
    for (const key of Object.keys(semantic).sort()) {
      _pushExpected(expected, category, "variable", "space/" + key, { expectedType: "FLOAT", collection });
    }
  }
  if (category === "radius") {
    const radius = spacing.radius || {};
    for (const key of Object.keys(radius).sort()) {
      _pushExpected(expected, category, "variable", "space/radius/" + key, { expectedType: "FLOAT", collection });
    }
  }
  if (category === "border-width") {
    const border = spacing.border || {};
    for (const key of Object.keys(border).sort()) {
      _pushExpected(expected, category, "variable", "space/border/" + key, { expectedType: "FLOAT", collection });
    }
  }
  return expected;
}

function _expectedTypographyTokens(ds) {
  const expected = [];
  const scale = ds && ds.typography && ds.typography.scale ? ds.typography.scale : {};
  const prefix = _typePrefix(ds);
  const collection = ds.collections && ds.collections.typography || "3. Typography";
  for (const role of Object.keys(scale).sort()) {
    const base = prefix + "/" + role;
    for (const leaf of ["size", "line-height", "weight", "tracking"]) {
      _pushExpected(expected, "typography", "variable", base + "/" + leaf, { expectedType: "FLOAT", collection });
    }
    _pushExpected(expected, "typography", "variable", base + "/family", { expectedType: "STRING", collection, optional: true });
    _pushExpected(expected, "typography", "style", _textStyleName(ds, role), {
      styleType: "TEXT",
      collection: "local text styles",
    });
  }
  return expected;
}

function _expectedElevationTokens(ds) {
  const expected = [];
  const collection = ds.collections && ds.collections.elevation || "5. Elevation";
  const levels = [
    { level: 1, key: "xs" },
    { level: 2, key: "sm" },
    { level: 3, key: "md" },
    { level: 4, key: "lg" },
    { level: 5, key: "xl" },
  ];
  for (const item of levels) {
    _pushExpected(expected, "elevation", "variable", "elevation/" + item.key + "/offset-y", { expectedType: "FLOAT", collection });
    _pushExpected(expected, "elevation", "variable", "elevation/" + item.key + "/radius", { expectedType: "FLOAT", collection });
  }
  for (let i = 0; i <= 5; i++) {
    _pushExpected(expected, "elevation", "style", "elevation/" + i, {
      styleType: "EFFECT",
      collection: "local effect styles",
    });
  }
  return expected;
}

function _expectedForCategory(ds, category) {
  if (category === "primitive-spacing" || category === "primitive-typography" || category === "primitive-shadow") {
    return _expectedPrimitiveTokens(ds, category);
  }
  if (category === "spacing-semantics" || category === "radius" || category === "border-width") {
    return _expectedSpacingTokens(ds, category);
  }
  if (category === "typography") return _expectedTypographyTokens(ds);
  if (category === "elevation") return _expectedElevationTokens(ds);
  return [];
}

function inspectDsTokenGapsFromConfigAndFigmaData(ds, figmaData, options = {}) {
  const categories = _requestedCategories(options);
  const variableNames = _variableNameSet(figmaData);
  const variableMap = _variableByName(figmaData);
  const textStyleNames = _styleNameSet(figmaData, "textStyles");
  const effectStyleNames = _styleNameSet(figmaData, "effectStyles");
  const collectionNames = _collectionNameSet(figmaData);

  const tokenGaps = [];
  const existingUpdates = [];
  const missingCapabilityNotes = [];
  const supportedCategoriesWithGaps = new Set();
  const foundationBlockedApplyCategories = new Set();
  const supportedCategories = [];
  const unsupportedCategories = [];

  for (const category of categories) {
    if (KNOWN_COLOR_CATEGORIES.has(category)) {
      unsupportedCategories.push(category);
      missingCapabilityNotes.push({
        kind: "category-out-of-scope",
        category,
        reason: "inspect_ds_token_gaps Phase 3A is scoped to non-color config-backed token gaps. Use existing color setup and primitive/color-semantic tools for color work until update_ds_tokens supports this category.",
        productGap: true,
      });
      continue;
    }
    if (!SUPPORTED_CATEGORIES.has(category)) {
      unsupportedCategories.push(category);
      missingCapabilityNotes.push({
        kind: "unsupported-category",
        category,
        reason: "Figlets can name this requested category, but Phase 3A does not yet have a planner/apply surface for it.",
        productGap: true,
      });
      continue;
    }

    supportedCategories.push(category);
    const requiredCollection = _requiredCollectionForCategory(ds, category);
    if (collectionNames && requiredCollection && !collectionNames.has(requiredCollection)) {
      missingCapabilityNotes.push({
        kind: "missing-foundation-collection",
        category,
        collection: requiredCollection,
        reason: "This token category needs a configured foundation collection that is not present in the synced Figma snapshot. Current token completion can preview the gaps, but the guided partial setup repair path is future product scope.",
        productGap: true,
      });
      if (APPLY_CATEGORIES.has(category)) foundationBlockedApplyCategories.add(category);
    }
    const expected = _expectedForCategory(ds, category);
    for (const item of expected) {
      if (item.kind === "unavailable-source") {
        missingCapabilityNotes.push({
          kind: "unavailable-config-source",
          category,
          reason: item.reason,
          productGap: false,
        });
        continue;
      }

      if (item.kind === "style") {
        const styleSet = item.styleType === "EFFECT" ? effectStyleNames : textStyleNames;
        if (!styleSet.has(item.name)) {
          tokenGaps.push(Object.assign({}, item, { gapType: "missing-style" }));
          supportedCategoriesWithGaps.add(category);
        }
        continue;
      }

      const existing = variableMap.get(item.name);
      if (!variableNames.has(item.name)) {
        tokenGaps.push(Object.assign({}, item, { gapType: "missing-variable" }));
        supportedCategoriesWithGaps.add(category);
      } else if (existing && item.expectedType && existing.resolvedType && existing.resolvedType !== item.expectedType) {
        tokenGaps.push(Object.assign({}, item, {
          gapType: "type-mismatch",
          actualType: existing.resolvedType,
        }));
        supportedCategoriesWithGaps.add(category);
      } else if (options.include_existing_updates) {
        existingUpdates.push(Object.assign({}, item, {
          gapType: "existing-update-not-compared",
          reason: "Phase 3A records the request but does not compare live values for stale updates yet.",
        }));
      }
    }
  }

  if (options.include_existing_updates) {
    missingCapabilityNotes.push({
      kind: "existing-update-diffing",
      reason: "include_existing_updates was requested, but Phase 3A only plans missing/type-mismatched config-backed items. Value/staleness diffing is future update_ds_tokens scope.",
      productGap: true,
    });
  }

  const missingVariables = tokenGaps.filter(gap => gap.gapType === "missing-variable");
  const missingStyles = tokenGaps.filter(gap => gap.gapType === "missing-style");
  const typeMismatches = tokenGaps.filter(gap => gap.gapType === "type-mismatch");
  const categoriesWithGaps = Array.from(supportedCategoriesWithGaps).sort();
  for (const category of categoriesWithGaps) {
    if (APPLY_CATEGORIES.has(category)) continue;
    missingCapabilityNotes.push({
      kind: "unsupported-apply-category",
      category,
      reason: "update_ds_tokens apply support is currently limited to radius and border-width. This category can be dry-run previewed, but cannot be written by the Phase 3C apply path yet.",
      productGap: true,
    });
  }
  const repairPlan = _buildRepairPlan({
    configPath: options.configPath || null,
    categoriesWithGaps,
    foundationBlockedApplyCategories: Array.from(foundationBlockedApplyCategories),
    missingCapabilityNotes,
    includeExistingUpdates: !!options.include_existing_updates,
    missingVariables,
    missingStyles,
    typeMismatches,
  });
  const summary = {
    missingVariableCount: missingVariables.length,
    staleVariableCount: 0,
    missingStyleCount: missingStyles.length,
    staleStyleCount: 0,
    typeMismatchCount: typeMismatches.length,
    unsupportedCategoryCount: unsupportedCategories.length,
    inspectedCategoryCount: supportedCategories.length,
    plannedCategoryCount: categoriesWithGaps.length,
  };

  return {
    message: _composeMessage(summary),
    summary,
    repairPlan,
    topFindings: {
      missingVariables: missingVariables.slice(0, 10),
      missingStyles: missingStyles.slice(0, 10),
      typeMismatches: typeMismatches.slice(0, 10),
      unsupportedCategories,
    },
    tokenGaps,
    existingUpdates,
    categories: {
      requested: categories,
      supported: supportedCategories,
      unsupported: unsupportedCategories,
      planned: categoriesWithGaps,
    },
  };
}

function _buildRepairPlan(context) {
  const categories = context.categoriesWithGaps || [];
  const foundationBlocked = new Set(context.foundationBlockedApplyCategories || []);
  const applyCategories = categories.filter(category => APPLY_CATEGORIES.has(category) && !foundationBlocked.has(category));
  const total = (context.missingVariables || []).length + (context.missingStyles || []).length + (context.typeMismatches || []).length;
  const previewInput = {
    config_path: context.configPath,
    categories,
    create_missing: true,
    include_existing_updates: !!context.includeExistingUpdates,
    dry_run: true,
  };
  const applyInput = {
    config_path: context.configPath,
    categories: applyCategories,
    create_missing: true,
    include_existing_updates: false,
    dry_run: false,
  };

  return {
    tool: "update_ds_tokens",
    approvalRequired: true,
    previewInput,
    applyInput,
    optionalPreviewInput: {
      config_path: context.configPath,
      categories: [],
      create_missing: true,
      include_existing_updates: false,
      dry_run: true,
    },
    optionalApplyInput: {
      config_path: context.configPath,
      categories: [],
      create_missing: true,
      include_existing_updates: false,
      dry_run: false,
    },
    counts: {
      missingVariables: (context.missingVariables || []).length,
      missingStyles: (context.missingStyles || []).length,
      typeMismatches: (context.typeMismatches || []).length,
      total,
      applySupportedCategories: applyCategories.length,
      optionalTotal: 0,
      missingCapabilityNotes: (context.missingCapabilityNotes || []).length,
    },
    missingCapabilityNotes: context.missingCapabilityNotes || [],
    designerPresentation: _buildDesignerPresentation(context, total),
    agentInstruction: total
      ? "Show repairPlan.designerPresentation in plain language. Run update_ds_tokens with repairPlan.previewInput to get the dry-run report. Only repairPlan.applyInput categories are apply-supported now, and they still require explicit designer approval after preview. Other categories remain dry-run/product-gap scope."
      : "No update_ds_tokens payload is ready from this read-only pass. Report missingCapabilityNotes as Figlets product/tool gaps where present; do not infer tokens from arbitrary page usage or write custom Figma scripts.",
  };
}

function _buildDesignerPresentation(context, total) {
  const missingVariables = context.missingVariables || [];
  const missingStyles = context.missingStyles || [];
  const notes = context.missingCapabilityNotes || [];
  const lines = [];
  const sections = [];

  if (total) {
    lines.push(`I found ${total} config-backed non-color token gap${total === 1 ? "" : "s"} Figlets can plan for a future approved update.`);
    if (missingVariables.length) {
      sections.push({
        title: "Ready to preview",
        message: `Figlets can preview creation for ${missingVariables.length} missing variable${missingVariables.length === 1 ? "" : "s"} from config, including ${missingVariables.slice(0, 5).map(gap => gap.name).join(", ")}${missingVariables.length > 5 ? ", and more" : ""}.`,
      });
    }
    if (missingStyles.length) {
      sections.push({
        title: "Styles to create",
        message: `Figlets can preview ${missingStyles.length} missing text/effect style${missingStyles.length === 1 ? "" : "s"} from config.`,
      });
    }
  } else {
    lines.push("I do not see missing non-color config-backed tokens in the inspected categories.");
  }

  if (notes.length) {
    lines.push(`${notes.length} requested item${notes.length === 1 ? " is" : "s are"} still Figlets product/tool gap scope.`);
    sections.push({
      title: "Product gap",
      message: "Some requested categories or update comparisons are not supported by this read-only Phase 3A planner yet.",
    });
  }

  return {
    audience: "designer",
    tone: "plain-language",
    lines,
    sections,
    sourceFields: [
      "repairPlan.previewInput",
      "repairPlan.applyInput",
      "repairPlan.missingCapabilityNotes",
    ],
    summaryCounts: {
      readyToPreview: total,
      optional: 0,
      productGaps: notes.length,
    },
  };
}

function _composeMessage(summary) {
  const total = summary.missingVariableCount + summary.missingStyleCount + summary.typeMismatchCount;
  if (!total && !summary.unsupportedCategoryCount) {
    return "No config-backed non-color token gaps found in the inspected categories.";
  }
  const parts = [];
  if (summary.missingVariableCount) parts.push(`${summary.missingVariableCount} missing variable${summary.missingVariableCount === 1 ? "" : "s"}`);
  if (summary.missingStyleCount) parts.push(`${summary.missingStyleCount} missing style${summary.missingStyleCount === 1 ? "" : "s"}`);
  if (summary.typeMismatchCount) parts.push(`${summary.typeMismatchCount} type mismatch${summary.typeMismatchCount === 1 ? "" : "es"}`);
  if (summary.unsupportedCategoryCount) parts.push(`${summary.unsupportedCategoryCount} unsupported categor${summary.unsupportedCategoryCount === 1 ? "y" : "ies"}`);
  return `Figlets found ${parts.join(", ")} in the config-backed token planner. Read-only inspection only.`;
}

function handleInspectDsTokenGaps(input = {}) {
  const dataSource = input.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: input.figmaDataPath })
    : (loadActiveFigmaDataSource(input) || loadFigmaDataSource(input));

  if (!dataSource) {
    return {
      error: "No synced Figma snapshot found.",
      hint: "Run sync_figma_data first, then inspect config-backed token gaps again."
    };
  }

  const configPath = input.config_path ? path.resolve(input.config_path) : _activeConfigPath();
  const configStatus = {
    configPath,
    configExists: Boolean(configPath && fs.existsSync(configPath)),
    created: false,
    refreshed: false,
  };
  if (!configPath) {
    return {
      error: "No active design-system.config.js path found.",
      hint: "Run sync_figma_data for a saved Figma file, then run inspect_ds_token_gaps again."
    };
  }
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;
  if (!fs.existsSync(configPath)) {
    return {
      error: "No design-system.config.js found for token-gap inspection.",
      hint: "Run sync_figma_data first so Figlets can create or locate the active file-scoped config.",
      configPath,
    };
  }

  let ds;
  try {
    ds = _readDsConfig(configPath);
  } catch (err) {
    return {
      error: err.message,
      hint: "Fix design-system.config.js or run prepare_ds_config before inspecting token gaps.",
      configPath,
    };
  }

  const result = inspectDsTokenGapsFromConfigAndFigmaData(ds, dataSource.figmaData, {
    configPath,
    categories: input.categories,
    include_existing_updates: !!input.include_existing_updates,
  });
  result.config = {
    path: configPath,
    exists: true,
    created: Boolean(configStatus.created),
    refreshed: Boolean(configStatus.refreshed),
    sourceMode: "config-backed",
    message: configStatus.message || null,
  };
  result.snapshot = {
    kind: dataSource.kind,
    path: dataSource.meta && dataSource.meta.path || null,
    fileKey: dataSource.meta && dataSource.meta.fileKey || null,
  };
  return result;
}

module.exports = {
  inspectDsTokenGapsTool,
  handleInspectDsTokenGaps,
  inspectDsTokenGapsFromConfigAndFigmaData,
  _buildRepairPlan,
};
