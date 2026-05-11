const fs = require("fs");
const path = require("path");
const { getActiveFileKey, getActiveFileConfigPath, getActiveFilePaths } = require("../utils/paths.js");
const { loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { computePlannedAliases, loadDsConfigSafe } = require("../utils/accessible-repair-aliases.js");

const inspectDsSetupGapsTool = {
  name: "inspect_ds_setup_gaps",
  description:
    "Read the current synced Figma snapshot and report setup repair gaps without mutating Figma or config. Use before any confirmed setup repair, especially for missing semantic foreground companions.",
  inputSchema: {
    type: "object",
    properties: {
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      }
    },
    additionalProperties: false
  }
};

function _norm(value) {
  return String(value == null ? "" : value).toLowerCase();
}

function _isVariantLikeLeaf(leaf) {
  const n = _norm(leaf);
  return n === "variant" || /-(variant|subtle)$/.test(n);
}

function _stripVariantSuffix(leaf) {
  const value = String(leaf || "");
  if (/-(variant|subtle)$/i.test(value)) return value.replace(/-(variant|subtle)$/i, "");
  return value;
}

function _sameCaseSegment(sourceSegment, replacement) {
  if (/^[A-Z0-9_-]+$/.test(sourceSegment)) return replacement.toUpperCase();
  if (/^[A-Z]/.test(sourceSegment)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function _targetFamiliesFor(bgSegment, allNames) {
  const segment = _norm(bgSegment);
  const preferred = segment === "surface"
    ? ["on-surface", "text", "fg", "foreground"]
    : segment === "background"
      ? ["on-background", "text", "fg", "foreground"]
      : ["text", "fg", "foreground", "on-bg"];

  return preferred.sort((left, right) => {
    const leftSeen = allNames.some(name => name.split("/").some(part => _norm(part) === left));
    const rightSeen = allNames.some(name => name.split("/").some(part => _norm(part) === right));
    if (leftSeen === rightSeen) return 0;
    return leftSeen ? -1 : 1;
  });
}

function _aliasTargetNames(variable, varsById, collections) {
  const result = {};
  const values = variable && variable.valuesByMode ? variable.valuesByMode : {};
  const modeIds = Object.keys(values);
  const coll = collections.find(collection => collection.id === variable.variableCollectionId)
    || collections.find(collection => Array.isArray(collection.variableIds) && collection.variableIds.includes(variable.id))
    || null;

  for (const modeId of modeIds) {
    const raw = values[modeId];
    if (!raw || typeof raw !== "object" || raw.type !== "VARIABLE_ALIAS") continue;
    const target = varsById.get(raw.id);
    const mode = coll && Array.isArray(coll.modes)
      ? coll.modes.find(m => m.modeId === modeId)
      : null;
    result[mode ? mode.name : modeId] = target ? target.name : raw.id;
  }

  return result;
}

function inspectDsSetupGapsFromFigmaData(figmaData = {}) {
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const colorVars = variables.filter(v => v && v.resolvedType === "COLOR" && typeof v.name === "string");
  const byName = new Map(colorVars.map(v => [v.name, v]));
  const varsById = new Map(variables.map(v => [v.id, v]));
  const names = colorVars.map(v => v.name);
  const semanticGaps = [];

  for (const variable of colorVars) {
    const parts = variable.name.split("/");
    const bgIndex = parts.findIndex(part => ["surface", "bg", "background"].includes(_norm(part)));
    if (bgIndex < 0) continue;

    const leaf = parts[parts.length - 1];
    if (!_isVariantLikeLeaf(leaf)) continue;

    const families = _targetFamiliesFor(parts[bgIndex], names);
    const companionCandidates = families.map(family => {
      const next = parts.slice();
      next[bgIndex] = _sameCaseSegment(parts[bgIndex], family);
      return next.join("/");
    });
    if (companionCandidates.some(candidate => byName.has(candidate))) continue;

    const recommended = companionCandidates[0];
    const baseLeaf = _stripVariantSuffix(leaf);
    const sourceCandidates = [];
    for (const family of families) {
      const next = parts.slice();
      next[bgIndex] = _sameCaseSegment(parts[bgIndex], family);
      next[next.length - 1] = baseLeaf;
      sourceCandidates.push(next.join("/"));
    }
    for (const family of families) {
      const next = parts.slice();
      next[bgIndex] = _sameCaseSegment(parts[bgIndex], family);
      next[next.length - 1] = "default";
      sourceCandidates.push(next.join("/"));
    }

    const source = sourceCandidates.find(candidate => byName.has(candidate)) || null;
    const sourceVariable = source ? byName.get(source) : null;

    semanticGaps.push({
      kind: "missing-foreground-companion",
      bg: variable.name,
      recommended,
      source,
      sourceAliases: sourceVariable ? _aliasTargetNames(sourceVariable, varsById, collections) : {},
      reason: "Variant-like background token has no matching foreground companion.",
      status: source ? "proposed" : "unresolved",
    });
  }

  semanticGaps.sort((left, right) => left.bg.localeCompare(right.bg));

  return {
    semanticGaps,
    summary: {
      semanticGapCount: semanticGaps.length,
      proposedCount: semanticGaps.filter(gap => gap.status === "proposed").length,
      unresolvedCount: semanticGaps.filter(gap => gap.status === "unresolved").length,
    },
  };
}

function _loadDefaultActiveSnapshot() {
  const activePaths = getActiveFilePaths();
  if (!fs.existsSync(activePaths.data)) return null;
  return {
    kind: "active-file-snapshot",
    target: getActiveFileKey() || activePaths.data,
    figmaData: JSON.parse(fs.readFileSync(activePaths.data, "utf8")),
    meta: { path: activePaths.data }
  };
}

function handleInspectDsSetupGaps(input = {}) {
  const dataSource = input.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: input.figmaDataPath })
    : (_loadDefaultActiveSnapshot() || loadFigmaDataSource(input));

  if (!dataSource) {
    return {
      error: "No synced Figma snapshot found.",
      hint: "Run sync_figma_data first, then inspect setup gaps again."
    };
  }

  const result = inspectDsSetupGapsFromFigmaData(dataSource.figmaData);

  // Compute the per-mode primitive aliases the designer would actually get if
  // they approved the proposed repair. This is what `apply_ds_setup_repairs`
  // will use verbatim, so what the designer sees here matches what gets
  // written to Figma. Falls back silently when the snapshot or config don't
  // support the picker (apply will recompute or copy-values).
  const configPath = input.config_path ? path.resolve(input.config_path) : getActiveFileConfigPath();
  const existingDs = loadDsConfigSafe(configPath);
  const answers = (input.answers && typeof input.answers === "object") ? input.answers : {};
  const algoOpt = { algorithm: answers.algorithm === "apca" ? "apca" : "wcag" };

  for (const gap of result.semanticGaps) {
    if (gap.status !== "proposed" || !gap.source) continue;
    const repair = { bg: gap.bg, name: gap.recommended, source: gap.source };
    const planned = computePlannedAliases(repair, dataSource.figmaData, existingDs, algoOpt);
    if (!planned) continue;
    gap.plannedAliases = planned.aliases;
    gap.plannedAlgorithm = planned.algorithm;
    gap.plannedUpgrades = planned.upgraded;
  }

  return {
    ...result,
    source: {
      kind: dataSource.kind,
      target: dataSource.target,
      path: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
    },
    message: result.summary.semanticGapCount
      ? "Setup gaps found. Review with the designer; pass each gap's plannedAliases through to apply_ds_setup_repairs to keep approve-then-apply consistent."
      : "No setup repair gaps found in the synced Figma snapshot.",
  };
}

module.exports = {
  inspectDsSetupGapsTool,
  handleInspectDsSetupGaps,
  inspectDsSetupGapsFromFigmaData,
};
