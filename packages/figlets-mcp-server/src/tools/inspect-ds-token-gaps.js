"use strict";

const fs = require("fs");
const path = require("path");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { getActiveFileConfigPath, getConfigPathGuardError } = require("../utils/paths.js");

const inspectDsTokenGapsTool = {
  name: "inspect_ds_token_gaps",
  description:
    "Read-only planner for config-backed non-color token gaps in the active Figma snapshot. Compares design-system.config.js to existing variables/styles, reports missing typography, spacing, radius, border-width, shadow, and elevation items, and emits update_ds_tokens dry-run/apply input plus apply_ds_foundation_repairs input when required collections are absent. Never mutates Figma, config, or bridge state.",
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
        description: "Optional config-backed categories to inspect. Phase 3A supports non-color categories such as primitive-typography, primitive-shadow, spacing-semantics, radius, border-width, typography, typography-variables, typography-styles, elevation, elevation-variables, and elevation-styles."
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

const SUPPORTED_CATEGORIES = new Set(DEFAULT_CATEGORIES.concat(["typography-variables", "typography-styles", "elevation-variables", "elevation-styles"]));
const KNOWN_COLOR_CATEGORIES = new Set(["primitive-color", "color-semantics"]);
const APPLY_CATEGORIES = new Set(["radius", "border-width", "spacing-semantics", "typography-variables", "typography-styles", "elevation-variables", "elevation-styles"]);
const ORCHESTRATION_APPLY_CATEGORIES = new Set(["typography", "elevation"]);
const PRIMITIVE_APPLY_CATEGORIES = new Set(["primitive-typography", "primitive-shadow"]);

function _typographyApplySlices(context) {
  const hasTypographyVariableWork = (context.missingVariables || []).some(gap => gap.category === "typography")
    || (context.typeMismatches || []).some(gap => gap.category === "typography");
  const hasTypographyStyleWork = (context.missingStyles || []).some(gap => gap.category === "typography")
    || (context.typeMismatches || []).some(gap => gap.category === "typography" && gap.kind === "style");
  if (hasTypographyVariableWork && hasTypographyStyleWork) return ["typography-variables", "typography-styles"];
  if (hasTypographyVariableWork) return ["typography-variables"];
  if (hasTypographyStyleWork) return ["typography-styles"];
  return [];
}

function _elevationApplySlices(context) {
  const hasElevationVariableWork = (context.missingVariables || []).some(gap => gap.category === "elevation")
    || (context.typeMismatches || []).some(gap => gap.category === "elevation");
  const hasElevationStyleWork = (context.missingStyles || []).some(gap => gap.category === "elevation")
    || (context.typeMismatches || []).some(gap => gap.category === "elevation" && gap.kind === "style");
  if (hasElevationVariableWork && hasElevationStyleWork) return ["elevation-variables", "elevation-styles"];
  if (hasElevationVariableWork) return ["elevation-variables"];
  if (hasElevationStyleWork) return ["elevation-styles"];
  return [];
}

function _defaultOrchestrationExpansion(category) {
  if (category === "typography") return ["typography-variables", "typography-styles"];
  if (category === "elevation") return ["elevation-variables", "elevation-styles"];
  return [];
}

function expandTokenApplyCategories(requestedCategories, context) {
  const expanded = [];
  const seen = new Set();
  for (const category of requestedCategories || []) {
    if (ORCHESTRATION_APPLY_CATEGORIES.has(category)) {
      const slices = (context && (context.missingVariables || context.missingStyles || context.typeMismatches))
        ? (category === "typography" ? _typographyApplySlices(context) : _elevationApplySlices(context))
        : _defaultOrchestrationExpansion(category);
      const resolved = slices.length ? slices : _defaultOrchestrationExpansion(category);
      for (const slice of resolved) {
        if (!seen.has(slice)) {
          seen.add(slice);
          expanded.push(slice);
        }
      }
      continue;
    }
    if (APPLY_CATEGORIES.has(category) && !seen.has(category)) {
      seen.add(category);
      expanded.push(category);
    }
  }
  return expanded;
}

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
  if (category === "typography" || category === "typography-variables" || category === "typography-styles") return ds && ds.collections && ds.collections.typography || "3. Typography";
  if (category === "elevation" || category === "elevation-variables" || category === "elevation-styles") return ds && ds.collections && ds.collections.elevation || "5. Elevation";
  return null;
}

