"use strict";

/**
 * Shared accessible-alias picker for setup repairs.
 * Used by:
 *   - inspect_ds_setup_gaps → previews the plannedAliases to show the designer.
 *   - apply_ds_setup_repairs → recomputes only if the caller did not pass
 *     repair.aliases (legacy / no-preview flow).
 *
 * The picker reuses `validateSemanticPairs` so the contrast logic is identical
 * to the setup flow. No new contrast math here.
 */

const fs = require("fs");
const path = require("path");
const { bootstrapDsFromSnapshot } = require("./bootstrap-ds-from-figma.js");

function _isPrimitiveColorName(name) {
  if (typeof name !== "string") return false;
  const parts = name.split("/");
  if (parts.length !== 3 || parts[0] !== "color") return false;
  return /^\d+$/.test(parts[2]);
}

function _aliasTargetName(variable, varsById, modeId) {
  const values = variable && variable.valuesByMode ? variable.valuesByMode : {};
  const val = values[modeId];
  if (!val || typeof val !== "object" || val.type !== "VARIABLE_ALIAS") return null;
  const target = varsById.get(val.id);
  return target ? target.name : null;
}

function _collectionForVariable(variable, collections) {
  return collections.find(c => Array.isArray(c.variableIds) && c.variableIds.includes(variable.id))
    || collections.find(c => c.id === variable.variableCollectionId)
    || null;
}

function _modeIdByName(collection, name) {
  if (!collection || !Array.isArray(collection.modes)) return null;
  const lower = String(name || "").toLowerCase();
  const found = collection.modes.find(m => String(m.name || "").toLowerCase() === lower);
  return found ? found.modeId : null;
}

function _loadValidate() {
  try { return require("@figlets/core").dsConfig.validateSemanticPairs; }
  catch (e) { return require("../../../figlets-core/src/ds-config/index.js").validateSemanticPairs; }
}

function _loadReadDsConfig() {
  try { return require("@figlets/core").dsConfig.readDsConfig; }
  catch (e) { return require("../../../figlets-core/src/ds-config/index.js").readDsConfig; }
}

function loadDsConfigSafe(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return null;
  try { return _loadReadDsConfig()(configPath); }
  catch (err) { return null; }
}

// Locate the active Figma snapshot regardless of when paths.js cached LOCAL_DIR.
// FIGLETS_FIGMA_DATA_PATH > FIGLETS_LOCAL_DIR (re-read) > cached paths.js result.
function loadActiveSnapshot(getActiveFilePaths) {
  if (process.env.FIGLETS_FIGMA_DATA_PATH && fs.existsSync(process.env.FIGLETS_FIGMA_DATA_PATH)) {
    try { return JSON.parse(fs.readFileSync(process.env.FIGLETS_FIGMA_DATA_PATH, "utf8")); }
    catch (err) {}
  }
  if (process.env.FIGLETS_LOCAL_DIR) {
    const localDir = process.env.FIGLETS_LOCAL_DIR;
    const candidates = [path.join(localDir, "figma-data.json")];
    try {
      const activeJson = path.join(localDir, "active-file.json");
      if (fs.existsSync(activeJson)) {
        const active = JSON.parse(fs.readFileSync(activeJson, "utf8"));
        if (active && active.fileKey) candidates.unshift(path.join(localDir, active.fileKey, "figma-data.json"));
      }
    } catch (err) {}
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try { return JSON.parse(fs.readFileSync(c, "utf8")); } catch (err) {}
      }
    }
    return null;
  }
  if (typeof getActiveFilePaths === "function") {
    try {
      const activePaths = getActiveFilePaths();
      if (activePaths && activePaths.data && fs.existsSync(activePaths.data)) {
        return JSON.parse(fs.readFileSync(activePaths.data, "utf8"));
      }
    } catch (err) {}
  }
  return null;
}

