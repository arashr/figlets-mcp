"use strict";

/**
 * Config-backed semantic alias repair planning.
 *
 * Model (BNN-46):
 * - Intended semantic values: design-system.config.js when spacing.semantic is present
 * - When config has no spacing.semantic (e.g. Figma bootstrap), infer intended values from
 *   the synced snapshot for existing semantic spacing variables
 * - Current state: synced Figma snapshot
 * - Alias targets: existing primitives in the Primitives collection only, resolved by
 *   matching primitive float value (space/12 = 48px)
 * - Propose alias repair only when a mode's snapshot raw value matches intended value
 * - Config drift (snapshot raw != config expected): needs designer decision, never silent alias
 * - Missing primitive: missing prerequisite note, do not invent primitives in this flow
 */

const SEMANTIC_ALIAS_REPAIR_MODEL = {
  intendedValuesSource: "config",
  intendedValuesSourceWhenConfigEmpty: "figma-snapshot-inference",
  currentStateSource: "figma-snapshot",
  aliasTargets: "existing-primitives-only",
  primitiveLookup: "match-primitive-float-value",
  matchRule: "snapshot-raw-must-equal-intended-value-per-mode",
  onConfigDrift: "report-needs-designer-decision",
  onMissingPrimitive: "report-missing-prerequisite",
  onDuplicatedResponsiveModeValues: "report-low-priority-unvalidated-decision",
};

const SPACING_SEMANTIC_CATEGORY = "spacing-semantics";

function isAliasVariableValue(value) {
  return Boolean(value && typeof value === "object" && value.type === "VARIABLE_ALIAS" && typeof value.id === "string");
}

function sanitizeSpaceStep(step) {
  return String(step).replace(".", "-");
}

