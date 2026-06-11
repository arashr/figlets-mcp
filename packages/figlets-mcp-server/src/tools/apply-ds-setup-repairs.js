const fs = require("fs");
const path = require("path");
const { requestBridgePost } = require("../bridges/bridge-request.js");
const { getActiveFileConfigPath, getActiveFilePaths, getConfigPathGuardError } = require("../utils/paths.js");
const {
  computePlannedAliases,
  loadActiveSnapshot,
  loadDsConfigSafe,
} = require("../utils/accessible-repair-aliases.js");

const applyDsSetupRepairsTool = {
  name: "apply_ds_setup_repairs",
  description:
    "Apply designer-approved setup changes to Figma. Repair kinds: `repairs` creates missing semantic foreground variables; `aliasUpdates` re-aliases existing semantic variables in a specific mode; `roleRepairs` creates approved missing border/icon/focus-border/foreground semantic role variables. After inspect_ds_setup_gaps approval, pass repairPlan.applyInput or optionalApplyInput exactly; do not replace aliases with counts or summaries. Updates the file-scoped config only after Figma succeeds.",
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
              description: "Per-mode primitive variable names approved by the designer (from inspect_ds_setup_gaps.repairPlan.applyInput). Keys are mode names (e.g. \"Light\", \"Dark\"); values are primitive ref names like \"color/green/700\". Preserve this object exactly; never replace it with a count, summary, boolean, or prose-derived value. When provided, the bridge uses these as-is. When omitted, the server falls back to recomputing them.",
              properties: {
                Light: { type: "string" },
                Dark: { type: "string" }
              },
              additionalProperties: { type: "string" }
            }
          },
          required: ["bg", "source"]
        },
        description: "Designer-approved missing-foreground repairs, usually copied from inspect_ds_setup_gaps.semanticGaps."
      },
      aliasUpdates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            token: { type: "string", description: "Existing semantic variable name to re-alias (e.g. \"color/on-surface/variant\")." },
            mode: { type: "string", description: "Mode name to update (e.g. \"Dark\")." },
            newAliasTarget: { type: "string", description: "Primitive variable name the token should alias in this mode (e.g. \"color/neutral/200\")." },
            to: { type: "string", description: "Legacy alias for newAliasTarget, accepted for plannedReAlias round-trips." },
            expectedCurrentAlias: { type: "string", description: "Optional primitive variable name the token was expected to alias when approved. Prevents stale approvals from overwriting newer Figma edits." },
            from: { type: "string", description: "Legacy alias for expectedCurrentAlias." }
          },
          required: ["token", "mode"]
        },
        description: "Designer-approved re-alias updates for existing semantic variables, usually copied from inspect_ds_setup_gaps.contrastFailures[*].plannedReAlias. Each entry replaces one mode's alias on one existing var."
      },
      roleRepairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Semantic role variable to create, e.g. color/border/info, color/icon/success, color/outline/focus, or an approved foreground role." },
            role: { type: "string", description: "Role type, usually border, icon, focus-border, or foreground." },
            pairedBg: { type: "string", description: "Optional background token from the planner when this role belongs to a specific fill surface, e.g. color/fill/danger." },
            expectedCurrentPairText: { type: "string", description: "Optional stale-approval guard for on-fill text role creation. If the config pair changed, Figlets will not remap it." },
            expectedCurrentPairIcon: { type: "string", description: "Optional stale-approval guard for on-fill icon role creation. If the config pair changed, Figlets will not remap it." },
            aliases: {
              type: "object",
              description: "Per-mode primitive variable names approved by the designer from inspect_ds_setup_gaps.repairPlan.applyInput. Preserve this object exactly; never replace it with a count, summary, boolean, or prose-derived value.",
              properties: {
                Light: { type: "string" },
                Dark: { type: "string" }
              },
              additionalProperties: { type: "string" }
            }
          },
          required: ["name", "role", "aliases"]
        },
        description: "Designer-approved missing border/icon/focus-border/foreground semantic role variables. Does not run unless the designer explicitly approves these role repairs."
      },
      config_path: {
        type: "string",
        description: "Optional file-scoped design-system.config.js path to update after Figma succeeds. Defaults to the active file config."
      },
      update_config: {
        type: "boolean",
        description: "When false, do not update design-system.config.js after applying repairs. Defaults to true."
      }
    }
  }
};

