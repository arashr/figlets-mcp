const { requestBridgePost } = require("../bridges/bridge-request.js");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { inspectDsSetupGapsFromFigmaData } = require("./inspect-ds-setup-gaps.js");

const planSemanticNamingConsolidationTool = {
  name: "plan_ds_semantic_naming_consolidation",
  description:
    "Read-only planner for designer-approved semantic color naming consolidation after inspect_ds_setup_gaps reports semanticNamingConflicts. Prefer passing the intended semantic color grammar (`paired-context`, `element-first`, `intent-emphasis`, `component-scoped`, or `custom`) plus exact decisions; legacy canonicalConvention is accepted for compatibility but should not be used as the default designer flow. Returns exact canonical and duplicate variables, value/alias equivalence, safe rename-only applyInput, and separate unsafe delete/deprecate notes. Never mutates Figma.",
  inputSchema: {
    type: "object",
    properties: {
      grammar: {
        type: "string",
        enum: ["paired-context", "element-first", "intent-emphasis", "component-scoped", "custom"],
        description: "The semantic color naming grammar the designer intends to use. Prefer this over the legacy binary canonicalConvention."
      },
      decisions: {
        type: "array",
        description: "Optional exact context decisions for a future grammar-aware migration slice. Current rename-only apply supports high-confidence invalid/duplicate diagnostics from the planner.",
        items: { type: "object" }
      },
      canonicalConvention: {
        type: "string",
        enum: ["surface-based", "role-based"],
        description: "Legacy compatibility input. Do not present this binary choice as the default designer flow."
      },
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      }
    },
    additionalProperties: false
  }
};

const applySemanticNamingConsolidationTool = {
  name: "apply_ds_semantic_naming_consolidation",
  description:
    "Apply designer-approved semantic naming consolidation from plan_ds_semantic_naming_consolidation.repairPlan.applyInput. This narrow first slice only renames duplicate variables to a compatibility namespace, preserving variable IDs and rejecting stale approvals. It never deletes variables.",
  inputSchema: {
    type: "object",
    properties: {
      grammar: {
        type: "string",
        enum: ["paired-context", "element-first", "intent-emphasis", "component-scoped", "custom"]
      },
      canonicalConvention: {
        type: "string",
        enum: ["surface-based", "role-based"]
      },
      decisions: {
        type: "array",
        items: { type: "object" },
        description: "Optional exact decisions copied from the planner for grammar-aware true-duplicate consolidation."
      },
      renameVariables: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            expectedCurrentName: { type: "string" },
            newName: { type: "string" },
            canonicalName: { type: "string" },
            canonicalId: { type: "string" },
            family: { type: "string" },
            role: { type: "string" },
            expectedEquivalence: { type: "object" },
            reason: { type: "string" }
          },
          required: ["id", "expectedCurrentName", "newName", "canonicalName", "canonicalId", "expectedEquivalence"]
        }
      }
    },
    required: ["renameVariables"],
    additionalProperties: false
  }
};

function _loadDataSource(input = {}) {
  return input.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: input.figmaDataPath })
    : (loadActiveFigmaDataSource(input) || loadFigmaDataSource(input));
}

function _collectionFor(variable, collections) {
  if (!variable) return null;
  return (collections || []).find(collection => {
    if (variable.variableCollectionId && collection.id === variable.variableCollectionId) return true;
    return Array.isArray(collection.variableIds) && collection.variableIds.indexOf(variable.id) !== -1;
  }) || null;
}

function _modeNameFor(collection, modeId) {
  const mode = collection && Array.isArray(collection.modes)
    ? collection.modes.find(item => item.modeId === modeId)
    : null;
  return mode ? (mode.name || mode.modeId) : modeId;
}

function _valueSignature(value) {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (value.type === "VARIABLE_ALIAS") return `alias:${value.id}`;
  const keys = Object.keys(value).sort();
  const out = {};
  for (const key of keys) out[key] = value[key];
  return JSON.stringify(out);
}