function floatRawValue(value) {
  if (isAliasVariableValue(value)) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function floatsEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

function isSpacingSemanticTokenName(name) {
  const value = String(name || "");
  if (value.indexOf("space/") !== 0) return false;
  if (/^space\/radius\//.test(value)) return false;
  if (/^space\/border\//.test(value)) return false;
  if (isPrimitiveSpacingTokenName(value)) return false;
  return true;
}

function isPrimitiveSpacingTokenName(name) {
  return /^space\/(?:[\d]+(?:[-_][\d]+)*|full)$/.test(String(name || ""));
}

function collectionRecordByName(figmaData, collectionName) {
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  for (const collection of collections) {
    if (collection && collection.name === collectionName) return collection;
  }
  return null;
}

function primitiveVariableIdByName(figmaData, primitivesCollectionName) {
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  if (!primitivesCollectionName) return new Map();
  const primitiveCollection = collections.find(collection => collection && collection.name === primitivesCollectionName);
  if (!primitiveCollection || !Array.isArray(primitiveCollection.variableIds)) return new Map();
  const byId = new Map();
  for (const variable of variables) {
    if (variable && variable.id) byId.set(variable.id, variable);
  }
  const map = new Map();
  for (const variableId of primitiveCollection.variableIds) {
    const variable = byId.get(variableId);
    if (variable && typeof variable.name === "string") map.set(variable.name, variable.id);
  }
  return map;
}

function buildPrimitiveSpacingLookup(figmaData, primitivesCollectionName) {
  const byName = primitiveVariableIdByName(figmaData, primitivesCollectionName);
  const byFloat = new Map();
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  const primitiveCollection = collections.find(collection => collection && collection.name === primitivesCollectionName);
  if (!primitiveCollection) return { byName, byFloat };

  const byId = new Map();
  for (const variable of variables) {
    if (variable && variable.id) byId.set(variable.id, variable);
  }

  const modeIds = Array.isArray(primitiveCollection.modes) && primitiveCollection.modes.length
    ? primitiveCollection.modes.map(mode => mode.modeId)
    : [];
  const defaultModeId = modeIds[0];

  for (const variableId of primitiveCollection.variableIds || []) {
    const variable = byId.get(variableId);
    if (!variable || !isPrimitiveSpacingTokenName(variable.name)) continue;
    const raw = defaultModeId && variable.valuesByMode
      ? floatRawValue(variable.valuesByMode[defaultModeId])
      : null;
    if (raw === null) continue;
    if (!byFloat.has(raw)) {
      byFloat.set(raw, { id: variable.id, name: variable.name });
    }
  }

  return { byName, byFloat };
}

function resolvePrimitiveAliasTarget(lookup, expectedFloat) {
  const byFloat = lookup.byFloat.get(expectedFloat);
  if (byFloat) return byFloat;

  for (const [floatValue, target] of lookup.byFloat.entries()) {
    if (floatsEqual(floatValue, expectedFloat)) return target;
  }

  return null;
}

function expectedBreakpointModeNames(ds) {
  if (ds && ds.breakpoints && Array.isArray(ds.breakpoints.modes) && ds.breakpoints.modes.length) {
    return ds.breakpoints.modes.map(mode => String(mode || "").trim()).filter(Boolean);
  }
  return ["Mobile", "Tablet", "Desktop"];
}

function spacingCollectionModeAnalysis(ds, figmaData) {
  const spacingCollectionName = ds && ds.collections && ds.collections.spacing || "4. Spacing";
  const collectionRecord = collectionRecordByName(figmaData, spacingCollectionName);
  const expected = expectedBreakpointModeNames(ds);
  const actual = collectionRecord && Array.isArray(collectionRecord.modes)
    ? collectionRecord.modes.map(mode => String(mode && mode.name || "").trim()).filter(Boolean)
    : [];
  const actualLower = new Set(actual.map(name => name.toLowerCase()));
  const missing = expected.filter(mode => !actualLower.has(mode.toLowerCase()));
  const responsiveReady = missing.length === 0 && actual.length >= expected.length;
  return {
    spacingCollectionName,
    expected,
    actual,
    missing,
    responsiveReady,
  };
}

function responsiveModeOrder(ds, figmaData, collectionName, defaultModes) {
  const collectionRecord = collectionRecordByName(figmaData, collectionName);
  if (!collectionRecord) return [];
  const expectedModes = expectedBreakpointModeNames(ds).map(mode => mode.toLowerCase());
  const fallbackModes = (defaultModes || ["mobile", "tablet", "desktop"]).map(mode => String(mode).toLowerCase());
  const breakpointNames = expectedModes.length ? expectedModes : fallbackModes;
  const modeIdToName = new Map();
  for (const mode of collectionRecord.modes || []) {
    if (mode && mode.modeId) modeIdToName.set(mode.modeId, String(mode.name || "").trim());
  }
  const modeIds = new Set(modeIdToName.keys());
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collectionVariableIds = new Set(collectionRecord.variableIds || []);
  for (const variable of variables) {
    if (!variable || !collectionVariableIds.has(variable.id)) continue;
    if (!isSpacingSemanticTokenName(variable.name)) continue;
    for (const modeId of Object.keys(variable.valuesByMode || {})) modeIds.add(modeId);
  }
  const order = [];
  for (const modeId of modeIds) {
    const modeName = modeIdToName.get(modeId) || String(modeId || "").trim();
    const lower = modeName.toLowerCase();
    const bpIndex = lower ? breakpointNames.indexOf(lower) : -1;
    if (bpIndex < 0) continue;
    order.push({
      modeId,
      modeName: modeName || ("Mode " + String(bpIndex + 1)),
      bpIndex,
    });
  }
  if (order.length) return order.sort((a, b) => a.bpIndex - b.bpIndex);

  return (collectionRecord.modes || []).map((mode, modeIndex) => {
    const modeName = String(mode && mode.name || "").trim();
    let bpIndex = modeIndex;
    if (modeName) {
      const exact = breakpointNames.indexOf(modeName.toLowerCase());
      if (exact >= 0) bpIndex = exact;
    }
    return { modeId: mode.modeId, modeName: modeName || ("Mode " + String(modeIndex + 1)), bpIndex };
  });
}

function variableByIdMap(figmaData) {
  const map = new Map();
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  for (const variable of variables) {
    if (variable && variable.id) map.set(variable.id, variable);
  }
  return map;
}

function resolveNumericFromVariableValue(value, variableById) {
  const raw = floatRawValue(value);
  if (raw !== null) return raw;
  if (!isAliasVariableValue(value)) return null;
  const target = variableById.get(value.id);
  if (!target || !target.valuesByMode || typeof target.valuesByMode !== "object") return null;
  const modeIds = Object.keys(target.valuesByMode);
  for (const modeId of modeIds) {
    const resolved = floatRawValue(target.valuesByMode[modeId]);
    if (resolved !== null) return resolved;
  }
  return null;
}

function fillInferredSpacingValues(values) {
  const filled = values.slice();
  for (let i = 1; i < filled.length; i++) {
    if (filled[i] == null && filled[i - 1] != null) filled[i] = filled[i - 1];
  }
  for (let i = filled.length - 2; i >= 0; i--) {
    if (filled[i] == null && filled[i + 1] != null) filled[i] = filled[i + 1];
  }
  return filled;
}

function spacingSemanticKeysForPlanning(semantic, figmaData, variableMap, spacingCollectionName) {
  const keys = new Set(Object.keys(semantic || {}));
  const collectionRecord = collectionRecordByName(figmaData, spacingCollectionName);
  const variableIds = collectionRecord && Array.isArray(collectionRecord.variableIds)
    ? collectionRecord.variableIds
    : [];
  const byId = variableByIdMap(figmaData);
  for (const variableId of variableIds) {
    const variable = byId.get(variableId);
    if (variable && isSpacingSemanticTokenName(variable.name)) {
      keys.add(variable.name.slice("space/".length));
    }
  }
  for (const name of variableMap.keys()) {
    if (isSpacingSemanticTokenName(name)) keys.add(name.slice("space/".length));
  }
  return Array.from(keys);
}

function inferSpacingValuesFromSnapshot(figmaData, variableMap, spacingCollectionName, options = {}) {
  const requireRawMode = options.requireRawMode === true;
  const inferred = {};
  const collectionRecord = collectionRecordByName(figmaData, spacingCollectionName);
  if (!collectionRecord) return inferred;

  const modeOrder = responsiveModeOrder(null, figmaData, spacingCollectionName);
  if (!modeOrder.length) return inferred;

  const variableIds = Array.isArray(collectionRecord.variableIds) ? collectionRecord.variableIds : [];
  const byId = variableByIdMap(figmaData);

  for (const variableId of variableIds) {
    const variable = byId.get(variableId) || variableMap.get(variableId);
    if (!variable || typeof variable.name !== "string" || !isSpacingSemanticTokenName(variable.name)) continue;
    if (!variable.valuesByMode || typeof variable.valuesByMode !== "object") continue;

    const key = variable.name.slice("space/".length);
    const values = [];
    let anyRawMode = false;
    for (const mode of modeOrder) {
      const current = variable.valuesByMode[mode.modeId];
      if (floatRawValue(current) !== null) anyRawMode = true;
      values.push(resolveNumericFromVariableValue(current, byId));
    }
    if (requireRawMode && !anyRawMode) continue;
    const filled = fillInferredSpacingValues(values);
    if (!filled.length || filled.some(value => value == null)) continue;
    inferred[key] = filled;
  }

  return inferred;
}

function inferSpacingSemanticFromSnapshot(figmaData, variableMap, spacingCollectionName) {
  return inferSpacingValuesFromSnapshot(figmaData, variableMap, spacingCollectionName, { requireRawMode: true });
}

function inferResolvedSpacingSemanticFromSnapshot(figmaData, variableMap, spacingCollectionName) {
  return inferSpacingValuesFromSnapshot(figmaData, variableMap, spacingCollectionName, { requireRawMode: false });
}

function intendedValuesForSpacingToken(key, semantic, variable, modeOrder, variableById) {
  if (semantic && Object.prototype.hasOwnProperty.call(semantic, key)) {
    const configured = semantic[key];
    return Array.isArray(configured) ? configured.slice() : [configured];
  }
  const values = [];
  for (const mode of modeOrder) {
    values.push(resolveNumericFromVariableValue(variable.valuesByMode[mode.modeId], variableById));
  }
  const filled = fillInferredSpacingValues(values);
  if (!filled.length || filled.some(value => value == null)) return null;
  return filled;
}

function _arrayIncludesTokenPattern(items, key, tokenName) {
  const names = [key, tokenName, "space/" + key];
  for (const item of items || []) {
    const value = String(item || "").trim();
    if (!value) continue;
    if (names.includes(value)) return true;
    if (value.endsWith("/*")) {
      const prefix = value.slice(0, -1);
      if (key.indexOf(prefix) === 0 || tokenName.indexOf(prefix) === 0 || ("space/" + key).indexOf(prefix) === 0) return true;
    }
  }
  return false;
}

function _asPattern(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.endsWith("/*")) return text;
  return text.replace(/\/?$/, "/*");
}

function spacingTokenAllowsSameResponsiveModeValues(ds, key, tokenName) {
  const validation = ds && ds.spacing && ds.spacing.responsiveModeValidation;
  const allow = validation && validation.allowSameValueModes;
  if (allow === true || allow === "all") return true;
  if (Array.isArray(allow)) return _arrayIncludesTokenPattern(allow, key, tokenName);
  if (allow && typeof allow === "object") {
    if (allow.all === true) return true;
    if (Array.isArray(allow.tokens) && _arrayIncludesTokenPattern(allow.tokens, key, tokenName)) return true;
    if (Array.isArray(allow.prefixes) && _arrayIncludesTokenPattern(allow.prefixes.map(_asPattern), key, tokenName)) return true;
    if (Array.isArray(allow.categories)) {
      const category = String(key || "").split("/")[0];
      if (allow.categories.map(item => String(item || "")).includes(category)) return true;
    }
  }
  return false;
}

function duplicatedResponsiveModeValueAdvisory({ ds, key, tokenName, modeOrder, variable, variableById, aliasTargetsByMode }) {
  if (!modeOrder || modeOrder.length < 2) return null;
  if (spacingTokenAllowsSameResponsiveModeValues(ds, key, tokenName)) return null;
  const baselineMode = modeOrder[0];
  if (!baselineMode || !variable || !variable.valuesByMode) return null;
  const baselineValue = resolveNumericFromVariableValue(variable.valuesByMode[baselineMode.modeId], variableById);
  if (baselineValue === null) return null;
  const duplicatedModes = [];
  const modes = [];
  for (const mode of modeOrder) {
    const current = resolveNumericFromVariableValue(variable.valuesByMode[mode.modeId], variableById);
    if (current === null) continue;
    const aliasTarget = aliasTargetsByMode && aliasTargetsByMode.get(mode.modeId);
    modes.push({
      modeId: mode.modeId,
      modeName: mode.modeName,
      value: current,
      aliasName: aliasTarget && aliasTarget.name || undefined,
    });
    if (mode.modeId !== baselineMode.modeId && floatsEqual(current, baselineValue)) {
      duplicatedModes.push({
        modeId: mode.modeId,
        modeName: mode.modeName,
        value: current,
        matchesMode: baselineMode.modeName,
        aliasName: aliasTarget && aliasTarget.name || undefined,
      });
    }
  }
  if (!duplicatedModes.length) return null;
  return {
    name: tokenName,
    baselineMode: baselineMode.modeName,
    baselineValue,
    duplicatedModes,
    modes,
    allModesSame: modes.length === modeOrder.length && modes.every(mode => floatsEqual(mode.value, baselineValue)),
    reason: "Aliases resolve correctly, but one or more responsive spacing modes duplicate the " + baselineMode.modeName + " value. Treat this as an unvalidated responsive spacing decision unless config explicitly allows same-value modes for this token.",
  };
}

function mergedSpacingSemantic(ds, figmaData, variableMap) {
  const configSemantic = ds && ds.spacing && ds.spacing.semantic && typeof ds.spacing.semantic === "object"
    ? ds.spacing.semantic
    : {};
  const spacingCollectionName = ds && ds.collections && ds.collections.spacing || "4. Spacing";
  const rawInferred = inferSpacingSemanticFromSnapshot(figmaData, variableMap, spacingCollectionName);
  const resolvedInferred = inferResolvedSpacingSemanticFromSnapshot(figmaData, variableMap, spacingCollectionName);
  const hasConfig = Object.keys(configSemantic).length > 0;
  const hasRawInferred = Object.keys(rawInferred).length > 0;
  const hasResolvedInferred = Object.keys(resolvedInferred).length > 0;
  const semantic = Object.assign({}, resolvedInferred, rawInferred, configSemantic);
  let source = "none";
  if (hasConfig && hasRawInferred) source = "config-with-snapshot-inference";
  else if (hasConfig && hasResolvedInferred) source = "config-with-snapshot-resolved";
  else if (hasConfig) source = "config";
  else if (hasRawInferred) source = "figma-snapshot-inference";
  else if (hasResolvedInferred) source = "figma-snapshot-resolved";

  return {
    semantic,
    source,
    configSemantic,
    inferred: rawInferred,
    resolvedInferred,
  };
}

function withEffectiveSpacingSemantic(ds, figmaData, variableMap) {
  const merged = mergedSpacingSemantic(ds, figmaData, variableMap);
  if (merged.source === "none") {
    return { ds, spacingSemanticMeta: merged };
  }
  return {
    ds: Object.assign({}, ds, {
      spacing: Object.assign({}, ds.spacing || {}, { semantic: merged.semantic }),
    }),
    spacingSemanticMeta: merged,
  };
}

function planSpacingSemanticAliasRepairs(ds, figmaData, variableMap, options = {}) {
  const effective = options.effectiveDs || withEffectiveSpacingSemantic(ds, figmaData, variableMap).ds;
  const spacingSemanticMeta = options.spacingSemanticMeta || mergedSpacingSemantic(ds, figmaData, variableMap);
  const model = Object.assign({}, SEMANTIC_ALIAS_REPAIR_MODEL, {
    intendedValuesSource: spacingSemanticMeta.source,
  });

  const modeAnalysis = spacingCollectionModeAnalysis(effective, figmaData);

  const result = {
    model,
    category: SPACING_SEMANTIC_CATEGORY,
    spacingSemanticSource: spacingSemanticMeta.source,
    spacingModeAnalysis: modeAnalysis,
    repairs: [],
    configDrift: [],
    missingPrimitives: [],
    alreadyAliasedHealthy: [],
    unvalidatedDuplicatedResponsiveModeValues: [],
  };
  const spacingCollectionName = effective && effective.collections && effective.collections.spacing || "4. Spacing";
  const primitiveCollectionName = effective && effective.collections && effective.collections.primitives || "1. Primitives";
  const modeOrder = responsiveModeOrder(effective, figmaData, spacingCollectionName);
  if (!modeAnalysis.responsiveReady) {
    result.missingResponsiveModes = modeAnalysis.missing.slice();
  }
  if (!modeOrder.length) return result;

  const semantic = effective && effective.spacing && effective.spacing.semantic ? effective.spacing.semantic : {};
  const configSemantic = spacingSemanticMeta.configSemantic || {};
  const primitiveLookup = buildPrimitiveSpacingLookup(figmaData, primitiveCollectionName);
  const variableById = variableByIdMap(figmaData);
  const keysToPlan = spacingSemanticKeysForPlanning(semantic, figmaData, variableMap, spacingCollectionName);

  for (const key of keysToPlan) {
    const tokenName = "space/" + key;
    const variable = variableMap.get(tokenName);
    if (!variable || variable.resolvedType !== "FLOAT" || !variable.valuesByMode || typeof variable.valuesByMode !== "object") {
      continue;
    }

    const intendedValues = intendedValuesForSpacingToken(key, semantic, variable, modeOrder, variableById);
    if (!intendedValues) continue;
    const configValues = Object.prototype.hasOwnProperty.call(configSemantic, key)
      ? (Array.isArray(configSemantic[key]) ? configSemantic[key] : [configSemantic[key]])
      : null;
    const updates = [];
    const driftModes = [];
    const missingModes = [];
    const aliasTargetsByMode = new Map();
    let modesNeedingWork = 0;
    let modesHealthyViaAlias = 0;

    for (const mode of modeOrder) {
      const intended = intendedValues[mode.bpIndex] != null ? intendedValues[mode.bpIndex] : intendedValues[intendedValues.length - 1];
      const configExpected = configValues
        ? (configValues[mode.bpIndex] != null ? configValues[mode.bpIndex] : configValues[configValues.length - 1])
        : intended;
      const aliasTarget = resolvePrimitiveAliasTarget(primitiveLookup, intended);
      const currentValue = variable.valuesByMode[mode.modeId];
      const currentRaw = floatRawValue(currentValue);
      if (aliasTarget) aliasTargetsByMode.set(mode.modeId, aliasTarget);

      if (isAliasVariableValue(currentValue) && aliasTarget && currentValue.id === aliasTarget.id) {
        modesHealthyViaAlias += 1;
        continue;
      }

      const aliasResolved = isAliasVariableValue(currentValue)
        ? resolveNumericFromVariableValue(currentValue, variableById)
        : null;
      const aliasResolvesToIntended = aliasResolved !== null && floatsEqual(aliasResolved, intended);

      if (aliasResolvesToIntended) {
        modesHealthyViaAlias += 1;
        continue;
      }

      if (!aliasTarget) {
        if (configValues && currentRaw !== null && !floatsEqual(currentRaw, configExpected)) {
          driftModes.push({
            modeId: mode.modeId,
            modeName: mode.modeName,
            configExpected,
            currentValue: currentRaw,
            reason: "Figma raw value does not match config for this mode, and no primitive alias target exists for the expected value.",
          });
          continue;
        }
        missingModes.push({
          modeId: mode.modeId,
          modeName: mode.modeName,
          configExpected: intended,
          primitiveName: "space/" + sanitizeSpaceStep(intended) + " (or primitive with value " + intended + ")",
          reason: "No primitive spacing variable matches this pixel value; create the matching primitive before semantic alias repair.",
        });
        continue;
      }

      if (isAliasVariableValue(currentValue) && currentValue.id !== aliasTarget.id) {
        updates.push({
          modeId: mode.modeId,
          modeName: mode.modeName,
          from: currentValue,
          currentResolved: aliasResolved,
          configExpected: intended,
          toAliasName: aliasTarget.name,
          toAliasId: aliasTarget.id,
        });
        continue;
      }

      if (currentRaw !== null) {
        updates.push({
          modeId: mode.modeId,
          modeName: mode.modeName,
          from: currentValue,
          configExpected: intended,
          toAliasName: aliasTarget.name,
          toAliasId: aliasTarget.id,
        });
      }
    }

    if (updates.length) {
      modesNeedingWork += updates.length;
      result.repairs.push({ name: tokenName, updates });
    }
    if (driftModes.length) {
      modesNeedingWork += driftModes.length;
      result.configDrift.push({ name: tokenName, modes: driftModes });
    }
    if (missingModes.length) {
      modesNeedingWork += missingModes.length;
      result.missingPrimitives.push({ name: tokenName, modes: missingModes });
    }
    if (!modesNeedingWork && modesHealthyViaAlias > 0 && modeOrder.length) {
      const duplicatedModeValues = modeAnalysis.responsiveReady
        ? duplicatedResponsiveModeValueAdvisory({
          ds: effective,
          key,
          tokenName,
          modeOrder,
          variable,
          variableById,
          aliasTargetsByMode,
        })
        : null;
      result.alreadyAliasedHealthy.push({
        name: tokenName,
        modesHealthy: modesHealthyViaAlias,
        duplicatedModeValues,
        note: "All breakpoint modes already alias to primitives that resolve to the intended pixel values. No spacing-semantics alias repair is required; optional step-scale normalization is a separate design decision.",
      });
      if (duplicatedModeValues) result.unvalidatedDuplicatedResponsiveModeValues.push(duplicatedModeValues);
    }
  }

  return result;
}

function enrichAuditTokensWithSpacingAliasRepairs(auditResult, options = {}) {
  const ds = options.ds;
  const figmaData = options.figmaData;
  if (!ds || !figmaData || !auditResult || auditResult.error) {
    return Object.assign({}, auditResult, { semanticAliasRepairModel: SEMANTIC_ALIAS_REPAIR_MODEL });
  }

  const variableMap = new Map();
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  for (const variable of variables) {
    if (variable && typeof variable.name === "string") variableMap.set(variable.name, variable);
  }

  const effective = withEffectiveSpacingSemantic(ds, figmaData, variableMap);
  const plan = planSpacingSemanticAliasRepairs(ds, figmaData, variableMap, {
    effectiveDs: effective.ds,
    spacingSemanticMeta: effective.spacingSemanticMeta,
  });
  const repairableNames = new Set(plan.repairs.map(item => item.name));
  const unaliased = Array.isArray(auditResult.unaliased) ? auditResult.unaliased : [];
  const partiallyUnaliased = Array.isArray(auditResult.partiallyUnaliased) ? auditResult.partiallyUnaliased : [];
  const repairableUnaliased = [];
  const repairablePartiallyUnaliased = [];
  const manualFollowUpUnaliased = [];

  for (const row of unaliased) {
    if (!row || !row.name) continue;
    if (isSpacingSemanticTokenName(row.name) && repairableNames.has(row.name)) {
      repairableUnaliased.push(row);
    } else {
      manualFollowUpUnaliased.push(row);
    }
  }
  for (const row of partiallyUnaliased) {
    if (!row || !row.name) continue;
    if (repairableNames.has(row.name)) repairablePartiallyUnaliased.push(row);
    else manualFollowUpUnaliased.push(row);
  }

  const enriched = Object.assign({}, auditResult, {
    semanticAliasRepairModel: plan.model,
    spacingSemanticSource: plan.spacingSemanticSource,
    repairableUnaliased,
    repairablePartiallyUnaliased,
    manualFollowUpUnaliased,
  });

  if (plan.repairs.length) {
    enriched.repairGuidance = {
      category: SPACING_SEMANTIC_CATEGORY,
      inspectTool: "inspect_ds_token_gaps",
      applyTool: "update_ds_tokens",
      repairableCount: plan.repairs.length,
      partiallyUnaliasedCount: repairablePartiallyUnaliased.length,
      configDriftCount: plan.configDrift.length,
      missingPrimitiveCount: plan.missingPrimitives.length,
      spacingSemanticSource: plan.spacingSemanticSource,
      message:
        "Figlets found semantic spacing tokens with raw pixel values in one or more breakpoint modes (including tokens that are already aliased on Mobile but still raw on Tablet or Desktop). Run inspect_ds_token_gaps for repairPlan.previewInput/applyInput, dry-run update_ds_tokens, then apply with dry_run:false.",
      nextSteps: [
        "inspect_ds_token_gaps with categories including spacing-semantics",
        "update_ds_tokens dry_run:true using repairPlan.previewInput",
        "update_ds_tokens dry_run:false using repairPlan.applyInput after explicit approval",
        "inspect_ds_token_gaps again to verify spacing alias repairs cleared",
      ],
    };
    enriched.semanticAliasRepairPlan = {
      category: SPACING_SEMANTIC_CATEGORY,
      repairableTokenNames: plan.repairs.map(item => item.name),
      configDrift: plan.configDrift,
      missingPrimitives: plan.missingPrimitives,
      spacingSemanticSource: plan.spacingSemanticSource,
    };
  }

  return enriched;
}

module.exports = {
  SEMANTIC_ALIAS_REPAIR_MODEL,
  SPACING_SEMANTIC_CATEGORY,
  isAliasVariableValue,
  isSpacingSemanticTokenName,
  isPrimitiveSpacingTokenName,
  buildPrimitiveSpacingLookup,
  resolvePrimitiveAliasTarget,
  expectedBreakpointModeNames,
  spacingCollectionModeAnalysis,
  inferSpacingSemanticFromSnapshot,
  mergedSpacingSemantic,
  withEffectiveSpacingSemantic,
  planSpacingSemanticAliasRepairs,
  spacingTokenAllowsSameResponsiveModeValues,
  enrichAuditTokensWithSpacingAliasRepairs,
};
