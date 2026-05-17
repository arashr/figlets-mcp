const fs = require("fs");
const path = require("path");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const {
  getActiveFileConfigPath,
  getConfigPathGuardError,
} = require("../utils/paths.js");

const refreshDsConfigFromFigmaTool = {
  name: "refresh_ds_config_from_figma",
  description:
    "Refresh existing design-system.config.js entries from the current synced Figma snapshot without creating new config tokens or mutating Figma. Updates only already-known brand/ramp values and existing semantic alias fields.",
  inputSchema: {
    type: "object",
    properties: {
      config_path: {
        type: "string",
        description: "Optional file-scoped design-system.config.js path. Defaults to the active file config."
      },
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      },
      dry_run: {
        type: "boolean",
        description: "When true, report changes without writing design-system.config.js."
      }
    },
    additionalProperties: false
  }
};

function _hexComponent(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0").toUpperCase();
}

function _toHex(rgb) {
  return "#" + _hexComponent(rgb.r) + _hexComponent(rgb.g) + _hexComponent(rgb.b);
}

function _sameRgb(row, rgb) {
  return row && Math.abs(Number(row[1]) - rgb.r) < 0.000001
    && Math.abs(Number(row[2]) - rgb.g) < 0.000001
    && Math.abs(Number(row[3]) - rgb.b) < 0.000001;
}

function _isRgbValue(value) {
  return value && typeof value === "object" && "r" in value && "g" in value && "b" in value;
}

function _modeOfId(collections, variable, modeId) {
  if (!modeId) return null;
  const coll = collections.find(c => Array.isArray(c.variableIds) && c.variableIds.includes(variable.id))
    || collections.find(c => c.id === variable.variableCollectionId);
  if (!coll || !Array.isArray(coll.modes)) return null;
  const m = coll.modes.find(x => x.modeId === modeId);
  return m ? m.name : null;
}

function _modeIdByNameForCollection(collections, variable, name) {
  if (!name) return null;
  const coll = collections.find(c => Array.isArray(c.variableIds) && c.variableIds.includes(variable.id))
    || collections.find(c => c.id === variable.variableCollectionId);
  if (!coll || !Array.isArray(coll.modes)) return null;
  const wanted = String(name).toLowerCase();
  const m = coll.modes.find(x => String(x.name || "").toLowerCase() === wanted);
  return m ? m.modeId : null;
}

// When following a VARIABLE_ALIAS, the target uses its own collection's
// modeIds, not the source's. Look up the target's mode by NAME so a Light
// source resolves to the target's Light mode (not whichever mode happens to
// be enumerated first). Falls back to the only mode when the target has a
// single mode (the common primitives-collection case).
function _resolveValue(variable, varsById, modeId, collections, depth = 0, modeName = null) {
  if (!variable || depth > 8) return null;
  const values = variable.valuesByMode || {};
  const modes = Object.keys(values);
  let selectedModeId = (modeId && values[modeId] !== undefined) ? modeId : null;
  if (!selectedModeId && modeName) {
    selectedModeId = _modeIdByNameForCollection(collections || [], variable, modeName);
    if (selectedModeId && values[selectedModeId] === undefined) selectedModeId = null;
  }
  if (!selectedModeId && modes.length === 1) selectedModeId = modes[0];
  if (!selectedModeId) return null;
  const value = values[selectedModeId];
  if (!value) return null;
  if (typeof value === "object" && value.type === "VARIABLE_ALIAS") {
    const carriedName = modeName || _modeOfId(collections || [], variable, selectedModeId);
    return _resolveValue(varsById.get(value.id), varsById, null, collections, depth + 1, carriedName);
  }
  return value;
}

function _aliasTargetName(variable, varsById, modeId) {
  const value = variable && variable.valuesByMode ? variable.valuesByMode[modeId] : null;
  if (!value || typeof value !== "object" || value.type !== "VARIABLE_ALIAS") return null;
  const target = varsById.get(value.id);
  return target ? target.name : null;
}