function _isPrimitiveColorName(name) {
  if (typeof name !== "string") return false;
  const parts = name.split("/");
  if (parts.length !== 3 || parts[0] !== "color") return false;
  return /^\d+$/.test(parts[2]);
}

function _isSemanticColorName(name) {
  return typeof name === "string"
    && name.indexOf("color/") === 0
    && !_isPrimitiveColorName(name);
}

function _isDeprecatedSemanticColorName(name, expectedCurrentName) {
  return typeof name === "string"
    && name === _deprecatedName(expectedCurrentName)
    && _isSemanticColorName(expectedCurrentName);
}

function _valueDetail(value, varsById) {
  if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
    const target = varsById.get(value.id);
    return {
      kind: "alias",
      id: value.id,
      name: target ? target.name : null,
    };
  }
  return { kind: "literal", value };
}

function _compareValues(canonical, duplicate, collections, varsById) {
  const canonicalCollection = _collectionFor(canonical, collections);
  const duplicateCollection = _collectionFor(duplicate, collections);
  const modeIds = Array.from(new Set(
    Object.keys(canonical.valuesByMode || {}).concat(Object.keys(duplicate.valuesByMode || {}))
  )).sort();
  const modes = [];
  let mismatches = 0;
  for (const modeId of modeIds) {
    const canonicalValue = (canonical.valuesByMode || {})[modeId];
    const duplicateValue = (duplicate.valuesByMode || {})[modeId];
    const matches = _valueSignature(canonicalValue) === _valueSignature(duplicateValue);
    if (!matches) mismatches += 1;
    modes.push({
      modeId,
      mode: _modeNameFor(canonicalCollection, modeId) || _modeNameFor(duplicateCollection, modeId),
      canonicalSignature: _valueSignature(canonicalValue),
      duplicateSignature: _valueSignature(duplicateValue),
      canonical: _valueDetail(canonicalValue, varsById),
      duplicate: _valueDetail(duplicateValue, varsById),
      matches,
    });
  }
  return {
    status: modeIds.length && mismatches === 0 ? "equivalent" : "different",
    modeCount: modeIds.length,
    mismatchCount: mismatches,
    modes,
  };
}

function _deprecatedName(name) {
  return `_deprecated/${String(name || "").replace(/^\/+/, "")}`;
}

function _normalizeDecisionRole(role) {
  const value = String(role || "").trim();
  if (value === "foreground" || value === "fg") return "text";
  if (value === "background") return "bg";
  return value;
}

function _normalizeDecisionContext(context) {
  const value = String(context || "").trim();
  if (value.indexOf("on-") === 0) return value.slice(3);
  return value;
}

function _decisionMatchesConflict(decision, conflict) {
  if (!decision || !conflict) return false;
  if (decision.family && conflict.family && String(decision.family) !== String(conflict.family)) return false;
  if (decision.role && conflict.role && _normalizeDecisionRole(decision.role) !== _normalizeDecisionRole(conflict.role)) return false;
  if (decision.assetRole && conflict.role && _normalizeDecisionRole(decision.assetRole) !== _normalizeDecisionRole(conflict.role)) return false;
  if (decision.context && conflict.context && _normalizeDecisionContext(decision.context) !== _normalizeDecisionContext(conflict.context)) return false;
  const decisionTokens = []
    .concat(decision.tokens || [])
    .concat(decision.duplicateTokens || [])
    .concat(decision.duplicates || [])
    .concat(decision.canonicalToken || [])
    .concat(decision.canonicalName || [])
    .filter(Boolean)
    .map(String)
    .sort();
  if (!decisionTokens.length) return true;
  const conflictTokens = conflict.tokens && Array.isArray(conflict.tokens.duplicates)
    ? conflict.tokens.duplicates.slice().sort()
    : [];
  if (!conflictTokens.length) return true;
  return decisionTokens.every(token => conflictTokens.indexOf(token) !== -1);
}

function _decisionForConflict(conflict, decisions) {
  if (conflict && conflict.conflictType !== "true-duplicate") return null;
  return (Array.isArray(decisions) ? decisions : []).find(decision => _decisionMatchesConflict(decision, conflict)) || null;
}