function _foundationKindForCategory(category) {
  if (category === "primitive-spacing" || category === "primitive-typography" || category === "primitive-shadow") return "primitives";
  if (category === "spacing-semantics" || category === "radius" || category === "border-width") return "spacing";
  if (category === "typography" || category === "typography-variables" || category === "typography-styles") return "typography";
  if (category === "elevation" || category === "elevation-variables" || category === "elevation-styles") return "elevation";
  return null;
}

function _foundationModesForKind(ds, kind) {
  if (kind === "primitives" || kind === "elevation") return ["Default"];
  const modes = ds && ds.breakpoints && Array.isArray(ds.breakpoints.modes) && ds.breakpoints.modes.length
    ? ds.breakpoints.modes
    : ["Mobile", "Tablet", "Desktop"];
  return modes.map(mode => String(mode || "").trim()).filter(Boolean);
}

function _foundationRepairForCategory(ds, category, collection) {
  const kind = _foundationKindForCategory(category);
  if (!kind || !collection) return null;
  return {
    kind,
    name: collection,
    modes: _foundationModesForKind(ds, kind),
    reason: "Create the configured " + collection + " collection shell and modes so approved token completion can add the missing variables/styles next.",
  };
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

function _expectedTypographyTokens(ds, options = {}) {
  const expected = [];
  const scale = ds && ds.typography && ds.typography.scale ? ds.typography.scale : {};
  const prefix = _typePrefix(ds);
  const collection = ds.collections && ds.collections.typography || "3. Typography";
  for (const role of Object.keys(scale).sort()) {
    const base = prefix + "/" + role;
    if (!options.stylesOnly) {
      for (const leaf of ["size", "line-height", "weight", "tracking"]) {
        _pushExpected(expected, options.category || "typography", "variable", base + "/" + leaf, { expectedType: "FLOAT", collection });
      }
      _pushExpected(expected, options.category || "typography", "variable", base + "/family", { expectedType: "STRING", collection, optional: true });
    }
    if (!options.variablesOnly) {
      _pushExpected(expected, options.category || "typography", "style", _textStyleName(ds, role), {
        styleType: "TEXT",
        collection: "local text styles",
      });
    }
  }
  return expected;
}

function _expectedElevationTokens(ds, options = {}) {
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
    _pushExpected(expected, options.category || "elevation", "variable", "elevation/" + item.key + "/offset-y", { expectedType: "FLOAT", collection });
    _pushExpected(expected, options.category || "elevation", "variable", "elevation/" + item.key + "/radius", { expectedType: "FLOAT", collection });
  }
  if (options.variablesOnly) return expected;
  if (options.stylesOnly) expected.length = 0;
  for (let i = 0; i <= 5; i++) {
    _pushExpected(expected, options.category || "elevation", "style", "elevation/" + i, {
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
  if (category === "typography-variables") return _expectedTypographyTokens(ds, { variablesOnly: true, category: "typography-variables" });
  if (category === "typography-styles") return _expectedTypographyTokens(ds, { stylesOnly: true, category: "typography-styles" });
  if (category === "elevation") return _expectedElevationTokens(ds);
  if (category === "elevation-variables") return _expectedElevationTokens(ds, { variablesOnly: true, category: "elevation-variables" });
  if (category === "elevation-styles") return _expectedElevationTokens(ds, { stylesOnly: true, category: "elevation-styles" });
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
  const foundationRepairs = [];
  const foundationRepairKeys = new Set();
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
      const foundationRepair = _foundationRepairForCategory(ds, category, requiredCollection);
      if (foundationRepair) {
        const repairKey = foundationRepair.kind + "\n" + foundationRepair.name;
        if (!foundationRepairKeys.has(repairKey)) {
          foundationRepairKeys.add(repairKey);
          foundationRepairs.push(foundationRepair);
        }
      }
      missingCapabilityNotes.push({
        kind: "missing-foundation-collection",
        category,
        collection: requiredCollection,
        repairTool: "apply_ds_foundation_repairs",
        repairReady: Boolean(foundationRepair),
        reason: "This token category needs a configured foundation collection that is not present in the synced Figma snapshot. Figlets can create the missing collection shell after designer approval, then continue token completion.",
        productGap: false,
      });
      foundationBlockedApplyCategories.add(category);
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
        } else if (options.include_existing_style_refreshes) {
          existingUpdates.push(Object.assign({}, item, {
            gapType: "existing-style-refresh",
            reason: "This config-derived style already exists and the approved style apply slice can refresh it in place while preserving the style ID.",
          }));
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
    if (APPLY_CATEGORIES.has(category) || PRIMITIVE_APPLY_CATEGORIES.has(category) || ORCHESTRATION_APPLY_CATEGORIES.has(category)) continue;
    missingCapabilityNotes.push({
      kind: "unsupported-apply-category",
      category,
      reason: "update_ds_tokens apply support is currently limited to radius, border-width, semantic spacing, typography/elevation orchestration, and the narrow typography/elevation variable/style slices. This category can be dry-run previewed, but cannot be written directly.",
      productGap: true,
    });
  }
  const repairPlan = _buildRepairPlan({
    configPath: options.configPath || null,
    categoriesWithGaps,
    foundationBlockedApplyCategories: Array.from(foundationBlockedApplyCategories),
    foundationRepairs,
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
  const applyCategorySet = new Set(categories.filter(category => APPLY_CATEGORIES.has(category) && !foundationBlocked.has(category)));
  if (categories.indexOf("typography") >= 0 && !foundationBlocked.has("typography")) {
    const typographySlices = _typographyApplySlices(context);
    if (typographySlices.length === 2) applyCategorySet.add("typography");
    else typographySlices.forEach(slice => applyCategorySet.add(slice));
  }
  if (categories.indexOf("elevation") >= 0 && !foundationBlocked.has("elevation")) {
    const elevationSlices = _elevationApplySlices(context);
    if (elevationSlices.length === 2) applyCategorySet.add("elevation");
    else elevationSlices.forEach(slice => applyCategorySet.add(slice));
  }
  const applyCategories = Array.from(applyCategorySet).sort();
  const primitiveApplyCategories = categories
    .filter(category => PRIMITIVE_APPLY_CATEGORIES.has(category))
    .filter(category =>
      (context.missingVariables || []).some(gap => gap.category === category)
      || (context.typeMismatches || []).some(gap => gap.category === category)
    )
    .sort();
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
  const foundationCollections = context.foundationRepairs || [];
  const foundationApplyInput = {
    config_path: context.configPath,
    collections: foundationCollections.map(item => ({
      kind: item.kind,
      name: item.name,
      modes: item.modes,
    })),
  };

  const primitiveRepairPlan = primitiveApplyCategories.length
    ? {
      tool: "update_ds_primitives",
      approvalRequired: true,
      previewInput: {
        config_path: context.configPath,
        categories: primitiveApplyCategories,
        create_missing: true,
        dry_run: true,
      },
      applyInput: {
        config_path: context.configPath,
        categories: primitiveApplyCategories,
        create_missing: true,
        dry_run: false,
      },
      counts: {
        categories: primitiveApplyCategories.length,
      },
      designerSummary: "Figlets can create or update primitive typography variables in "
        + (context.configPath ? "the configured Primitives collection" : "Primitives")
        + " for: " + primitiveApplyCategories.join(", ") + ".",
    }
    : null;

  return {
    tool: "update_ds_tokens",
    approvalRequired: true,
    previewInput,
    applyInput,
    primitiveRepairPlan,
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
    foundationRepairPlan: {
      tool: "apply_ds_foundation_repairs",
      approvalRequired: true,
      applyInput: foundationApplyInput,
      counts: {
        collections: foundationCollections.length,
      },
      designerSummary: foundationCollections.length
        ? "Figlets can create " + foundationCollections.length + " missing foundation collection shell" + (foundationCollections.length === 1 ? "" : "s") + " before the token update. This creates configured collections and modes only; it does not create variables or styles until the next approved update_ds_tokens step."
        : "No missing foundation collection repair is needed.",
    },
    counts: {
      missingVariables: (context.missingVariables || []).length,
      missingStyles: (context.missingStyles || []).length,
      typeMismatches: (context.typeMismatches || []).length,
      total,
      applySupportedCategories: applyCategories.length,
      optionalTotal: 0,
      foundationCollections: foundationCollections.length,
      missingCapabilityNotes: (context.missingCapabilityNotes || []).length,
    },
    missingCapabilityNotes: context.missingCapabilityNotes || [],
    designerPresentation: _buildDesignerPresentation(context, total),
    agentInstruction: total
      ? "Show repairPlan.designerPresentation in plain language. If repairPlan.foundationRepairPlan.applyInput.collections is non-empty, ask for approval and run apply_ds_foundation_repairs before token/primitive apply. If repairPlan.primitiveRepairPlan is present, run update_ds_primitives with its previewInput, show the dry-run report, ask for approval, then run primitiveRepairPlan.applyInput before or alongside update_ds_tokens apply when both are ready. Run update_ds_tokens with repairPlan.previewInput for semantic token slices. repairPlan.applyInput may include broad typography or elevation when both variable and style work exist; update_ds_tokens runs typography-variables then typography-styles (and elevation analog) in one approved call. Narrow apply categories and orchestration categories still require explicit designer approval after preview. Other categories remain dry-run/product-gap scope unless primitiveRepairPlan covers them."
      : "No update_ds_tokens payload is ready from this read-only pass. Report missingCapabilityNotes as Figlets product/tool gaps where present; do not infer tokens from arbitrary page usage or write custom Figma scripts.",
  };
}

function _buildDesignerPresentation(context, total) {
  const missingVariables = context.missingVariables || [];
  const missingStyles = context.missingStyles || [];
  const notes = context.missingCapabilityNotes || [];
  const foundationRepairs = context.foundationRepairs || [];
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
    const productGapNotes = notes.filter(note => note.productGap);
    if (foundationRepairs.length) {
      lines.push(`${foundationRepairs.length} missing foundation collection${foundationRepairs.length === 1 ? "" : "s"} can be created after approval before token completion continues.`);
      sections.push({
        title: "Foundation repair",
        message: `Figlets can create ${foundationRepairs.map(item => item.name).join(", ")} as collection shell${foundationRepairs.length === 1 ? "" : "s"} with configured modes.`,
      });
    }
    if (productGapNotes.length) {
      lines.push(`${productGapNotes.length} requested item${productGapNotes.length === 1 ? " is" : "s are"} still Figlets product/tool gap scope.`);
      sections.push({
        title: "Product gap",
        message: "Some requested categories or update comparisons are not supported by this read-only Phase 3A planner yet.",
      });
    }
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
      foundationRepairs: foundationRepairs.length,
      productGaps: notes.filter(note => note.productGap).length,
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
  expandTokenApplyCategories,
  ORCHESTRATION_APPLY_CATEGORIES,
  PRIMITIVE_APPLY_CATEGORIES,
};
