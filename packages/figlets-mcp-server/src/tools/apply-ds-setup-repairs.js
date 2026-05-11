const fs = require("fs");
const http = require("http");
const path = require("path");
const { getActiveFileConfigPath, getActiveFilePaths, getConfigPathGuardError } = require("../utils/paths.js");
const {
  computePlannedAliases,
  loadActiveSnapshot,
  loadDsConfigSafe,
} = require("../utils/accessible-repair-aliases.js");

const applyDsSetupRepairsTool = {
  name: "apply_ds_setup_repairs",
  description:
    "Apply designer-approved setup repairs to Figma. Creates only the explicitly approved missing semantic variables, aliasing each mode to the primitive the designer already saw in inspect_ds_setup_gaps' plannedAliases. Updates the file-scoped config only after Figma succeeds.",
  inputSchema: {
    type: "object",
    properties: {
      repairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            bg: { type: "string", description: "Background variable name the new FG companion is paired with. Must exist in Figma." },
            recommended: { type: "string" },
            name: { type: "string" },
            source: { type: "string" },
            aliases: {
              type: "object",
              description: "Per-mode primitive variable names approved by the designer (from inspect_ds_setup_gaps.plannedAliases). Keys are mode names (e.g. \"Light\", \"Dark\"); values are primitive ref names like \"color/green/700\". When provided, the bridge uses these as-is. When omitted, the server falls back to recomputing them.",
              properties: {
                Light: { type: "string" },
                Dark: { type: "string" }
              },
              additionalProperties: { type: "string" }
            }
          },
          required: ["bg", "source"]
        },
        description: "Designer-approved repairs, usually copied from inspect_ds_setup_gaps.semanticGaps. Pass each gap's plannedAliases through to keep approve-then-apply consistent."
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
  return (Array.isArray(repairs) ? repairs : []).map(repair => {
    const out = {
      bg: repair && repair.bg ? String(repair.bg) : "",
      name: repair && (repair.name || repair.recommended) ? String(repair.name || repair.recommended) : "",
      source: repair && repair.source ? String(repair.source) : "",
    };
    if (repair && repair.aliases && typeof repair.aliases === "object") {
      const aliases = {};
      const keys = Object.keys(repair.aliases);
      for (let i = 0; i < keys.length; i++) {
        const v = repair.aliases[keys[i]];
        if (typeof v === "string" && v) aliases[keys[i]] = v;
      }
      if (Object.keys(aliases).length) out.aliases = aliases;
    }
    return out;
  }).filter(repair => repair.bg && repair.name && repair.source);
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

  // Two-step approve-then-apply: if the caller passes designer-approved
  // `aliases` per repair (the plannedAliases shown by inspect_ds_setup_gaps),
  // forward them unchanged so what the designer saw is exactly what Figma
  // gets. Recompute only when aliases were not supplied (legacy/no-preview
  // path) — still better than blind copy-values, and the bridge falls back
  // to copy-values when even recomputation isn't possible.
  const snapshot = loadActiveSnapshot(getActiveFilePaths);
  const existingDs = loadDsConfigSafe(configPath);
  const answers = (args.answers && typeof args.answers === "object") ? args.answers : {};
  const algoOpt = { algorithm: answers.algorithm === "apca" ? "apca" : "wcag" };

  const wirePayload = repairs.map(repair => {
    const out = { bg: repair.bg, name: repair.name, source: repair.source };
    if (repair.aliases) {
      out.aliases = repair.aliases;
    } else if (snapshot) {
      const planned = computePlannedAliases(repair, snapshot, existingDs, algoOpt);
      if (planned && planned.aliases) out.aliases = planned.aliases;
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