function _decisionCanonicalName(decision) {
  if (!decision) return null;
  return String(decision.canonicalToken || decision.canonicalName || decision.keep || "").trim() || null;
}

function _decisionDuplicateNames(decision, conflict) {
  const canonicalName = _decisionCanonicalName(decision);
  const explicit = []
    .concat(decision && (decision.duplicateTokens || decision.duplicates || decision.deprecate || []) || [])
    .filter(Boolean)
    .map(item => String(item).trim())
    .filter(Boolean);
  if (explicit.length) return explicit.filter(name => name !== canonicalName);
  const candidates = conflict && conflict.tokens && Array.isArray(conflict.tokens.duplicates)
    ? conflict.tokens.duplicates
    : [];
  return candidates.filter(name => name !== canonicalName);
}

function _canonicalNamesForConflict(conflict, canonicalConvention, decisions) {
  const tokens = conflict.tokens || {};
  if (conflict.conflictType === "true-duplicate") {
    const decision = _decisionForConflict(conflict, decisions);
    const canonicalName = _decisionCanonicalName(decision);
    return canonicalName ? [canonicalName] : [];
  }
  if (canonicalConvention === "surface-based") return Array.isArray(tokens.surfaceBased) ? tokens.surfaceBased.slice() : [];
  if (conflict.conflictType === "invalid-on-background") {
    return Array.isArray(tokens.relatedFill) ? tokens.relatedFill.slice() : [];
  }
  return Array.isArray(tokens.roleBased) ? tokens.roleBased.slice() : [];
}

function _duplicateNamesForConflict(conflict, canonicalConvention, decisions) {
  const tokens = conflict.tokens || {};
  if (conflict.conflictType === "true-duplicate") {
    const decision = _decisionForConflict(conflict, decisions);
    return decision ? _decisionDuplicateNames(decision, conflict) : [];
  }
  if (canonicalConvention === "surface-based") return Array.isArray(tokens.roleBased) ? tokens.roleBased.slice() : [];
  if (conflict.conflictType === "invalid-on-background") {
    return []
      .concat(Array.isArray(tokens.surfaceBased) ? tokens.surfaceBased : [])
      .concat(Array.isArray(tokens.roleBased) ? tokens.roleBased : []);
  }
  return Array.isArray(tokens.surfaceBased) ? tokens.surfaceBased.slice() : [];
}

