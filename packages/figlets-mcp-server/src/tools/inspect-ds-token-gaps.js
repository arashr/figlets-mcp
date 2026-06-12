"use strict";

const fs = require("fs");
const path = require("path");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { getActiveFileConfigPath, getConfigPathGuardError } = require("../utils/paths.js");
const {
  SEMANTIC_ALIAS_REPAIR_MODEL,
  buildPrimitiveSpacingLookup,
  planSpacingSemanticAliasRepairs,
  resolvePrimitiveAliasTarget,
  withEffectiveSpacingSemantic,
} = require("./semantic-alias-repair.js");

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

function _isAliasValue(value) {
  return Boolean(value && typeof value === "object" && value.type === "VARIABLE_ALIAS" && typeof value.id === "string");
}

function _spacingRepairSourceKind(update) {
  if (!update) return "unknown";
  if (_isAliasValue(update.from)) return "alias-retarget";
  const numeric = Number(update.from);
  if (Number.isFinite(numeric)) return "raw-value";
  return "unknown";
}

function _spacingRepairBreakdown(spacingRepairs) {
  const rawValueTokens = new Set();
  const aliasRetargetTokens = new Set();
  const unknownTokens = new Set();
  let rawValueUpdates = 0;
  let aliasRetargetUpdates = 0;
  let unknownUpdates = 0;
  let totalUpdates = 0;

  for (const repair of spacingRepairs || []) {
    for (const update of repair.updates || []) {
      totalUpdates += 1;
      const kind = _spacingRepairSourceKind(update);
      if (kind === "raw-value") {
        rawValueUpdates += 1;
        rawValueTokens.add(repair.name);
      } else if (kind === "alias-retarget") {
        aliasRetargetUpdates += 1;
        aliasRetargetTokens.add(repair.name);
      } else {
        unknownUpdates += 1;
        unknownTokens.add(repair.name);
      }
    }
  }

  return {
    repairTokens: (spacingRepairs || []).length,
    repairUpdates: totalUpdates,
    rawValueTokens: rawValueTokens.size,
    rawValueUpdates,
    aliasRetargetTokens: aliasRetargetTokens.size,
    aliasRetargetUpdates,
    unknownTokens: unknownTokens.size,
    unknownUpdates,
  };
}

function _plural(noun, count) {
  if (noun === "alias") return String(count) + " " + (count === 1 ? "alias" : "aliases");
  return String(count) + " " + noun + (count === 1 ? "" : "s");
}

function _spacingRepairBreakdownSentence(breakdown) {
  const parts = [];
  if (breakdown.rawValueUpdates) {
    parts.push(_plural("raw value", breakdown.rawValueUpdates) + " to convert to primitive aliases");
  }
  if (breakdown.aliasRetargetUpdates) {
    parts.push(_plural("alias", breakdown.aliasRetargetUpdates).replace(/^(\d+) /, "$1 existing ") + " to retarget to the config-matched primitive");
  }
  if (breakdown.unknownUpdates) {
    parts.push(_plural("repair", breakdown.unknownUpdates) + " with an unknown current value shape");
  }
  return parts.join(", ");
}

