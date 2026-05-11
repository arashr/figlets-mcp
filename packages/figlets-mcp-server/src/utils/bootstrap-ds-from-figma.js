"use strict";

/**
 * Build a minimal in-memory DS shape from a synced Figma snapshot — enough
 * for `validateSemanticPairs` to walk ramps and pick accessible steps. No
 * file I/O. Used by apply_ds_setup_repairs when no design-system.config.js
 * exists for the active file. Never persists; never mutates the snapshot.
 */

function _resolveLiteralRgb(variable, varsById, depth) {
  if (!variable || (depth || 0) > 8) return null;
  const values = variable.valuesByMode || {};
  const modeIds = Object.keys(values);
  for (let i = 0; i < modeIds.length; i++) {
    const val = values[modeIds[i]];
    if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") {
      const next = varsById.get(val.id);
      const resolved = _resolveLiteralRgb(next, varsById, (depth || 0) + 1);
      if (resolved) return resolved;
    } else if (val && typeof val === "object" && "r" in val && "g" in val && "b" in val) {
      return val;
    }
  }
  return null;
}

function buildRampsFromSnapshot(figmaData) {
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  const colorVars = variables.filter(v => v && v.resolvedType === "COLOR" && typeof v.name === "string");
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));
  const ramps = {};

  for (const v of colorVars) {
    const parts = v.name.split("/");
    if (parts.length !== 3 || parts[0] !== "color") continue;
    const stepStr = parts[2];
    if (!/^\d+$/.test(stepStr)) continue;
    const step = parseInt(stepStr, 10);
    const rgb = _resolveLiteralRgb(v, varsById);
    if (!rgb) continue;
    const rampName = parts[1];
    if (!ramps[rampName]) ramps[rampName] = [];
    ramps[rampName].push([step, rgb.r, rgb.g, rgb.b]);
  }

  return Object.keys(ramps).sort().map(name => ({
    folder: "color/" + name,
    steps: ramps[name].sort((a, b) => a[0] - b[0]),
  }));
}

function detectBrand(ramps) {
  if (!ramps.length) return [];
  const byShortName = (shortName) => ramps.find(r => r.folder === "color/" + shortName);
  const candidate = byShortName("primary") || byShortName("brand") || ramps[0];
  const name = candidate.folder.replace(/^color\//, "");
  const anchor = candidate.steps.reduce((best, entry) =>
    !best || Math.abs(entry[0] - 500) < Math.abs(best[0] - 500) ? entry : best, null);
  return [{ name: name, role: "primary", step: anchor ? anchor[0] : 500 }];
}

function bootstrapDsFromSnapshot(figmaData, opts) {
  opts = opts || {};
  const ramps = buildRampsFromSnapshot(figmaData);
  const brand = detectBrand(ramps);
  return {
    color: {
      ramps: ramps,
      brand: brand,
      contrastAlgorithm: opts.algorithm === "apca" ? "apca" : "wcag",
      semantics: { pairs: [] },
    },
  };
}

module.exports = {
  bootstrapDsFromSnapshot,
  buildRampsFromSnapshot,
  detectBrand,
};