function planSemanticNamingConsolidationFromFigmaData(figmaData = {}, input = {}) {
  const grammar = input.grammar || null;
  const decisions = Array.isArray(input.decisions) ? input.decisions : [];
  const canonicalConvention = input.canonicalConvention || (grammar === "paired-context" ? "role-based" : null);
  if (canonicalConvention && canonicalConvention !== "surface-based" && canonicalConvention !== "role-based") {
    return { error: "canonicalConvention must be either surface-based or role-based when used." };
  }
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const varsByName = new Map(variables.filter(v => v && v.name).map(v => [v.name, v]));
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));
  const setupResult = inspectDsSetupGapsFromFigmaData(figmaData);
  const conflicts = setupResult.semanticNamingConflicts || [];
  const items = [];
  const renameVariables = [];
  const unsafeActions = [];

  for (const conflict of conflicts) {
    if (!canonicalConvention && conflict.conflictType !== "true-duplicate") {
      const blocked = {
        family: conflict.family,
        role: conflict.role,
        grammar,
        canonicalToken: null,
        duplicateTokens: []
          .concat((conflict.tokens && conflict.tokens.surfaceBased) || [])
          .concat((conflict.tokens && conflict.tokens.roleBased) || []),
        status: "blocked",
        reason: "This naming conflict needs an explicit grammar/context decision before Figlets can plan compatibility renames. Figlets will not default a non-paired grammar into surface-based or role-based cleanup.",
      };
      items.push(blocked);
      unsafeActions.push({
        family: conflict.family,
        role: conflict.role,
        reason: blocked.reason,
        tokens: blocked.duplicateTokens,
      });
      continue;
    }
    const canonicalNames = _canonicalNamesForConflict(conflict, canonicalConvention, decisions);
    const duplicateNames = _duplicateNamesForConflict(conflict, canonicalConvention, decisions);
    const canonicalName = canonicalNames.find(name => varsByName.has(name)) || canonicalNames[0] || null;
    const canonical = canonicalName ? varsByName.get(canonicalName) : null;

    if (!canonical) {
      const reason = conflict.conflictType === "true-duplicate"
        ? "True duplicate cleanup needs a designer-approved canonical token. Pass a decision such as { canonicalToken, duplicateTokens } from the conflict's candidate list."
        : canonicalConvention === "role-based" && conflict.conflictType === "invalid-on-background"
          ? "Role-based consolidation for an invalid bg/on-* token needs an existing color/fill/* canonical variable. Figlets will not keep invalid bg/on-* as canonical."
          : "No canonical variable exists in the chosen convention.";
      items.push({
        family: conflict.family,
        role: conflict.role,
        canonicalConvention,
        canonicalToken: canonicalName,
        duplicateTokens: duplicateNames,
        status: "blocked",
        reason,
      });
      unsafeActions.push({
        family: conflict.family,
        role: conflict.role,
        token: canonicalName,
        duplicateTokens: duplicateNames,
        reason,
      });
      continue;
    }

    for (const duplicateName of duplicateNames) {
      const duplicate = varsByName.get(duplicateName);
      if (!duplicate) continue;
      const equivalence = _compareValues(canonical, duplicate, collections, varsById);
      const newName = _deprecatedName(duplicate.name);
      const renameSafe = equivalence.status === "equivalent" || equivalence.status === "different";
      const item = {
        family: conflict.family,
        role: conflict.role,
        canonicalConvention,
        canonicalToken: {
          id: canonical.id,
          name: canonical.name,
        },
        duplicateToken: {
          id: duplicate.id,
          name: duplicate.name,
        },
        equivalence,
        safeOperations: [],
        unsafeOperations: [{
          kind: "delete-variable",
          supported: false,
          reason: "Deleting duplicate semantic variables can break existing Figma bindings and is not part of this safe consolidation surface.",
        }],
      };
      if (conflict.conflictType === "true-duplicate" && equivalence.status !== "equivalent") {
        unsafeActions.push({
          token: duplicate.name,
          canonicalName: canonical.name,
          family: conflict.family,
          role: conflict.role,
          expectedEquivalence: {
            status: equivalence.status,
            modeCount: equivalence.modeCount,
            mismatchCount: equivalence.mismatchCount,
          },
          reason: "True duplicate values differ from the approved canonical token. Figlets will not hide a value difference by deprecating one name; review whether these are actually different roles or update values first.",
        });
        item.status = "manual-review";
        items.push(item);
        continue;
      }
      if (renameSafe) {
        const rename = {
          id: duplicate.id,
          expectedCurrentName: duplicate.name,
          newName,
          canonicalName: canonical.name,
          canonicalId: canonical.id,
          family: conflict.family,
          role: conflict.role,
          expectedEquivalence: {
            status: equivalence.status,
            modeCount: equivalence.modeCount,
            modes: equivalence.modes.map(mode => ({
              modeId: mode.modeId,
              mode: mode.mode,
              canonicalSignature: mode.canonicalSignature,
              duplicateSignature: mode.duplicateSignature,
            })),
          },
          reason: equivalence.status === "equivalent"
            ? "Duplicate values match the canonical variable in every synced mode; rename preserves the variable ID for existing layer bindings while removing it from semantic naming QA."
            : "Duplicate values differ from the canonical variable, so Figlets will not merge aliases or change values. Rename only preserves the variable ID and existing mapped values while moving the duplicate into a compatibility namespace.",
        };
        item.safeOperations.push({
          kind: "rename-variable-for-compatibility",
          from: duplicate.name,
          to: newName,
          preservesVariableId: true,
          bindingSafety: equivalence.status === "equivalent"
            ? "Existing bindings to this variable ID are preserved, but the token name changes. Sync and rerun setup-gap QA after apply."
            : "Existing bindings and values are preserved because this is a name-only compatibility rename. Review that the deprecated variable should remain outside the canonical semantic token set.",
        });
        renameVariables.push(rename);
      } else {
        unsafeActions.push({
          token: duplicate.name,
          canonicalName: canonical.name,
          reason: "Duplicate values or aliases differ from the canonical token in at least one mode; Figlets will not rename it automatically.",
        });
      }
      items.push(item);
    }
  }

  const applyInput = { renameVariables };
  if (canonicalConvention) applyInput.canonicalConvention = canonicalConvention;
  if (grammar) applyInput.grammar = grammar;
  if (decisions.length) applyInput.decisions = decisions;
  const designerLines = [];
  if (renameVariables.length) {
    designerLines.push(`Figlets can safely rename ${renameVariables.length} duplicate semantic variable${renameVariables.length === 1 ? "" : "s"} into a compatibility namespace after you approve.`);
  } else {
    designerLines.push("Figlets found no rename-only semantic naming changes safe enough to apply automatically.");
  }
  if (unsafeActions.length) {
    designerLines.push(`${unsafeActions.length} duplicate variable${unsafeActions.length === 1 ? "" : "s"} need manual review because Figlets could not produce a name-only compatibility rename.`);
  }

  return {
    message: conflicts.length
      ? `Semantic naming consolidation dry-run for ${grammar || canonicalConvention}: ${renameVariables.length} safe rename${renameVariables.length === 1 ? "" : "s"}, ${unsafeActions.length} manual review item${unsafeActions.length === 1 ? "" : "s"}.`
      : "No semantic naming conflicts found in the synced snapshot.",
    canonicalConvention,
    grammar,
    dryRun: true,
    semanticColorGrammar: setupResult.semanticColorGrammar,
    semanticNamingAdvisories: setupResult.semanticNamingAdvisories || [],
    conflicts: items,
    repairPlan: {
      tool: "apply_ds_semantic_naming_consolidation",
      approvalRequired: true,
      applyInput,
      counts: {
        conflicts: conflicts.length,
        safeRenames: renameVariables.length,
        manualReview: unsafeActions.length,
      },
      designerPresentation: {
        audience: "designer",
        sayToDesigner: designerLines,
        proposedChanges: renameVariables.map(rename => ({
          token: rename.expectedCurrentName,
          action: "rename for compatibility",
          to: rename.newName,
          canonicalToken: rename.canonicalName,
          summaryLine: `Rename ${rename.expectedCurrentName} to ${rename.newName}; keep ${rename.canonicalName} as the canonical token for this grammar-aware cleanup.`,
        })),
        manualReview: unsafeActions,
        advisories: setupResult.semanticNamingAdvisories || [],
        approvalPrompt: renameVariables.length
          ? "Review the exact rename list above. Some entries may keep different mapped values; Figlets will only rename those variables into _deprecated/... and preserve their variable IDs."
          : null,
      },
      agentInstruction: renameVariables.length
        ? "Show every repairPlan.designerPresentation.proposedChanges entry and every repairPlan.designerPresentation.manualReview entry before asking approval. Make clear that value-different proposedChanges are name-only compatibility renames into _deprecated/...; Figlets will not merge aliases, change values, or delete variables. If approved, pass repairPlan.applyInput unchanged to apply_ds_semantic_naming_consolidation, then sync and rerun inspect_ds_setup_gaps."
        : "Do not invent custom scripts or deletes. Explain the manual-review items and keep destructive cleanup out of the apply payload.",
    },
  };
}