function _spacingAliasRepairReason(updates) {
  const breakdown = _spacingRepairBreakdown([{ name: "semantic-spacing", updates: updates || [] }]);
  if (breakdown.rawValueUpdates && !breakdown.aliasRetargetUpdates && !breakdown.unknownUpdates) {
    return "This semantic spacing variable has raw value mode(s) that match config and can alias to existing primitive spacing variables.";
  }
  if (breakdown.aliasRetargetUpdates && !breakdown.rawValueUpdates && !breakdown.unknownUpdates) {
    return "This semantic spacing variable is already aliased, but one or more modes point to a primitive that does not match the config-backed semantic value.";
  }
  return "This semantic spacing variable has mode-level alias repairs, including raw value conversion or existing alias retargeting to match config.";
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

function _collectionRecordByName(figmaData, collectionName) {
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  for (const collection of collections) {
    if (collection && collection.name === collectionName) return collection;
  }
  return null;
}

function _collectionModeNames(collectionRecord) {
  const modes = collectionRecord && Array.isArray(collectionRecord.modes) ? collectionRecord.modes : [];
  return modes.map(mode => String(mode && mode.name || "").trim()).filter(Boolean);
}

function _missingFoundationModes(ds, kind, collectionName, figmaData) {
  const record = _collectionRecordByName(figmaData, collectionName);
  if (!record) return [];
  const actualNames = _collectionModeNames(record);
  if (!actualNames.length) return [];
  const expected = _foundationModesForKind(ds, kind);
  const actual = new Set(actualNames);
  return expected.filter(mode => !actual.has(mode));
}

const PRUNE_VARIABLE_PREFIXES_BY_COLLECTION = {
  spacing: ["space/"],
  typography: null,
  elevation: ["elevation/"],
};

function _variableCollectionNameMap(figmaData) {
  const map = new Map();
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  for (const collection of collections) {
    if (!collection || !collection.name) continue;
    const variableIds = Array.isArray(collection.variableIds) ? collection.variableIds : [];
    for (const variableId of variableIds) map.set(variableId, collection.name);
  }
  return map;
}

function _expectedManagedNamesForCategories(ds, categories) {
  const variableNames = new Set();
  const textStyleNames = new Set();
  const effectStyleNames = new Set();
  for (const category of categories || []) {
    for (const item of _expectedForCategory(ds, category)) {
      if (!item || !item.name || item.kind === "unavailable-source") continue;
      if (item.kind === "variable") variableNames.add(item.name);
      if (item.kind === "style" && item.styleType === "TEXT") textStyleNames.add(item.name);
      if (item.kind === "style" && item.styleType === "EFFECT") effectStyleNames.add(item.name);
    }
  }
  return { variableNames, textStyleNames, effectStyleNames };
}

function _managedVariablePrefixes(ds, collectionName) {
  if (collectionName === (ds && ds.collections && ds.collections.spacing) || collectionName === "4. Spacing") {
    return PRUNE_VARIABLE_PREFIXES_BY_COLLECTION.spacing;
  }
  if (collectionName === (ds && ds.collections && ds.collections.typography) || collectionName === "3. Typography") {
    return [_typePrefix(ds) + "/"];
  }
  if (collectionName === (ds && ds.collections && ds.collections.elevation) || collectionName === "5. Elevation") {
    return PRUNE_VARIABLE_PREFIXES_BY_COLLECTION.elevation;
  }
  return [];
}

function _nameMatchesManagedPrefixes(name, prefixes) {
  if (!prefixes || !prefixes.length) return false;
  for (const prefix of prefixes) {
    if (String(name || "").indexOf(prefix) === 0) return true;
  }
  return false;
}

function planTokenPruneFromSnapshot(ds, figmaData, categories, pruneOptions) {
  const options = pruneOptions || {};
  const pruneVariables = !!options.off_config_variables;
  const pruneTextStyles = !!options.off_config_text_styles;
  const pruneEffectStyles = !!options.off_config_effect_styles;
  if (!pruneVariables && !pruneTextStyles && !pruneEffectStyles) {
    return { wouldPruneVariables: [], wouldPruneTextStyles: [], wouldPruneEffectStyles: [] };
  }

  const expected = _expectedManagedNamesForCategories(ds, categories);
  const collectionByVariableId = _variableCollectionNameMap(figmaData);
  const wouldPruneVariables = [];
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];

  if (pruneVariables) {
    for (const variable of variables) {
      if (!variable || !variable.name || !variable.id) continue;
      const collectionName = collectionByVariableId.get(variable.id);
      if (!collectionName) continue;
      const prefixes = _managedVariablePrefixes(ds, collectionName);
      if (!_nameMatchesManagedPrefixes(variable.name, prefixes)) continue;
      if (expected.variableNames.has(variable.name)) continue;
      wouldPruneVariables.push({
        name: variable.name,
        kind: "variable",
        expectedType: variable.resolvedType || undefined,
        collection: collectionName,
      });
    }
  }

  const wouldPruneTextStyles = [];
  if (pruneTextStyles) {
    const textStyles = Array.isArray(figmaData && figmaData.textStyles) ? figmaData.textStyles : [];
    const typePrefix = _typePrefix(ds) + "/";
    for (const style of textStyles) {
      if (!style || !style.name) continue;
      if (String(style.name).indexOf(typePrefix) !== 0) continue;
      if (expected.textStyleNames.has(style.name)) continue;
      wouldPruneTextStyles.push({
        name: style.name,
        kind: "style",
        styleType: "TEXT",
        collection: "local text styles",
      });
    }
  }

  const wouldPruneEffectStyles = [];
  if (pruneEffectStyles) {
    const effectStyles = Array.isArray(figmaData && figmaData.effectStyles) ? figmaData.effectStyles : [];
    for (const style of effectStyles) {
      if (!style || !style.name) continue;
      if (!/^elevation\/\d+$/.test(style.name)) continue;
      if (expected.effectStyleNames.has(style.name)) continue;
      wouldPruneEffectStyles.push({
        name: style.name,
        kind: "style",
        styleType: "EFFECT",
        collection: "local effect styles",
      });
    }
  }

  return { wouldPruneVariables, wouldPruneTextStyles, wouldPruneEffectStyles };
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
  const spacingEffective = withEffectiveSpacingSemantic(ds, figmaData, variableMap);
  const planningDs = spacingEffective.ds;
  const spacingAliasPlan = planSpacingSemanticAliasRepairs(ds, figmaData, variableMap, {
    effectiveDs: planningDs,
    spacingSemanticMeta: spacingEffective.spacingSemanticMeta,
  });
  const spacingAliasRepairByName = new Map(spacingAliasPlan.repairs.map(item => [item.name, item]));
  const spacingAliasDriftByName = new Map(spacingAliasPlan.configDrift.map(item => [item.name, item]));

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
        reason: "This token category needs a configured foundation collection that is not present in the synced Figma snapshot. Present foundation collection creation as a separate option. If the designer approves it, create only the missing collection shell, then sync and reinspect, then stop before any token apply.",
        productGap: false,
      });
      foundationBlockedApplyCategories.add(category);
    } else if (collectionNames && requiredCollection && collectionNames.has(requiredCollection)) {
      const kind = _foundationKindForCategory(category);
      const missingModes = kind ? _missingFoundationModes(ds, kind, requiredCollection, figmaData) : [];
      if (missingModes.length) {
        const foundationRepair = _foundationRepairForCategory(ds, category, requiredCollection);
        if (foundationRepair) {
          const repairKey = foundationRepair.kind + "\n" + foundationRepair.name;
          if (!foundationRepairKeys.has(repairKey)) {
            foundationRepairKeys.add(repairKey);
            foundationRepairs.push(Object.assign({}, foundationRepair, {
              missingModes,
              reason: "Add configured breakpoint modes to " + requiredCollection + " before responsive token completion can map values correctly.",
            }));
          }
        }
        missingCapabilityNotes.push({
          kind: "missing-foundation-modes",
          category,
          collection: requiredCollection,
          missingModes,
          repairTool: "apply_ds_foundation_repairs",
          repairReady: Boolean(foundationRepair),
          reason: "This token category needs configured breakpoint modes on " + requiredCollection + ". Present mode creation as a separate option. If the designer approves it, run only apply_ds_foundation_repairs, then sync and reinspect, then stop before any token apply.",
          productGap: false,
        });
        if (
          (category === "spacing-semantics" && !(spacingAliasPlan.repairs || []).length)
          || category === "typography-variables"
          || category === "typography-styles"
        ) {
          foundationBlockedApplyCategories.add(category);
        }
        if (category === "typography") {
          foundationBlockedApplyCategories.add("typography");
        }
      }
    }
    const expected = _expectedForCategory(category === "spacing-semantics" ? planningDs : ds, category);
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
      if (category === "spacing-semantics" && existing && existing.resolvedType === item.expectedType) {
        const plannedAliasRepair = spacingAliasRepairByName.get(item.name);
        if (plannedAliasRepair) {
          tokenGaps.push(Object.assign({}, item, {
            gapType: "spacing-alias-repair",
            kind: "variable",
            updates: plannedAliasRepair.updates,
            reason: _spacingAliasRepairReason(plannedAliasRepair.updates),
          }));
          supportedCategoriesWithGaps.add(category);
        }
        const plannedDrift = spacingAliasDriftByName.get(item.name);
        if (plannedDrift) {
          tokenGaps.push(Object.assign({}, item, {
            gapType: "spacing-alias-config-drift",
            kind: "variable",
            driftModes: plannedDrift.modes,
            reason: "Figma raw values differ from config for one or more modes. Resolve drift before Figlets can propose primitive aliases.",
          }));
          supportedCategoriesWithGaps.add(category);
        }
      }
    }
  }

  if (categories.indexOf("spacing-semantics") >= 0) {
    const spacingGapNames = new Set(
      tokenGaps.filter(gap => gap.category === "spacing-semantics").map(gap => gap.name)
    );
    const spacingCollection = _requiredCollectionForCategory(planningDs, "spacing-semantics");
    for (const repair of spacingAliasPlan.repairs) {
      if (spacingGapNames.has(repair.name)) continue;
      tokenGaps.push({
        name: repair.name,
        category: "spacing-semantics",
        kind: "variable",
        expectedType: "FLOAT",
        collection: spacingCollection,
        gapType: "spacing-alias-repair",
        updates: repair.updates,
        reason: _spacingAliasRepairReason(repair.updates),
      });
      spacingGapNames.add(repair.name);
      supportedCategoriesWithGaps.add("spacing-semantics");
    }
    for (const drift of spacingAliasPlan.configDrift) {
      if (spacingGapNames.has(drift.name)) continue;
      tokenGaps.push({
        name: drift.name,
        category: "spacing-semantics",
        kind: "variable",
        expectedType: "FLOAT",
        collection: spacingCollection,
        gapType: "spacing-alias-config-drift",
        driftModes: drift.modes,
        reason: "Figma raw values differ from config for one or more modes. Resolve drift before Figlets can propose primitive aliases.",
      });
      spacingGapNames.add(drift.name);
      supportedCategoriesWithGaps.add("spacing-semantics");
    }
    for (const missing of spacingAliasPlan.missingPrimitives) {
      missingCapabilityNotes.push({
        kind: "missing-primitive-for-alias-repair",
        category: "spacing-semantics",
        token: missing.name,
        modes: missing.modes,
        reason: "Matching primitive spacing variable(s) are missing for config-backed semantic values. Create them with update_ds_primitives before semantic alias repair.",
        productGap: false,
      });
    }
    if (Array.isArray(spacingAliasPlan.alreadyAliasedHealthy) && spacingAliasPlan.alreadyAliasedHealthy.length) {
      missingCapabilityNotes.push({
        kind: "spacing-semantics-already-healthy",
        category: "spacing-semantics",
        tokenCount: spacingAliasPlan.alreadyAliasedHealthy.length,
        tokens: spacingAliasPlan.alreadyAliasedHealthy.slice(0, 12).map(item => item.name),
        reason: spacingAliasPlan.alreadyAliasedHealthy.length + " semantic spacing token(s) already alias to primitives with the correct pixel values for each breakpoint mode. They are not alias-repair gaps and should not be reported as missing primitives. Alias health does not, by itself, validate responsive spacing decisions.",
        productGap: false,
      });
    }
    if (Array.isArray(spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues)
      && spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues.length) {
      missingCapabilityNotes.push({
        kind: "spacing-semantics-unvalidated-duplicated-mode-values",
        category: "spacing-semantics",
        severity: "advisory",
        tokenCount: spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues.length,
        tokens: spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues.slice(0, 12).map(item => item.name),
        examples: spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues.slice(0, 4),
        repairReady: false,
        productGap: false,
        validationScope: "responsive-spacing-setup",
        reason: "Aliases are healthy, but one or more responsive spacing modes duplicate the Mobile value. If these modes were just created by a foundation repair, treat this as responsive spacing setup validation work before calling spacing complete. If the modes already existed, treat it as a designer validation item unless config explicitly allows same-value modes for the token/category.",
      });
    }
    if (Array.isArray(spacingAliasPlan.missingResponsiveModes) && spacingAliasPlan.missingResponsiveModes.length) {
      const spacingCollection = _requiredCollectionForCategory(planningDs, "spacing-semantics");
      const foundationRepair = _foundationRepairForCategory(planningDs, "spacing-semantics", spacingCollection);
      if (foundationRepair) {
        const repairKey = foundationRepair.kind + "\n" + foundationRepair.name;
        if (!foundationRepairKeys.has(repairKey)) {
          foundationRepairKeys.add(repairKey);
          foundationRepairs.push(Object.assign({}, foundationRepair, {
            missingModes: spacingAliasPlan.missingResponsiveModes,
            reason: "Add configured breakpoint modes to " + spacingCollection + " before responsive semantic spacing alias repairs can run for Mobile, Tablet, and Desktop.",
          }));
        }
      }
      missingCapabilityNotes.push({
        kind: "missing-foundation-modes",
        category: "spacing-semantics",
        collection: spacingCollection,
        missingModes: spacingAliasPlan.missingResponsiveModes,
        repairTool: "apply_ds_foundation_repairs",
        repairReady: Boolean(foundationRepair),
        reason: "Semantic spacing alias repair needs breakpoint modes on the Spacing collection. Present mode creation as a separate option. If the designer approves it, add missing modes as a foundation repair only, then sync and reinspect, then stop before any spacing alias apply.",
        productGap: false,
      });
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
  const spacingAliasRepairGaps = tokenGaps.filter(gap => gap.gapType === "spacing-alias-repair");
  const spacingAliasConfigDriftGaps = tokenGaps.filter(gap => gap.gapType === "spacing-alias-config-drift");
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
    spacingAliasRepairs: spacingAliasRepairGaps,
    spacingAliasConfigDrift: spacingAliasConfigDriftGaps,
    semanticAliasRepairModel: SEMANTIC_ALIAS_REPAIR_MODEL,
    spacingAliasPlanSummary: {
      repairableTokens: spacingAliasPlan.repairs.length,
      configDriftTokens: spacingAliasPlan.configDrift.length,
      missingPrimitiveTokens: spacingAliasPlan.missingPrimitives.length,
      spacingAlreadyHealthyCount: (spacingAliasPlan.alreadyAliasedHealthy || []).length,
      unvalidatedDuplicatedResponsiveModeValueTokens: (spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues || []).length,
      missingResponsiveModes: (spacingAliasPlan.missingResponsiveModes || []).length,
      spacingSemanticSource: spacingAliasPlan.spacingSemanticSource || spacingEffective.spacingSemanticMeta.source,
      repairSourceBreakdown: _spacingRepairBreakdown(spacingAliasPlan.repairs),
    },
    spacingSemanticSource: spacingAliasPlan.spacingSemanticSource || spacingEffective.spacingSemanticMeta.source,
    spacingMissingResponsiveModes: spacingAliasPlan.missingResponsiveModes || [],
    spacingResponsiveModeAdvisories: spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues || [],
    responsiveSpacingReview: _suggestResponsiveSpacingReviews(
      ds,
      figmaData,
      spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues || [],
      spacingAliasRepairGaps
    ),
  });
  const summary = {
    missingVariableCount: missingVariables.length,
    staleVariableCount: spacingAliasRepairGaps.length,
    configDriftCount: spacingAliasConfigDriftGaps.length,
    missingStyleCount: missingStyles.length,
    staleStyleCount: 0,
    typeMismatchCount: typeMismatches.length,
    unsupportedCategoryCount: unsupportedCategories.length,
    inspectedCategoryCount: supportedCategories.length,
    plannedCategoryCount: categoriesWithGaps.length,
    responsiveSpacingAdvisoryCount: (spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues || []).length,
  };

  const gapTotal = summary.missingVariableCount + summary.missingStyleCount + summary.typeMismatchCount + summary.staleVariableCount + summary.configDriftCount;
  return {
    message: _composeMessage(summary),
    semanticAliasRepairModel: spacingAliasPlan.model || SEMANTIC_ALIAS_REPAIR_MODEL,
    spacingSemanticSource: spacingAliasPlan.spacingSemanticSource || spacingEffective.spacingSemanticMeta.source,
    approvalBoundary: gapTotal ? TOKEN_GAP_APPROVAL_BOUNDARY : null,
    summary,
    repairPlan,
    topFindings: {
      missingVariables: missingVariables.slice(0, 10),
      missingStyles: missingStyles.slice(0, 10),
      typeMismatches: typeMismatches.slice(0, 10),
      spacingAliasRepairs: spacingAliasRepairGaps.slice(0, 10),
      spacingAliasConfigDrift: spacingAliasConfigDriftGaps.slice(0, 10),
      spacingResponsiveModeAdvisories: (spacingAliasPlan.unvalidatedDuplicatedResponsiveModeValues || []).slice(0, 10),
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
  if ((context.spacingAliasRepairs || []).length) applyCategorySet.add("spacing-semantics");
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
  const total = (context.missingVariables || []).length
    + (context.missingStyles || []).length
    + (context.typeMismatches || []).length
    + (context.spacingAliasRepairs || []).length;
  const advisoryTotal = (context.spacingResponsiveModeAdvisories || []).length;
  const hasProductGapNotes = (context.missingCapabilityNotes || []).some(note => note && note.productGap);
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
  if (applyCategories.indexOf("spacing-semantics") >= 0 && (context.spacingAliasRepairs || []).length) {
    applyInput.spacing_semantic_repairs = (context.spacingAliasRepairs || []).map(repair => ({
      name: repair.name,
      updates: (repair.updates || []).map(update => Object.assign({}, update)),
    }));
  }
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
  const reviewOptions = _buildReviewOptions({
    context,
    applyCategories,
    primitiveRepairPlan,
    foundationApplyInput,
    foundationCollections,
    spacingSemanticRepairs: applyInput.spacing_semantic_repairs || [],
  });

  return {
    tool: "update_ds_tokens",
    approvalRequired: true,
    previewInput,
    applyInput,
    reviewOptions,
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
    semanticAliasRepairModel: context.semanticAliasRepairModel || SEMANTIC_ALIAS_REPAIR_MODEL,
    spacingAliasPlanSummary: context.spacingAliasPlanSummary || null,
    counts: {
      missingVariables: (context.missingVariables || []).length,
      missingStyles: (context.missingStyles || []).length,
      typeMismatches: (context.typeMismatches || []).length,
      spacingAliasConfigDrift: (context.spacingAliasConfigDrift || []).length,
      total,
      applySupportedCategories: applyCategories.length,
      optionalTotal: 0,
      foundationCollections: foundationCollections.length,
      missingCapabilityNotes: (context.missingCapabilityNotes || []).length,
    },
    missingCapabilityNotes: context.missingCapabilityNotes || [],
    designerPresentation: _buildDesignerPresentation(context, total),
    agentInstruction: total
      ? "STOP before any Figma write. This inspect pass is read-only. For designer-facing review, present repairPlan.reviewOptions as separate choices and run only the selected preview. Do not run repairPlan.previewInput and primitiveRepairPlan.previewInput together as one combined token preview. Summarize repairPlan.designerPresentation in plain language, then wait for explicit designer approval (yes / proceed / apply). A routing goal phrase is not approval. Present foundation collection/mode creation, primitive updates, and semantic token updates as separate options with separate approvals. If foundationRepairPlan applies and is approved, call only apply_ds_foundation_repairs with foundationRepairPlan.applyInput, then sync and reinspect, then stop before any primitive or semantic token write. Apply update_ds_primitives or update_ds_tokens only after a fresh plan and a separate approval. Do not invent payloads. Other categories remain dry-run/product-gap scope unless primitiveRepairPlan covers them."
        + (advisoryTotal ? " Report responsive spacing mode advisories as responsive setup validation work when modes were just created, or designer validation items when modes already existed. They are not token gaps and not apply-ready repairs." : "")
      : advisoryTotal
        ? "No update_ds_tokens payload is ready from this read-only pass. Report responsive spacing mode advisories as responsive setup validation work when modes were just created, or designer validation items when modes already existed. They are not token gaps, not product/tool gaps, and not apply-ready repairs. Do not write custom Figma scripts or invent token updates."
          + (hasProductGapNotes ? " Separately report any productGap missingCapabilityNotes as Figlets product/tool gaps." : "")
        : "No update_ds_tokens payload is ready from this read-only pass. Report missingCapabilityNotes as Figlets product/tool gaps where present; do not infer tokens from arbitrary page usage or write custom Figma scripts.",
  };
}

function _reviewOption(id, label, boundary, tool, previewInput, applyInput, designerSummary) {
  const option = {
    id,
    label,
    boundary,
    tool,
    designerSummary,
  };
  if (previewInput) option.previewInput = previewInput;
  if (applyInput) option.applyInput = applyInput;
  return option;
}

function _buildReviewOptions({
  context,
  applyCategories,
  primitiveRepairPlan,
  foundationApplyInput,
  foundationCollections,
  spacingSemanticRepairs,
}) {
  const options = [];
  const configPath = context.configPath;
  const applyCategorySet = new Set(applyCategories || []);
  const responsiveSpacingReview = context.responsiveSpacingReview || null;

  if ((foundationCollections || []).length) {
    options.push(_reviewOption(
      "foundation-modes",
      "Add missing foundation modes only",
      "foundation",
      "apply_ds_foundation_repairs",
      null,
      foundationApplyInput,
      "Creates only configured collection modes or shells. After this, sync and reinspect, then stop before any token write."
    ));
  }

  if (responsiveSpacingReview && responsiveSpacingReview.advisoryCount) {
    const option = {
      id: "responsive-spacing-values",
      label: "Review responsive spacing value suggestions",
      boundary: "responsive-spacing-decision",
      tool: "plan_ds_figma_operations",
      designerSummary: responsiveSpacingReview.designerSummary,
      aliasRepairSummary: responsiveSpacingReview.aliasRepairSummary,
      suggestedValues: responsiveSpacingReview.suggestedValues,
      editableTemplate: responsiveSpacingReview.editableTemplate,
      missingPrimitiveValues: responsiveSpacingReview.missingPrimitiveValues,
    };
    if ((responsiveSpacingReview.operations || []).length) {
      option.previewInput = { operations: responsiveSpacingReview.operations };
    }
    options.push(option);
  }

  if (primitiveRepairPlan) {
    options.push(_reviewOption(
      "primitive-typography",
      "Review primitive typography variables",
      "primitive-token",
      "update_ds_primitives",
      primitiveRepairPlan.previewInput,
      primitiveRepairPlan.applyInput,
      "Creates or updates primitive typography variables in the configured Primitives collection only."
    ));
  }

  const spacingRepairs = spacingSemanticRepairs || [];
  if (spacingRepairs.length) {
    const breakdown = _spacingRepairBreakdown(spacingRepairs);
    const breakdownSentence = _spacingRepairBreakdownSentence(breakdown);
    options.push(_reviewOption(
      "semantic-spacing-aliases",
      "Review semantic spacing alias repairs",
      "semantic-token",
      "update_ds_tokens",
      {
        config_path: configPath,
        categories: ["spacing-semantics"],
        create_missing: true,
        include_existing_updates: false,
        dry_run: true,
        spacing_semantic_repairs: spacingRepairs,
      },
      {
        config_path: configPath,
        categories: ["spacing-semantics"],
        create_missing: true,
        include_existing_updates: false,
        dry_run: false,
        spacing_semantic_repairs: spacingRepairs,
      },
      "Reviews only the listed semantic spacing token/mode alias repairs"
        + (breakdownSentence ? ": " + breakdownSentence + "." : ".")
        + " It does not create missing breakpoint modes, and it does not create unrelated spacing variables."
    ));
  }

  const radiusBorderCategories = ["border-width", "radius"].filter(category => applyCategorySet.has(category));
  if (radiusBorderCategories.length) {
    options.push(_reviewOption(
      "radius-border-tokens",
      "Review radius and border-width tokens",
      "semantic-token",
      "update_ds_tokens",
      {
        config_path: configPath,
        categories: radiusBorderCategories,
        create_missing: true,
        include_existing_updates: false,
        dry_run: true,
      },
      {
        config_path: configPath,
        categories: radiusBorderCategories,
        create_missing: true,
        include_existing_updates: false,
        dry_run: false,
      },
      "Reviews missing radius and border-width variables only."
    ));
  }

  if (applyCategorySet.has("typography") || applyCategorySet.has("typography-variables") || applyCategorySet.has("typography-styles")) {
    const typographyCategories = applyCategorySet.has("typography")
      ? ["typography"]
      : ["typography-variables", "typography-styles"].filter(category => applyCategorySet.has(category));
    options.push(_reviewOption(
      "typography-tokens-and-styles",
      "Review typography variables and text styles",
      "semantic-token",
      "update_ds_tokens",
      {
        config_path: configPath,
        categories: typographyCategories,
        create_missing: true,
        include_existing_updates: false,
        dry_run: true,
      },
      {
        config_path: configPath,
        categories: typographyCategories,
        create_missing: true,
        include_existing_updates: false,
        dry_run: false,
      },
      "Reviews configured Typography collection variables and config-derived text styles. Existing text styles may be refreshed in place."
    ));
  }

  const hasMissingSemanticSpacingVariable = (context.missingVariables || []).some(gap => gap.category === "spacing-semantics");
  if (hasMissingSemanticSpacingVariable) {
    options.push(_reviewOption(
      "semantic-spacing-token-completion",
      "Review semantic spacing token completion",
      "semantic-token",
      "update_ds_tokens",
      {
        config_path: configPath,
        categories: ["spacing-semantics"],
        create_missing: true,
        include_existing_updates: false,
        dry_run: true,
      },
      {
        config_path: configPath,
        categories: ["spacing-semantics"],
        create_missing: true,
        include_existing_updates: false,
        dry_run: false,
      },
      "Reviews the full semantic spacing category, including missing semantic spacing variables and alias repairs. Use the semantic spacing alias option for alias-only review."
    ));
  }

  return options;
}

function _isLayoutSpacingToken(name) {
  return /^space\/layout\//.test(String(name || ""));
}

function _responsiveSpacingTokenKey(name) {
  return String(name || "").replace(/^space\//, "");
}

function _spacingAliasRepairSummary(spacingAliasRepairs) {
  const repairs = Array.isArray(spacingAliasRepairs) ? spacingAliasRepairs : [];
  const updateCount = repairs.reduce((count, repair) => count + ((repair.updates || []).length), 0);
  const tokens = repairs.map(repair => repair && repair.name).filter(Boolean);
  const layoutTokens = tokens.filter(_isLayoutSpacingToken);
  return {
    tokenCount: tokens.length,
    updateCount,
    tokens,
    layoutTokens,
  };
}

function _suggestResponsiveSpacingReviews(ds, figmaData, advisories, spacingAliasRepairs) {
  const all = Array.isArray(advisories) ? advisories : [];
  if (!all.length) return null;
  const spacingCollectionName = ds && ds.collections && ds.collections.spacing || "4. Spacing";
  const primitiveCollectionName = ds && ds.collections && ds.collections.primitives || "1. Primitives";
  const primitiveLookup = buildPrimitiveSpacingLookup(figmaData, primitiveCollectionName);
  const layout = all.filter(item => _isLayoutSpacingToken(item && item.name));
  const other = all.filter(item => !_isLayoutSpacingToken(item && item.name));
  const operations = [];
  const suggestedValues = [];
  const templateRows = [];
  const missingPrimitiveValues = [];
  const aliasRepairSummary = _spacingAliasRepairSummary(spacingAliasRepairs);

  for (const advisory of layout) {
    const modes = Array.isArray(advisory.modes) ? advisory.modes : [];
    const baselineMode = advisory.baselineMode || (modes[0] && modes[0].modeName) || "Mobile";
    const baselineValue = Number(advisory.baselineValue);
    if (!Number.isFinite(baselineValue) || modes.length < 2) continue;
    const values = {};
    const display = [];
    let allAliasesReady = true;
    for (let i = 1; i < modes.length; i += 1) {
      const mode = modes[i];
      const modeName = mode && mode.modeName;
      if (!modeName) continue;
      const suggestedValue = baselineValue + (16 * i);
      const primitive = resolvePrimitiveAliasTarget(primitiveLookup, suggestedValue);
      display.push(`${modeName} ${suggestedValue}`);
      if (primitive) {
        values[modeName] = { alias: primitive.name };
      } else {
        allAliasesReady = false;
        missingPrimitiveValues.push({
          token: advisory.name,
          mode: modeName,
          value: suggestedValue,
          primitiveCollection: primitiveCollectionName,
        });
      }
    }
    if (!Object.keys(values).length) continue;
    suggestedValues.push({
      token: advisory.name,
      baseline: { mode: baselineMode, value: baselineValue },
      suggestion: display,
      rationale: "Layout spacing usually benefits most from wider breakpoints; this uses a steady +16px step per breakpoint.",
    });
    templateRows.push(`${_responsiveSpacingTokenKey(advisory.name)}: ${display.join(", ")}`);
    if (allAliasesReady) {
      operations.push({
        kind: "update_variable",
        name: advisory.name,
        values,
      });
    }
  }

  for (const advisory of other.slice(0, 8)) {
    const modes = Array.isArray(advisory.modes) ? advisory.modes : [];
    const baselineMode = advisory.baselineMode || (modes[0] && modes[0].modeName) || "Mobile";
    const baselineValue = Number(advisory.baselineValue);
    if (!Number.isFinite(baselineValue) || modes.length < 2) continue;
    const display = [];
    for (let i = 1; i < modes.length; i += 1) {
      const modeName = modes[i] && modes[i].modeName;
      if (modeName) display.push(`${modeName} ${baselineValue}`);
    }
    if (display.length) templateRows.push(`${_responsiveSpacingTokenKey(advisory.name)}: ${display.join(", ")}`);
  }

  const suggestedSummary = suggestedValues.length
    ? `Suggestion: grow layout spacing only by +16px per breakpoint (${suggestedValues.map(item => item.token).join(", ")}), and keep component/inset/stack/touch spacing unchanged unless real screens need more density changes.`
    : "No alias-backed automatic suggestion is ready yet. Review the repeated responsive spacing values and provide exact Tablet/Desktop values if they should differ.";
  const rawValueSummary = aliasRepairSummary.updateCount
    ? `Also, do not miss the spacing alias cleanup: ${aliasRepairSummary.tokenCount} semantic spacing token${aliasRepairSummary.tokenCount === 1 ? "" : "s"} still have ${aliasRepairSummary.updateCount} raw mode value${aliasRepairSummary.updateCount === 1 ? "" : "s"} that should be converted to primitive aliases through the semantic spacing alias repair option before treating spacing as complete${aliasRepairSummary.layoutTokens.length ? `, including layout token${aliasRepairSummary.layoutTokens.length === 1 ? "" : "s"} ${aliasRepairSummary.layoutTokens.join(", ")}` : ""}.`
    : "No raw semantic spacing alias repairs are currently blocking this responsive-value review.";
  const applySummary = operations.length
    ? `If the designer agrees, run plan_ds_figma_operations with the suggested update_variable operations, show the exact plan, then apply only that approved plan through apply_ds_figma_operations. Sync/reinspect afterward and refresh or update config so future config-backed checks expect the new responsive values.`
    : "The suggested values need matching primitive spacing variables before Figlets should write them as aliases. Do not write raw semantic spacing values; create/choose primitives or ask the designer for alias-backed values first.";

  return {
    advisoryCount: all.length,
    aliasRepairSummary,
    suggestedValues,
    operations,
    missingPrimitiveValues,
    editableTemplate: templateRows.join("\n"),
    designerSummary: `${rawValueSummary} ${suggestedSummary} ${applySummary}`,
    categories: {
      layout: layout.length,
      other: other.length,
    },
    collection: spacingCollectionName,
  };
}

function _buildDesignerPresentation(context, total) {
  const missingVariables = context.missingVariables || [];
  const missingStyles = context.missingStyles || [];
  const spacingAliasRepairs = context.spacingAliasRepairs || [];
  const spacingAliasConfigDrift = context.spacingAliasConfigDrift || [];
  const spacingResponsiveModeAdvisories = context.spacingResponsiveModeAdvisories || [];
  const responsiveSpacingReview = context.responsiveSpacingReview || null;
  const notes = context.missingCapabilityNotes || [];
  const foundationRepairs = context.foundationRepairs || [];
  const lines = [];
  const sections = [];

  if (total) {
    sections.unshift({
      title: "Approval required before writes",
      message: "Dry-run previews only until you explicitly approve. Figlets will not apply foundation, primitive, or semantic token changes until you say yes, proceed, or apply.",
    });
    lines.unshift(
      "Read-only plan only. I will dry-run the updates first and wait for your explicit approval before changing Figma."
    );
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
    if (spacingAliasRepairs.length) {
      const changes = [];
      for (const repair of spacingAliasRepairs) {
        for (const update of repair.updates || []) {
          const sourceKind = _spacingRepairSourceKind(update);
          const prefix = sourceKind === "raw-value"
            ? "raw value"
            : sourceKind === "alias-retarget"
              ? "existing alias"
              : "current value";
          changes.push(repair.name + " [" + update.modeName + "] " + prefix + " -> " + update.toAliasName);
        }
      }
      const breakdown = _spacingRepairBreakdown(spacingAliasRepairs);
      const breakdownSentence = _spacingRepairBreakdownSentence(breakdown);
      sections.push({
        title: "Semantic spacing alias repairs",
        message: "Figlets can preview " + _plural("semantic spacing token/mode repair", breakdown.repairUpdates)
          + (breakdownSentence ? ": " + breakdownSentence : "")
          + ". Examples: "
          + changes.slice(0, 6).join(", ")
          + (changes.length > 6 ? ", and more." : "."),
      });
    }
    if ((context.spacingMissingResponsiveModes || []).length) {
      sections.push({
        title: "Spacing breakpoint modes required",
        message: "Semantic spacing alias repair needs Mobile, Tablet, and Desktop modes on the Spacing collection. Present missing mode creation as a separate option. If approved, Figlets should add only the missing modes as a foundation repair, then sync and reinspect, then stop before any spacing alias apply.",
      });
    }
    if (spacingResponsiveModeAdvisories.length) {
      sections.push(_spacingResponsiveModeAdvisorySection(spacingResponsiveModeAdvisories, responsiveSpacingReview));
    }
    if (spacingAliasConfigDrift.length) {
      const driftLines = [];
      for (const drift of spacingAliasConfigDrift) {
        for (const mode of drift.driftModes || []) {
          driftLines.push(
            drift.name + " [" + mode.modeName + "]: Figma " + mode.currentValue + " vs config " + mode.configExpected
          );
        }
      }
      sections.push({
        title: "Semantic spacing config drift",
        message: "These semantic spacing modes differ from config and need a designer decision before aliasing: "
          + driftLines.slice(0, 4).join("; ")
          + (driftLines.length > 4 ? "; and more." : "."),
      });
    }
  } else {
    lines.push("I do not see missing non-color config-backed tokens in the inspected categories.");
    if (spacingResponsiveModeAdvisories.length) {
      lines.push("Semantic spacing aliases are healthy, but repeated responsive mode values still need responsive setup validation before spacing is complete.");
      sections.push(_spacingResponsiveModeAdvisorySection(spacingResponsiveModeAdvisories, responsiveSpacingReview));
    }
  }

  if (notes.length) {
    const productGapNotes = notes.filter(note => note.productGap);
    if (foundationRepairs.length) {
      lines.push(`${foundationRepairs.length} missing foundation collection or mode repair${foundationRepairs.length === 1 ? "" : "s"} can be created as a separate option. Approval for this step must apply only foundationRepairPlan.applyInput; after sync/reinspect, stop before any token apply.`);
      sections.push({
        title: "Foundation repair",
        message: `Figlets can create ${foundationRepairs.map(item => item.name).join(", ")} as collection shell or mode repair${foundationRepairs.length === 1 ? "" : "s"} with configured modes. This is a separate approval boundary from semantic token alias repairs.`,
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
      spacingAliasRepairs: spacingAliasRepairs.length,
      spacingResponsiveModeAdvisories: spacingResponsiveModeAdvisories.length,
      responsiveSpacingSuggestionOperations: responsiveSpacingReview && responsiveSpacingReview.operations
        ? responsiveSpacingReview.operations.length
        : 0,
      spacingAliasRepairSourceBreakdown: _spacingRepairBreakdown(spacingAliasRepairs),
    },
    proposedChanges: spacingAliasRepairs.flatMap(repair => (repair.updates || []).map(update => ({
      token: repair.name,
      mode: update.modeName,
      action: _spacingRepairSourceKind(update) === "alias-retarget"
        ? "retarget-existing-alias-to-primitive"
        : _spacingRepairSourceKind(update) === "raw-value"
          ? "convert-raw-value-to-primitive-alias"
          : "alias-to-existing-primitive",
      sourceKind: _spacingRepairSourceKind(update),
      toAlias: update.toAliasName,
    }))),
  };
}

function _spacingResponsiveModeAdvisorySection(advisories, review) {
  const rows = [];
  for (const advisory of advisories || []) {
    const duplicatedModes = (advisory.duplicatedModes || []).map(mode => mode.modeName).join("/");
    rows.push(
      advisory.name + ": " + (duplicatedModes || "responsive modes") + " duplicate "
      + (advisory.baselineMode || "Mobile") + " value " + advisory.baselineValue
    );
  }
  const suggestion = review && review.designerSummary
    ? " " + review.designerSummary
    : "";
  return {
    title: "Responsive spacing setup validation needed",
    message: "These semantic spacing aliases resolve correctly, but repeated values across responsive modes are unvalidated responsive setup decisions, not proof that the modes are acceptable. If Tablet/Desktop modes were just created, ask the designer to validate or adjust the responsive spacing scale before calling spacing complete. "
      + rows.slice(0, 5).join("; ")
      + (rows.length > 5 ? "; and more." : ".")
      + suggestion,
  };
}

const TOKEN_GAP_APPROVAL_BOUNDARY = {
  readOnlyUntilApproval: true,
  requiredBeforeWrite: "Explicit designer approval after dry-run previews (for example: yes, proceed, or apply).",
  goalPhraseIsNotApproval: true,
  stopBeforeTools: [
    "apply_ds_foundation_repairs",
    "update_ds_primitives",
    "update_ds_tokens",
  ],
};

function _composeMessage(summary) {
  const total = summary.missingVariableCount + summary.missingStyleCount + summary.typeMismatchCount
    + (summary.staleVariableCount || 0) + (summary.configDriftCount || 0);
  if (!total && !summary.unsupportedCategoryCount && !summary.responsiveSpacingAdvisoryCount) {
    return "No config-backed non-color token gaps found in the inspected categories.";
  }
  const parts = [];
  if (summary.missingVariableCount) parts.push(`${summary.missingVariableCount} missing variable${summary.missingVariableCount === 1 ? "" : "s"}`);
  if (summary.missingStyleCount) parts.push(`${summary.missingStyleCount} missing style${summary.missingStyleCount === 1 ? "" : "s"}`);
  if (summary.typeMismatchCount) parts.push(`${summary.typeMismatchCount} type mismatch${summary.typeMismatchCount === 1 ? "" : "es"}`);
  if (summary.staleVariableCount) parts.push(`${summary.staleVariableCount} alias repair${summary.staleVariableCount === 1 ? "" : "s"}`);
  if (summary.configDriftCount) parts.push(`${summary.configDriftCount} config drift mode${summary.configDriftCount === 1 ? "" : "s"}`);
  if (summary.responsiveSpacingAdvisoryCount) parts.push(`${summary.responsiveSpacingAdvisoryCount} responsive spacing advisory${summary.responsiveSpacingAdvisoryCount === 1 ? "" : "ies"}`);
  if (summary.unsupportedCategoryCount) parts.push(`${summary.unsupportedCategoryCount} unsupported categor${summary.unsupportedCategoryCount === 1 ? "y" : "ies"}`);
  const gapSummary = `Figlets found ${parts.join(", ")} in the config-backed token planner.`;
  if (!total) {
    return `${gapSummary} Read-only inspection only; no token write is implied.`;
  }
  return [
    "Read-only inspection. Do not call apply_ds_foundation_repairs, update_ds_primitives, or update_ds_tokens with dry_run:false until the designer explicitly approves after dry-run previews.",
    "A routing goal phrase (for example: complete missing tokens) is not approval to write.",
    gapSummary,
  ].join(" ");
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
  planTokenPruneFromSnapshot,
  ORCHESTRATION_APPLY_CATEGORIES,
  PRIMITIVE_APPLY_CATEGORIES,
};
