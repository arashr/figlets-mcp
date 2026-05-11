const fs = require("fs");
const http = require("http");
const path = require("path");
const { getActiveFileConfigPath, getActiveFilePaths, getConfigPathGuardError } = require("../utils/paths.js");
const { bootstrapDsFromSnapshot } = require("../utils/bootstrap-ds-from-figma.js");

const applyDsSetupRepairsTool = {
  name: "apply_ds_setup_repairs",
  description:
    "Apply designer-approved setup repairs to Figma. This creates only the explicitly approved missing semantic variables by copying aliases from their approved source tokens, then updates the file-scoped config with approved pairs when possible.",
  inputSchema: {
    type: "object",
    properties: {
      repairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            bg: { type: "string" },
            recommended: { type: "string" },
            name: { type: "string" },
            source: { type: "string" }
          },
          required: ["source"]
        },
        description: "Designer-approved repairs, usually copied from inspect_ds_setup_gaps semanticGaps."
      },
      config_path: {
        type: "string",
        description: "Optional file-scoped design-system.config.js path to update after Figma succeeds. Defaults to the active file config."
      },
      update_config: {
        type: "boolean",
        description: "When false, do not update design-system.config.js after applying repairs. Defaults to true."
      }
    },
    required: ["repairs"]
  }
};

function _normalizeRepairs(repairs) {
  return (Array.isArray(repairs) ? repairs : []).map(repair => ({
    bg: repair && repair.bg ? String(repair.bg) : "",
    name: repair && (repair.name || repair.recommended) ? String(repair.name || repair.recommended) : "",
    source: repair && repair.source ? String(repair.source) : "",
  })).filter(repair => repair.name && repair.source);
}

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

function _loadActiveSnapshot() {
  // FIGLETS_FIGMA_DATA_PATH is an explicit override — honor it first so callers
  // (and tests) can pin a snapshot without depending on the host's LOCAL_DIR.
  if (process.env.FIGLETS_FIGMA_DATA_PATH && fs.existsSync(process.env.FIGLETS_FIGMA_DATA_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(process.env.FIGLETS_FIGMA_DATA_PATH, "utf8"));
    } catch (err) {}
  }
  // paths.js captures LOCAL_DIR at require time; re-read FIGLETS_LOCAL_DIR
  // here so test isolation works without a paths.js refactor.
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
  try {
    const activePaths = getActiveFilePaths();
    if (activePaths && activePaths.data && fs.existsSync(activePaths.data)) {
      return JSON.parse(fs.readFileSync(activePaths.data, "utf8"));
    }
  } catch (err) {}
  return null;
}

function _loadDsConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return null;
  try {
    let readDsConfig;
    try { ({ readDsConfig } = require("@figlets/core").dsConfig); }
    catch (e) { ({ readDsConfig } = require("../../../figlets-core/src/ds-config/index.js")); }
    return readDsConfig(configPath);
  } catch (err) {
    return null;
  }
}

function _loadValidate() {
  try { return require("@figlets/core").dsConfig.validateSemanticPairs; }
  catch (e) { return require("../../../figlets-core/src/ds-config/index.js").validateSemanticPairs; }
}

// For one repair, derive Light/Dark primitive refs by following the BG and
// source FG variables' immediate aliases. Returns null when either side
// doesn't resolve directly to a `color/<ramp>/<step>` primitive — that's a
// signal to skip the accessibility step and fall back to legacy copy-values.
function _resolveRepairRefs(repair, snapshot) {
  const variables = Array.isArray(snapshot.variables) ? snapshot.variables : [];
  const collections = Array.isArray(snapshot.collections) ? snapshot.collections : [];
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

  const refs = { lightId: lightId, darkId: darkId, Light: null, Dark: null };

  const lightBg = _aliasTargetName(bgVar, varsById, lightId);
  const lightSrc = _aliasTargetName(srcVar, varsById, lightId);
  if (!_isPrimitiveColorName(lightBg) || !_isPrimitiveColorName(lightSrc)) return null;
  refs.Light = { bg: lightBg, text: lightSrc };

  if (darkId) {
    const darkBg = _aliasTargetName(bgVar, varsById, darkId);
    const darkSrc = _aliasTargetName(srcVar, varsById, darkId);
    if (_isPrimitiveColorName(darkBg) && _isPrimitiveColorName(darkSrc)) {
      refs.Dark = { bg: darkBg, text: darkSrc };
    }
  }
  return refs;
}