function handlePlanSemanticNamingConsolidation(input = {}) {
  const dataSource = _loadDataSource(input);
  if (!dataSource) {
    return {
      error: "No synced Figma snapshot found.",
      hint: "Run sync_figma_data first, then plan semantic naming consolidation again."
    };
  }
  const result = planSemanticNamingConsolidationFromFigmaData(dataSource.figmaData, input);
  result.source = {
    kind: dataSource.kind,
    target: dataSource.target,
    path: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
  };
  return result;
}

function _normalizeRenameVariables(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    id: item && item.id ? String(item.id) : "",
    expectedCurrentName: item && item.expectedCurrentName ? String(item.expectedCurrentName) : "",
    newName: item && item.newName ? String(item.newName) : "",
    canonicalName: item && item.canonicalName ? String(item.canonicalName) : "",
    canonicalId: item && item.canonicalId ? String(item.canonicalId) : "",
    family: item && item.family ? String(item.family) : "",
    role: item && item.role ? String(item.role) : "",
    expectedEquivalence: item && item.expectedEquivalence && typeof item.expectedEquivalence === "object" ? item.expectedEquivalence : null,
    reason: item && item.reason ? String(item.reason) : "",
  })).filter(item => item.id && item.expectedCurrentName && item.newName && item.canonicalName && item.canonicalId && item.expectedEquivalence);
}