function _collectionForVariable(variable, collections) {
  return collections.find(collection => Array.isArray(collection.variableIds) && collection.variableIds.includes(variable.id)) || null;
}

function _modeIdByName(collection, modeName) {
  if (!collection || !Array.isArray(collection.modes)) return null;
  const wanted = String(modeName || "").toLowerCase();
  const exact = collection.modes.find(mode => String(mode.name || "").toLowerCase() === wanted);
  return exact ? exact.modeId : null;
}

function _refreshSemanticModeAliases(rows, varsByName, varsById, collections, changes, kind) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    const token = row && row.token ? row.token : null;
    const variable = token ? varsByName.get(token) : null;
    if (!variable) continue;
    const collection = _collectionForVariable(variable, collections);
    const lightId = _modeIdByName(collection, "Light");
    const darkId = _modeIdByName(collection, "Dark");
    for (const modeName of ["Light", "Dark"]) {
      if (!(modeName in row)) continue;
      const modeId = modeName === "Light" ? lightId : darkId;
      if (!modeId) continue;
      const nextAlias = _aliasTargetName(variable, varsById, modeId);
      if (nextAlias && row[modeName] !== nextAlias) {
        changes.push({ kind, token, mode: modeName, from: row[modeName] || null, to: nextAlias });
        row[modeName] = nextAlias;
      }
    }
  }
}

