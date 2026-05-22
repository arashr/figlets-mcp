"use strict";

const fs = require("fs");
const path = require("path");
const { requestBridgePost } = require("../bridges/bridge-request.js");
const { getConfigPathGuardError } = require("../utils/paths.js");

const applyDsFoundationRepairsTool = {
  name: "apply_ds_foundation_repairs",
  description:
    "Applies designer-approved foundation repairs for config-backed token completion by creating only missing configured variable collections and their modes. This is the guided partial setup path for inspect_ds_token_gaps missing-foundation-collection notes; it does not create variables, styles, primitives, or arbitrary Figma objects.",
  inputSchema: {
    type: "object",
    properties: {
      config_path: {
        type: "string",
        description: "Absolute path to design-system.config.js."
      },
      collections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string" },
            name: { type: "string" },
            modes: { type: "array", items: { type: "string" } }
          },
          required: ["kind", "name"],
          additionalProperties: false
        },
        description: "Approved collection repairs copied from inspect_ds_token_gaps.repairPlan.foundationRepairPlan.applyInput.collections."
      }
    },
    required: ["config_path", "collections"],
    additionalProperties: false
  }
};

const KIND_TO_COLLECTION_KEY = {
  primitives: "primitives",
  spacing: "spacing",
  typography: "typography",
  elevation: "elevation",
};

function _readDsConfig(configPath) {
  let readDsConfig;
  try {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  } catch (err) {
    ({ readDsConfig } = require("../figlets-core.js").dsConfig);
  }
  return readDsConfig(configPath);
}

function _expectedCollectionName(ds, kind) {
  const key = KIND_TO_COLLECTION_KEY[kind];
  if (!key) return null;
  const defaults = {
    primitives: "1. Primitives",
    spacing: "4. Spacing",
    typography: "3. Typography",
    elevation: "5. Elevation",
  };
  return ds && ds.collections && ds.collections[key] || defaults[kind];
}

function _expectedModes(ds, kind) {
  if (kind === "primitives" || kind === "elevation") return ["Default"];
  const modes = ds && ds.breakpoints && Array.isArray(ds.breakpoints.modes) && ds.breakpoints.modes.length
    ? ds.breakpoints.modes
    : ["Mobile", "Tablet", "Desktop"];
  return modes.map(mode => String(mode || "").trim()).filter(Boolean);
}

function _normalizeCollections(ds, collections) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(collections) ? collections : []) {
    const kind = String(item && item.kind || "").trim();
    const name = String(item && item.name || "").trim();
    const expectedName = _expectedCollectionName(ds, kind);
    if (!expectedName || name !== expectedName) {
      return {
        error: `Unsupported foundation repair collection "${name || kind}". Use the exact collections emitted by inspect_ds_token_gaps.`,
      };
    }
    if (seen.has(kind)) continue;
    seen.add(kind);
    result.push({
      kind,
      name,
      modes: _expectedModes(ds, kind),
    });
  }
  return { collections: result };
}

function handleApplyDsFoundationRepairs(args = {}) {
  const configPath = args && args.config_path ? path.resolve(args.config_path) : null;
  if (!configPath) return Promise.resolve({ error: "config_path is required." });

  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return Promise.resolve(guardError);
  if (!fs.existsSync(configPath)) return Promise.resolve({ error: `Config not found: ${configPath}` });

  let ds;
  try {
    ds = _readDsConfig(configPath);
  } catch (err) {
    return Promise.resolve({
      error: err.message,
      hint: "Fix design-system.config.js before applying foundation repairs.",
      configPath,
    });
  }

  const normalized = _normalizeCollections(ds, args.collections);
  if (normalized.error) return Promise.resolve(Object.assign({ configPath }, normalized));
  if (!normalized.collections.length) {
    return Promise.resolve({
      error: "collections must include at least one approved foundation repair.",
      configPath,
    });
  }

  return requestBridgePost("/request-foundation-repairs", {
    DS: ds,
    collections: normalized.collections,
  }, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
  }).then((response) => {
    if (response.connectionError) {
      return { error: response.connectionError, configPath };
    }
    const parsed = response.data || {};
    const statusCode = response.statusCode;
    if (statusCode === 200) {
      const result = parsed.result || {};
      return {
        createdCollections: result.createdCollections || [],
        existingCollections: result.existingCollections || [],
        skippedCollections: result.skippedCollections || [],
        message: result.message || "Foundation repairs applied.",
        configPath,
        error: result.error,
      };
    }
    if (statusCode === 503) {
      return {
        error: parsed.error || "Figma plugin is not connected. Open the Figlets Bridge plugin in Figma Desktop and try again.",
        activeSessionId: parsed.activeSessionId || null,
        pluginCapabilities: parsed.pluginCapabilities || [],
        configPath,
      };
    }
    if (statusCode === 504) {
      return { error: "Foundation repair timed out.", configPath };
    }
    if (statusCode === 409) {
      return {
        error: parsed.error || "The Figlets Bridge plugin does not advertise the foundation-repairs command. Reload the plugin in Figma Desktop.",
        activeSessionId: parsed.activeSessionId || null,
        pluginCapabilities: parsed.pluginCapabilities || [],
        configPath,
      };
    }
    return { error: `Unexpected status ${statusCode}`, configPath };
  });
}

module.exports = {
  applyDsFoundationRepairsTool,
  handleApplyDsFoundationRepairs,
};