function _validateRenameVariables(renameVariables) {
  for (let i = 0; i < renameVariables.length; i++) {
    const item = renameVariables[i];
    const label = `renameVariables[${i}]`;
    if (!_isSemanticColorName(item.expectedCurrentName)) {
      return `${label}.expectedCurrentName must be a semantic color variable name from the planner.`;
    }
    if (!_isSemanticColorName(item.canonicalName)) {
      return `${label}.canonicalName must be a semantic color variable name from the planner.`;
    }
    if (!_isDeprecatedSemanticColorName(item.newName, item.expectedCurrentName)) {
      return `${label}.newName must exactly equal ${_deprecatedName(item.expectedCurrentName)}.`;
    }
    const equivalence = item.expectedEquivalence;
    if (!equivalence || !["equivalent", "different"].includes(equivalence.status) || !Array.isArray(equivalence.modes) || !equivalence.modes.length) {
      return `${label}.expectedEquivalence must be the per-mode signatures copied from plan_ds_semantic_naming_consolidation.`;
    }
    for (let modeIndex = 0; modeIndex < equivalence.modes.length; modeIndex++) {
      const mode = equivalence.modes[modeIndex] || {};
      if (!mode.modeId || typeof mode.canonicalSignature !== "string" || typeof mode.duplicateSignature !== "string") {
        return `${label}.expectedEquivalence.modes[${modeIndex}] must include modeId, canonicalSignature, and duplicateSignature.`;
      }
    }
  }
  return null;
}

function _stableJson(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map(_stableJson).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${_stableJson(value[key])}`).join(",")}}`;
}

function _renamePlanKey(item) {
  return _stableJson({
    id: item.id,
    expectedCurrentName: item.expectedCurrentName,
    newName: item.newName,
    canonicalName: item.canonicalName,
    canonicalId: item.canonicalId,
    family: item.family || "",
    role: item.role || "",
    expectedEquivalence: item.expectedEquivalence,
  });
}

function _freshPlanMembershipError(args, renameVariables) {
  const dataSource = _loadDataSource(args);
  if (!dataSource) {
    return "No synced Figma snapshot found. Run sync_figma_data, then rerun plan_ds_semantic_naming_consolidation and apply the fresh repairPlan.applyInput.";
  }
  const freshPlan = planSemanticNamingConsolidationFromFigmaData(dataSource.figmaData, {
    canonicalConvention: args.canonicalConvention,
    grammar: args.grammar,
    decisions: args.decisions,
  });
  if (freshPlan && freshPlan.error) return freshPlan.error;
  const planned = (((freshPlan || {}).repairPlan || {}).applyInput || {}).renameVariables || [];
  const plannedKeys = new Set(planned.map(_renamePlanKey));
  for (const item of renameVariables) {
    if (!plannedKeys.has(_renamePlanKey(item))) {
      return `Rename ${item.expectedCurrentName} -> ${item.newName} is not present in the fresh semantic naming consolidation plan for ${args.canonicalConvention || args.grammar || "the approved decisions"}. Rerun plan_ds_semantic_naming_consolidation and pass repairPlan.applyInput unchanged or filter entries without editing them.`;
    }
  }
  return null;
}