function _loadConfig(configPath) {
  let readDsConfig, writeDsConfig;
  try {
    ({ readDsConfig, writeDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (e) {
    ({ readDsConfig, writeDsConfig } = require("../figlets-core.js").dsConfig);
  }
  return { readDsConfig, writeDsConfig, ds: readDsConfig(configPath) };
}

function refreshDsConfigFromFigmaData(ds, figmaData = {}) {
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const byName = new Map(variables.filter(v => v && typeof v.name === "string").map(v => [v.name, v]));
  const varsById = new Map(variables.map(v => [v.id, v]));
  const changes = [];
  const skipped = [];

  if (ds.color && Array.isArray(ds.color.brand)) {
    for (const brand of ds.color.brand) {
      if (!brand || !brand.name) continue;
      // A brand's natural anchor step is encoded in the config (typically set
      // by intake from OKLab L). Refusing to guess `step=500` keeps refresh
      // honest for ramps anchored at 400/600 or on non-100-spaced scales.
      if (brand.step == null) {
        skipped.push({ kind: "brand", name: brand.name, reason: "Brand has no explicit anchor step; refusing to guess." });
        continue;
      }
      const step = String(brand.step);
      const variable = byName.get("color/" + brand.name + "/" + step);
      if (!variable) {
        skipped.push({ kind: "brand", name: brand.name, reason: "Matching anchor variable not found." });
        continue;
      }
      const raw = _resolveValue(variable, varsById, null, collections);
      if (!_isRgbValue(raw)) {
        skipped.push({ kind: "brand", name: brand.name, reason: "Anchor variable has no RGB value." });
        continue;
      }
      const nextHex = _toHex(raw);
      if (String(brand.hex || "").toUpperCase() !== nextHex) {
        changes.push({ kind: "brand", name: brand.name, step, from: brand.hex || null, to: nextHex });
        brand.hex = nextHex;
      }
    }
  }

  if (ds.color && Array.isArray(ds.color.ramps)) {
    for (const ramp of ds.color.ramps) {
      if (!ramp || !ramp.folder || !Array.isArray(ramp.steps)) continue;
      for (const row of ramp.steps) {
        if (!Array.isArray(row) || row.length < 4) continue;
        const variable = byName.get(ramp.folder + "/" + row[0]);
        if (!variable) {
          skipped.push({ kind: "ramp-step", name: ramp.folder + "/" + row[0], reason: "Variable not found." });
          continue;
        }
        const raw = _resolveValue(variable, varsById, null, collections);
        if (!_isRgbValue(raw)) {
          skipped.push({ kind: "ramp-step", name: ramp.folder + "/" + row[0], reason: "Variable has no RGB value." });
          continue;
        }
        if (!_sameRgb(row, raw)) {
          changes.push({
            kind: "ramp-step",
            name: ramp.folder + "/" + row[0],
            from: { r: row[1], g: row[2], b: row[3] },
            to: { r: raw.r, g: raw.g, b: raw.b },
          });
          row[1] = raw.r;
          row[2] = raw.g;
          row[3] = raw.b;
        }
      }
    }
  }

  const sem = ds.color && ds.color.semantics ? ds.color.semantics : null;
  if (sem && Array.isArray(sem.pairs)) {
    for (const pair of sem.pairs) {
      const bgVar = pair && pair.bg ? byName.get(pair.bg) : null;
      const textVar = pair && pair.text ? byName.get(pair.text) : null;
      if (!bgVar || !textVar) continue;
      const collection = _collectionForVariable(bgVar, collections);
      const lightId = _modeIdByName(collection, "Light");
      const darkId = _modeIdByName(collection, "Dark");
      for (const modeName of ["Light", "Dark"]) {
        if (!pair[modeName]) continue;
        const modeId = modeName === "Light" ? lightId : darkId;
        if (!modeId) continue;
        const nextBg = _aliasTargetName(bgVar, varsById, modeId);
        const nextText = _aliasTargetName(textVar, varsById, modeId);
        if (nextBg && pair[modeName].bg !== nextBg) {
          changes.push({ kind: "semantic-alias", token: pair.bg, mode: modeName, slot: "bg", from: pair[modeName].bg || null, to: nextBg });
          pair[modeName].bg = nextBg;
        }
        if (nextText && pair[modeName].text !== nextText) {
          changes.push({ kind: "semantic-alias", token: pair.text, mode: modeName, slot: "text", from: pair[modeName].text || null, to: nextText });
          pair[modeName].text = nextText;
        }
      }
    }
  }
  if (sem) {
    _refreshSemanticModeAliases(sem.icons, byName, varsById, collections, changes, "semantic-icon-alias");
    _refreshSemanticModeAliases(sem.unpaired, byName, varsById, collections, changes, "semantic-unpaired-alias");
  }

  return { ds, changes, skipped };
}

function handleRefreshDsConfigFromFigma(args = {}) {
  const configPath = args.config_path ? path.resolve(args.config_path) : getActiveFileConfigPath();
  if (!configPath) return { error: "No active file-scoped config path found.", hint: "Run sync_figma_data for a saved/open Figma file first." };
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;
  if (!fs.existsSync(configPath)) return { error: "Config not found: " + configPath };

  const dataSource = args.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: args.figmaDataPath })
    : (loadActiveFigmaDataSource(args) || loadFigmaDataSource(args));
  if (!dataSource) {
    return { error: "No synced Figma snapshot found.", hint: "Run sync_figma_data first." };
  }

  let loaded;
  try {
    loaded = _loadConfig(configPath);
  } catch (err) {
    return { error: err.message };
  }

  const result = refreshDsConfigFromFigmaData(loaded.ds, dataSource.figmaData);
  const dryRun = !!args.dry_run;
  if (!dryRun && result.changes.length) loaded.writeDsConfig(configPath, result.ds);

  return {
    dryRun,
    configPath,
    source: {
      kind: dataSource.kind,
      target: dataSource.target,
      path: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
    },
    changes: result.changes,
    skipped: result.skipped,
    summary: {
      changedCount: result.changes.length,
      skippedCount: result.skipped.length,
    },
    message: dryRun
      ? "Config refresh dry run complete. No files were written."
      : (result.changes.length ? "Config refreshed from Figma snapshot." : "Config already matched the synced Figma snapshot."),
  };
}

module.exports = {
  refreshDsConfigFromFigmaTool,
  handleRefreshDsConfigFromFigma,
  refreshDsConfigFromFigmaData,
};