// Derive Light/Dark primitive refs by following the BG and source FG
// variables' immediate aliases. Returns null when either side doesn't resolve
// directly to a `color/<ramp>/<step>` primitive — the caller treats that as
// "no accessible preview possible" and either skips planning or falls back to
// legacy copy-values at apply time.
function resolveRepairRefs(repair, snapshot) {
  const variables = Array.isArray(snapshot && snapshot.variables) ? snapshot.variables : [];
  const collections = Array.isArray(snapshot && snapshot.collections) ? snapshot.collections : [];
  const byName = new Map(variables.filter(v => v && v.name).map(v => [v.name, v]));
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));

  const bgVar = byName.get(repair.bg);
  const srcVar = byName.get(repair.source);
  if (!bgVar || !srcVar) return null;

  const coll = _collectionForVariable(bgVar, collections);
  if (!coll || !Array.isArray(coll.modes)) return null;

  const lightId = _modeIdByName(coll, "Light") || (coll.modes.length === 1 ? coll.modes[0].modeId : null);
  const darkId = _modeIdByName(coll, "Dark");
  if (!lightId) return null;

  const lightBg = _aliasTargetName(bgVar, varsById, lightId);
  const lightSrc = _aliasTargetName(srcVar, varsById, lightId);
  if (!_isPrimitiveColorName(lightBg) || !_isPrimitiveColorName(lightSrc)) return null;

  const refs = { lightId: lightId, darkId: darkId, Light: { bg: lightBg, text: lightSrc }, Dark: null };

  if (darkId) {
    const darkBg = _aliasTargetName(bgVar, varsById, darkId);
    const darkSrc = _aliasTargetName(srcVar, varsById, darkId);
    if (_isPrimitiveColorName(darkBg) && _isPrimitiveColorName(darkSrc)) {
      refs.Dark = { bg: darkBg, text: darkSrc };
    }
  }
  return refs;
}

// Reuses `validateSemanticPairs` to pick accessible per-mode primitive refs.
// Figma is the source of truth for repair planning: ramps + brand come from
// the synced snapshot. Config contributes policy only, such as contrast mode.
// Returns null on any failure so the caller can fall back safely.
function computePlannedAliases(repair, snapshot, existingDs, opts) {
  const refs = resolveRepairRefs(repair, snapshot);
  if (!refs) return null;

  const baseDs = bootstrapDsFromSnapshot(snapshot, opts || {});
  if (existingDs && existingDs.color) {
    const ec = existingDs.color;
    if (!opts || !opts.algorithm) {
      if (ec.contrastAlgorithm) baseDs.color.contrastAlgorithm = ec.contrastAlgorithm;
    }
    if (ec.convention) baseDs.color.convention = ec.convention;
  }
  if (!Array.isArray(baseDs.color.ramps) || !baseDs.color.ramps.length) return null;
  if (!Array.isArray(baseDs.color.brand) || !baseDs.color.brand.length) return null;

  const pair = { bg: repair.bg, text: repair.name || repair.recommended, Light: refs.Light };
  if (refs.Dark) pair.Dark = refs.Dark;
  baseDs.color.semantics = { pairs: [pair] };

  const validate = _loadValidate();
  let result;
  try { result = validate(baseDs); } catch (err) { return null; }

  const key = pair.bg + "|" + pair.text;
  const suggestion = (result.pairSuggestions && result.pairSuggestions[key]) || {};

  const aliases = {};
  aliases.Light = suggestion.Light || refs.Light.text;
  if (refs.Dark) aliases.Dark = suggestion.Dark || refs.Dark.text;

  return {
    aliases: aliases,
    modeIds: { Light: refs.lightId, Dark: refs.darkId || null },
    algorithm: baseDs.color.contrastAlgorithm,
    upgraded: {
      Light: Boolean(suggestion.Light && suggestion.Light !== refs.Light.text),
      Dark: Boolean(refs.Dark && suggestion.Dark && suggestion.Dark !== refs.Dark.text),
    },
  };
}

module.exports = {
  computePlannedAliases,
  resolveRepairRefs,
  loadActiveSnapshot,
  loadDsConfigSafe,
};