function handleApplySemanticNamingConsolidation(args = {}) {
  const canonicalConvention = args.canonicalConvention || null;
  const grammar = args.grammar || null;
  if (canonicalConvention && canonicalConvention !== "surface-based" && canonicalConvention !== "role-based") {
    return Promise.resolve({ error: "canonicalConvention must be either surface-based or role-based when provided." });
  }
  if (!canonicalConvention && !grammar) {
    return Promise.resolve({ error: "Provide canonicalConvention or grammar copied from plan_ds_semantic_naming_consolidation.repairPlan.applyInput." });
  }
  const renameVariables = _normalizeRenameVariables(args.renameVariables);
  if (!renameVariables.length) {
    return Promise.resolve({ error: "Provide at least one approved renameVariables entry copied from plan_ds_semantic_naming_consolidation.repairPlan.applyInput." });
  }
  const validationError = _validateRenameVariables(renameVariables);
  if (validationError) {
    return Promise.resolve({
      error: `Invalid semantic naming consolidation payload: ${validationError} Stop and rerun plan_ds_semantic_naming_consolidation, then pass repairPlan.applyInput unchanged or filter approved entries without editing them.`,
    });
  }
  const planMembershipError = _freshPlanMembershipError(args, renameVariables);
  if (planMembershipError) {
    return Promise.resolve({
      error: `Invalid semantic naming consolidation payload: ${planMembershipError}`,
    });
  }
  return requestBridgePost("/request-semantic-naming-consolidation", {
    canonicalConvention,
    grammar,
    renameVariables,
  }, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
  }).then((response) => {
    if (response.connectionError) return { error: response.connectionError };
    const parsed = response.data || {};
    const statusCode = response.statusCode;
    if (statusCode === 200) {
      const result = parsed.result || {};
      const baseMessage = result.message || "Semantic naming consolidation complete.";
      return {
        renamed: result.renamed || [],
        skipped: result.skipped || [],
        unresolved: result.unresolved || [],
        message: `${baseMessage} This is a naming-only compatibility result; rerun the same read-only health-check sequence before summarizing the file. If semantic naming conflicts are 0 but token hygiene findings, contrast failures, setup repairs, optional advisories, or token gaps remain, report those remaining findings separately and do not call the design system clean.`,
        verificationInstruction: "After apply, rerun the same read-only health-check sequence used for the initial check: sync_figma_data, detect_design_system, audit_tokens, then inspect_ds_setup_gaps. Report semanticNamingConflicts separately from audit token hygiene, textContrastFailures, iconContrastFailures, repairPlan.applyInput, repairPlan.optionalApplyInput, and missingCapabilityNotes. Do not say the file or design system is clean unless the full follow-up health check is clean.",
        error: result.error,
      };
    }
    if (statusCode === 409) {
      return {
        error: parsed.error || "The connected plugin does not advertise semantic naming consolidation. Reload the Figlets Bridge plugin.",
        activeSessionId: parsed.activeSessionId || null,
        pluginCapabilities: parsed.pluginCapabilities || [],
      };
    }
    if (statusCode === 503) {
      return { error: "Figma plugin is not listening for semantic naming consolidation. Open the Figlets Bridge plugin in Figma Desktop and try again." };
    }
    if (statusCode === 504) return { error: "Semantic naming consolidation timed out." };
    return { error: `Unexpected status ${statusCode}` };
  });
}

module.exports = {
  planSemanticNamingConsolidationTool,
  applySemanticNamingConsolidationTool,
  handlePlanSemanticNamingConsolidation,
  handleApplySemanticNamingConsolidation,
  planSemanticNamingConsolidationFromFigmaData,
  _normalizeRenameVariables,
  _validateRenameVariables,
  _freshPlanMembershipError,
  _valueSignature,
};