function _cleanAliases(aliases) {
  const out = {};
  if (!aliases || typeof aliases !== "object") return out;
  const keys = Object.keys(aliases);
  for (let i = 0; i < keys.length; i++) {
    const v = aliases[keys[i]];
    if (typeof v === "string" && v) out[keys[i]] = v;
  }
  return out;
}

function _isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function _validateAliasMap(aliases, pathLabel, { required = false } = {}) {
  if (aliases === undefined || aliases === null) {
    if (!required) return null;
    return `${pathLabel} must be the per-mode aliases object from inspect_ds_setup_gaps.repairPlan.applyInput.`;
  }
  if (!_isPlainObject(aliases)) {
    return `${pathLabel} must be the per-mode aliases object from inspect_ds_setup_gaps.repairPlan.applyInput, not ${typeof aliases}.`;
  }
  const keys = Object.keys(aliases);
  if (!keys.length) {
    return `${pathLabel} must include at least one mode alias copied from inspect_ds_setup_gaps.repairPlan.applyInput.`;
  }
  for (const key of keys) {
    if (typeof aliases[key] !== "string" || !aliases[key]) {
      return `${pathLabel}.${key} must be a primitive variable name string copied from inspect_ds_setup_gaps.repairPlan.applyInput.`;
    }
  }
  return null;
}

function _validateApprovedAliases(args = {}) {
  const repairs = Array.isArray(args.repairs) ? args.repairs : [];
  for (let i = 0; i < repairs.length; i++) {
    const repair = repairs[i] || {};
    if (Object.prototype.hasOwnProperty.call(repair, "aliases")) {
      const error = _validateAliasMap(repair.aliases, `repairs[${i}].aliases`);
      if (error) return error;
    }
  }
  const roleRepairs = Array.isArray(args.roleRepairs) ? args.roleRepairs : [];
  for (let i = 0; i < roleRepairs.length; i++) {
    const error = _validateAliasMap((roleRepairs[i] || {}).aliases, `roleRepairs[${i}].aliases`, { required: true });
    if (error) return error;
  }
  return null;
}

function _invalidAliasRecoveryMessage(error) {
  return [
    `Invalid setup repair aliases: ${error}`,
    "Stop and rerun inspect_ds_setup_gaps, then pass the exact repairPlan.applyInput object to apply_ds_setup_repairs.",
    "If the designer approved only a subset, filter entries from repairPlan.applyInput while preserving each aliases object unchanged.",
    "Do not replace aliases with counts, summaries, booleans, or prose-derived values.",
  ].join(" ");
}

function _normalizeRepairs(repairs) {
  return (Array.isArray(repairs) ? repairs : []).map(repair => {
    const out = {
      bg: repair && repair.bg ? String(repair.bg) : "",
      name: repair && (repair.name || repair.recommended) ? String(repair.name || repair.recommended) : "",
      source: repair && repair.source ? String(repair.source) : "",
    };
    const aliases = _cleanAliases(repair && repair.aliases);
    if (Object.keys(aliases).length) out.aliases = aliases;
    return out;
  }).filter(repair => repair.bg && repair.name && repair.source);
}

function _normalizeRoleRepairs(repairs) {
  return (Array.isArray(repairs) ? repairs : []).map(repair => {
    const out = {
      name: repair && repair.name ? String(repair.name) : "",
      role: repair && repair.role ? String(repair.role) : "",
      aliases: _cleanAliases(repair && repair.aliases),
    };
    if (repair && repair.pairedBg) out.pairedBg = String(repair.pairedBg);
    if (repair && repair.expectedCurrentPairText) out.expectedCurrentPairText = String(repair.expectedCurrentPairText);
    if (repair && repair.expectedCurrentPairIcon) out.expectedCurrentPairIcon = String(repair.expectedCurrentPairIcon);
    return out;
  }).filter(repair => repair.name && repair.role && Object.keys(repair.aliases).length);
}