// Build a one-pair DS, call validateSemanticPairs, return per-mode accessible
// primitive ref names. Uses existing DS when present (so contrastAlgorithm /
// contrastHarmonized / ramp data flow through); otherwise bootstraps a minimal
// DS from the snapshot. Returns null on any failure — caller falls back to
// legacy copy-values behavior so this never breaks existing repairs.
function _computeAccessibleAliasesForRepair(repair, snapshot, existingDs, opts) {
  const refs = _resolveRepairRefs(repair, snapshot);
  if (!refs) return null;

  // Start from the snapshot bootstrap so ramps + brand are always populated,
  // then overlay any existing config values the designer has authored. This
  // means partial configs (e.g. only `color.semantics.pairs` filled in) still
  // benefit from accessibility checking without forcing a full DS rewrite.
  const baseDs = bootstrapDsFromSnapshot(snapshot, opts || {});
  if (existingDs && existingDs.color) {
    const ec = existingDs.color;
    if (ec.contrastAlgorithm) baseDs.color.contrastAlgorithm = ec.contrastAlgorithm;
    if (Array.isArray(ec.brand) && ec.brand.length) baseDs.color.brand = JSON.parse(JSON.stringify(ec.brand));
    if (Array.isArray(ec.ramps) && ec.ramps.length) baseDs.color.ramps = JSON.parse(JSON.stringify(ec.ramps));
    if (ec.rampStrategy) baseDs.color.rampStrategy = ec.rampStrategy;
    if (ec.convention) baseDs.color.convention = ec.convention;
  }
  if (!Array.isArray(baseDs.color.ramps) || !baseDs.color.ramps.length) return null;
  if (!Array.isArray(baseDs.color.brand) || !baseDs.color.brand.length) return null;

  const pair = { bg: repair.bg, text: repair.name, Light: refs.Light };
  if (refs.Dark) pair.Dark = refs.Dark;
  baseDs.color.semantics = { pairs: [pair] };

  const validate = _loadValidate();
  let result;
  try { result = validate(baseDs); }
  catch (err) { return null; }

  const key = repair.bg + "|" + repair.name;
  const suggestion = (result.pairSuggestions && result.pairSuggestions[key]) || {};

  const aliases = {};
  aliases.Light = suggestion.Light || refs.Light.text;
  if (refs.Dark) aliases.Dark = suggestion.Dark || refs.Dark.text;

  return {
    aliases: aliases,
    modeIds: { Light: refs.lightId, Dark: refs.darkId || null },
  };
}

function _updateConfigPairs(configPath, repairs) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { updated: false, reason: "Config path not found." };
  }

  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return { updated: false, reason: guardError.error };

  let readDsConfig, writeDsConfig;
  try {
    ({ readDsConfig, writeDsConfig } = require("@figlets/core").dsConfig);
  } catch (e) {
    ({ readDsConfig, writeDsConfig } = require("../../../figlets-core/src/ds-config/index.js"));
  }

  let ds;
  try {
    ds = readDsConfig(configPath);
  } catch (err) {
    return { updated: false, reason: err.message };
  }

  if (!ds.color) ds.color = {};
  if (!ds.color.semantics) ds.color.semantics = {};
  if (!Array.isArray(ds.color.semantics.pairs)) ds.color.semantics.pairs = [];

  let added = 0;
  const conflicts = [];
  for (const repair of repairs) {
    if (!repair.bg || !repair.name) continue;
    const exists = ds.color.semantics.pairs.some(pair => pair && pair.bg === repair.bg && pair.text === repair.name);
    if (exists) continue;
    const existingBg = ds.color.semantics.pairs.find(pair => pair && pair.bg === repair.bg && pair.text !== repair.name);
    if (existingBg) {
      conflicts.push({ bg: repair.bg, existingText: existingBg.text, proposedText: repair.name });
      continue;
    }
    ds.color.semantics.pairs.push({ bg: repair.bg, text: repair.name });
    added += 1;
  }

  if (added > 0) writeDsConfig(configPath, ds);
  return { updated: added > 0, added, conflicts };
}