function _normalizeAliasUpdates(updates) {
  return (Array.isArray(updates) ? updates : []).map(u => {
    const out = {
      token: u && u.token ? String(u.token) : "",
      mode: u && u.mode ? String(u.mode) : "",
      newAliasTarget: u && (u.newAliasTarget || u.to) ? String(u.newAliasTarget || u.to) : "",
    };
    if (u && (u.expectedCurrentAlias || u.from)) {
      out.expectedCurrentAlias = String(u.expectedCurrentAlias || u.from);
    }
    return out;
  }).filter(u => u.token && u.mode && u.newAliasTarget);
}

function _updateConfigPairs(configPath, repairs) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { updated: false, reason: "Config path not found." };
  }

  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return { updated: false, reason: guardError.error };

  let readDsConfig, writeDsConfig;
  try {
    ({ readDsConfig, writeDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (e) {
    ({ readDsConfig, writeDsConfig } = require("../figlets-core.js").dsConfig);
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

function _updateConfigRoles(configPath, roleRepairs) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { updated: false, reason: "Config path not found." };
  }

  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return { updated: false, reason: guardError.error };

  let readDsConfig, writeDsConfig;
  try {
    ({ readDsConfig, writeDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (e) {
    ({ readDsConfig, writeDsConfig } = require("../figlets-core.js").dsConfig);
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
  if (!Array.isArray(ds.color.semantics.icons)) ds.color.semantics.icons = [];
  if (!Array.isArray(ds.color.semantics.unpaired)) ds.color.semantics.unpaired = [];

  let added = 0;
  let remappedPairs = 0;
  const conflicts = [];
  const updatePairModeAliases = (pair, role, aliases) => {
    for (const modeName of Object.keys(aliases || {})) {
      if (!pair[modeName] || typeof pair[modeName] !== "object") pair[modeName] = {};
      pair[modeName][role] = aliases[modeName];
    }
  };
  for (const repair of roleRepairs) {
    const row = Object.assign({ token: repair.name }, repair.aliases);
    if (repair.role === "foreground" && repair.pairedBg) {
      let pair = ds.color.semantics.pairs.find(item => item && item.bg === repair.pairedBg);
      if (pair && pair.text === repair.name) continue;
      if (pair && repair.expectedCurrentPairText && pair.text !== repair.expectedCurrentPairText) {
        conflicts.push({
          bg: repair.pairedBg,
          role: "foreground",
          expectedText: repair.expectedCurrentPairText,
          actualText: pair.text || null,
          proposedText: repair.name,
        });
        continue;
      }
      if (!pair) {
        pair = { bg: repair.pairedBg };
        ds.color.semantics.pairs.push(pair);
        added += 1;
      } else {
        remappedPairs += 1;
      }
      pair.text = repair.name;
      updatePairModeAliases(pair, "text", repair.aliases);
      continue;
    }
    if (repair.role === "icon" && repair.pairedBg) {
      let pair = ds.color.semantics.pairs.find(item => item && item.bg === repair.pairedBg);
      if (pair && pair.icon === repair.name) continue;
      if (pair && repair.expectedCurrentPairIcon && pair.icon && pair.icon !== repair.expectedCurrentPairIcon) {
        conflicts.push({
          bg: repair.pairedBg,
          role: "icon",
          expectedIcon: repair.expectedCurrentPairIcon,
          actualIcon: pair.icon || null,
          proposedIcon: repair.name,
        });
        continue;
      }
      if (!pair) {
        pair = { bg: repair.pairedBg };
        ds.color.semantics.pairs.push(pair);
        added += 1;
      } else {
        remappedPairs += 1;
      }
      pair.icon = repair.name;
      updatePairModeAliases(pair, "icon", repair.aliases);
      if (!ds.color.semantics.icons.some(item => item && item.token === repair.name)) {
        ds.color.semantics.icons.push(row);
        added += 1;
      }
      continue;
    }
    if (repair.role === "icon") {
      if (ds.color.semantics.icons.some(item => item && item.token === repair.name)) continue;
      ds.color.semantics.icons.push(row);
      added += 1;
      continue;
    }
    if (ds.color.semantics.unpaired.some(item => item && item.token === repair.name)) continue;
    ds.color.semantics.unpaired.push(row);
    added += 1;
  }

  if (added > 0 || remappedPairs > 0) writeDsConfig(configPath, ds);
  return { updated: added > 0 || remappedPairs > 0, added, remappedPairs, conflicts };
}

function handleApplyDsSetupRepairs(args = {}) {
  const aliasValidationError = _validateApprovedAliases(args);
  if (aliasValidationError) {
    return Promise.resolve({
      error: _invalidAliasRecoveryMessage(aliasValidationError),
    });
  }

  const repairs = _normalizeRepairs(args.repairs);
  const aliasUpdates = _normalizeAliasUpdates(args.aliasUpdates);
  const roleRepairs = _normalizeRoleRepairs(args.roleRepairs);
  if (!repairs.length && !aliasUpdates.length && !roleRepairs.length) {
    return Promise.resolve({ error: "Provide at least one approved repair (with recommended/name and source), aliasUpdate (token + mode + newAliasTarget), or roleRepair (name + role + aliases)." });
  }

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
  const algorithm = answers.algorithm === "apca"
    ? "apca"
    : (existingDs && existingDs.color && existingDs.color.contrastAlgorithm === "apca" ? "apca" : "wcag");
  const algoOpt = { algorithm };

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

  const requestBody = { repairs: wirePayload };
  if (aliasUpdates.length) requestBody.aliasUpdates = aliasUpdates;
  if (roleRepairs.length) requestBody.roleRepairs = roleRepairs;

  return requestBridgePost("/request-setup-repairs", requestBody, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
  }).then((response) => {
    if (response.connectionError) {
      return { error: response.connectionError };
    }
    const parsed = response.data || {};
    const statusCode = response.statusCode;
    if (statusCode === 200) {
      const result = parsed.result || {};
      const configUpdate = updateConfig && !result.error
        ? _updateConfigPairs(configPath, repairs.filter(repair => (result.created || []).some(row => row.name === repair.name)))
        : { updated: false, reason: updateConfig ? "Figma repair failed." : "Config update disabled." };
      const roleConfigUpdate = updateConfig && !result.error
        ? _updateConfigRoles(configPath, roleRepairs.filter(repair => (result.roleCreated || []).some(row => row.name === repair.name)))
        : { updated: false, reason: updateConfig ? "Figma repair failed." : "Config update disabled." };
      return {
        created: result.created || [],
        roleCreated: result.roleCreated || [],
        roleSkipped: result.roleSkipped || [],
        roleUnresolved: result.roleUnresolved || [],
        skipped: result.skipped || [],
        unresolved: result.unresolved || [],
        updated: result.updated || [],
        updateSkipped: result.updateSkipped || [],
        updateUnresolved: result.updateUnresolved || [],
        configUpdate,
        roleConfigUpdate,
        message: result.message || "Setup repairs complete.",
        error: result.error,
      };
    }
    if (statusCode === 409) {
      return {
        error: parsed.error || "The connected plugin does not advertise setup repairs. Reload the Figlets Bridge plugin.",
        activeSessionId: parsed.activeSessionId || null,
        pluginCapabilities: parsed.pluginCapabilities || [],
      };
    }
    if (statusCode === 503) {
      return { error: "Figma plugin is not listening for setup repairs. Open the Figlets Bridge plugin in Figma Desktop and try again." };
    }
    if (statusCode === 504) {
      return { error: "Setup repair timed out." };
    }
    return { error: `Unexpected status ${statusCode}` };
  });
}

module.exports = {
  applyDsSetupRepairsTool,
  handleApplyDsSetupRepairs,
  _normalizeRepairs,
  _normalizeAliasUpdates,
  _normalizeRoleRepairs,
  _updateConfigPairs,
  _updateConfigRoles,
};