function handleApplyDsSetupRepairs(args = {}) {
  const repairs = _normalizeRepairs(args.repairs);
  if (!repairs.length) return Promise.resolve({ error: "At least one approved repair with recommended/name and source is required." });

  const updateConfig = args.update_config !== false;
  const configPath = args.config_path ? path.resolve(args.config_path) : getActiveFileConfigPath();
  if (configPath) {
    const guardError = getConfigPathGuardError(configPath);
    if (guardError) return Promise.resolve(guardError);
  }

  // Best-effort accessibility upgrade: when we have a snapshot (and either a
  // config or enough ramp data to bootstrap one), reuse validateSemanticPairs
  // to pick per-mode primitive aliases that pass the contrast threshold for
  // the BG variant. The bridge consumes the precomputed `aliases` when
  // present; otherwise it falls back to the legacy copy-values behavior.
  const snapshot = _loadActiveSnapshot();
  const existingDs = _loadDsConfig(configPath);
  const answers = (args.answers && typeof args.answers === "object") ? args.answers : {};
  const algoOpt = { algorithm: answers.algorithm === "apca" ? "apca" : "wcag" };

  const wirePayload = repairs.map(repair => {
    const out = { bg: repair.bg, name: repair.name, source: repair.source };
    if (snapshot) {
      const computed = _computeAccessibleAliasesForRepair(repair, snapshot, existingDs, algoOpt);
      if (computed && computed.aliases) out.aliases = computed.aliases;
    }
    return out;
  });

  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || "http://localhost:1337";
  const body = JSON.stringify({ repairs: wirePayload });

  return new Promise((resolve) => {
    const req = http.request(`${receiverUrl}/request-setup-repairs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (e) {}
          const result = parsed.result || {};
          const configUpdate = updateConfig && !result.error
            ? _updateConfigPairs(configPath, repairs.filter(repair => (result.created || []).some(row => row.name === repair.name)))
            : { updated: false, reason: updateConfig ? "Figma repair failed." : "Config update disabled." };
          resolve({
            created: result.created || [],
            skipped: result.skipped || [],
            unresolved: result.unresolved || [],
            configUpdate,
            message: result.message || "Setup repairs complete.",
            error: result.error,
          });
        } else if (res.statusCode === 409) {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (e) {}
          resolve({
            error: parsed.error || "The connected plugin does not advertise setup repairs. Reload the Figlets Bridge plugin.",
            activeSessionId: parsed.activeSessionId || null,
            pluginCapabilities: parsed.pluginCapabilities || [],
          });
        } else if (res.statusCode === 503) {
          resolve({ error: "Figma plugin is not listening for setup repairs. Open the Figlets Bridge plugin in Figma Desktop and try again." });
        } else if (res.statusCode === 504) {
          resolve({ error: "Setup repair timed out." });
        } else {
          resolve({ error: `Unexpected status ${res.statusCode}` });
        }
      });
    });

    req.setTimeout(65000, () => {
      req.destroy();
      resolve({ error: "Request timed out. The plugin may still be applying repairs." });
    });

    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        resolve({ error: "Bridge receiver is not running. The MCP server should start it automatically; try restarting the MCP host." });
      } else {
        resolve({ error: err.message });
      }
    });

    req.write(body);
    req.end();
  });
}

module.exports = {
  applyDsSetupRepairsTool,
  handleApplyDsSetupRepairs,
  _normalizeRepairs,
  _updateConfigPairs,
};
