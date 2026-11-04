"use strict";

const OPACITY_VALUES = [4, 8, 12, 16, 20, 40, 60];
const SCRIM_SPECS = [
  ["black", 4],
  ["black", 8],
  ["black", 12],
  ["black", 20],
  ["black", 40],
  ["black", 60],
  ["white", 8],
  ["white", 12],
  ["white", 16],
  ["white", 20],
];

function stableJson(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function alias(id) {
  return { type: "VARIABLE_ALIAS", id };
}

function sameNumber(a, b) {
  return Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) < 1e-6;
}

function sameRgb(color, target) {
  return color && ["r", "g", "b"].every(key => sameNumber(color[key], target));
}

function composedSignature(value) {
  // Figma adds a: 1 to raw composed color channels on readback.
  // Keep stale-value signatures exact; normalize only desired-value comparison.
  if (value && value.color && value.color.a === 1 && value.color.type !== "VARIABLE_ALIAS") {
    const color = Object.assign({}, value.color);
    delete color.a;
    return stableJson(Object.assign({}, value, { color }));
  }
  return stableJson(value);
}

function variableMaps(figmaData) {
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  return {
    variables,
    byId: new Map(variables.filter(item => item && item.id).map(item => [item.id, item])),
    byName: new Map(variables.filter(item => item && item.name).map(item => [item.name, item])),
  };
}

function resolveNumber(value, modeId, maps, seen = new Set()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || value.type !== "VARIABLE_ALIAS" || !value.id || seen.has(value.id)) return null;
  const target = maps.byId.get(value.id);
  if (!target || target.resolvedType !== "FLOAT") return null;
  seen.add(value.id);
  const values = target.valuesByMode || {};
  const next = Object.prototype.hasOwnProperty.call(values, modeId)
    ? values[modeId]
    : values[Object.keys(values)[0]];
  return resolveNumber(next, modeId, maps, seen);
}

function resolveColor(value, modeId, maps, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (["r", "g", "b"].every(key => typeof value[key] === "number" && Number.isFinite(value[key]))) {
    return { r: value.r, g: value.g, b: value.b, a: typeof value.a === "number" ? value.a : 1 };
  }
  if (value.type === "VARIABLE_ALIAS" && value.id && !seen.has(value.id)) {
    const target = maps.byId.get(value.id);
    if (!target || target.resolvedType !== "COLOR") return null;
    seen.add(value.id);
    const values = target.valuesByMode || {};
    const next = Object.prototype.hasOwnProperty.call(values, modeId)
      ? values[modeId]
      : values[Object.keys(values)[0]];
    return resolveColor(next, modeId, maps, seen);
  }
  if (Object.prototype.hasOwnProperty.call(value, "color") && Object.prototype.hasOwnProperty.call(value, "opacity")) {
    const color = resolveColor(value.color, modeId, maps, new Set(seen));
    const opacity = resolveNumber(value.opacity, modeId, maps, new Set(seen));
    if (!color || opacity === null) return null;
    return { r: color.r, g: color.g, b: color.b, a: opacity / 100 };
  }
  return null;
}

function rampEndpointCandidates(maps, collectionId) {
  const groups = new Map();
  for (const variable of maps.variables) {
    if (!variable || variable.variableCollectionId !== collectionId || variable.resolvedType !== "COLOR") continue;
    const match = /^(color\/[^/]+)\/(\d+)$/.exec(String(variable.name || ""));
    if (!match) continue;
    if (!groups.has(match[1])) groups.set(match[1], []);
    groups.get(match[1]).push({ step: Number(match[2]), variable });
  }
  const candidates = [];
  for (const [folder, items] of groups.entries()) {
    items.sort((a, b) => a.step - b.step);
    if (items.length) candidates.push({ folder, variable: items[0].variable });
    if (items.length > 1) candidates.push({ folder, variable: items[items.length - 1].variable });
  }
  return candidates.sort((a, b) => {
    const aPreferred = a.folder === "color/neutral" ? 0 : 1;
    const bPreferred = b.folder === "color/neutral" ? 0 : 1;
    return aPreferred - bPreferred || a.variable.name.localeCompare(b.variable.name);
  });
}

function exactEndpoint(candidates, target, modes, maps) {
  for (const candidate of candidates) {
    const values = candidate.variable.valuesByMode || {};
    const exact = modes.every(mode => {
      const value = Object.prototype.hasOwnProperty.call(values, mode.modeId)
        ? values[mode.modeId]
        : values[Object.keys(values)[0]];
      return sameRgb(resolveColor(value, mode.modeId, maps), target);
    });
    if (exact) return candidate.variable;
  }
  return null;
}

function planPrimitiveOpacityRepairs(ds, figmaData) {
  const capabilities = figmaData && figmaData.capabilities && typeof figmaData.capabilities === "object"
    ? figmaData.capabilities
    : {};
  if (capabilities.composedColorVariables !== true || capabilities.exactVariableWriteSupport !== true) {
    return {
      collection: null,
      entries: [],
      blocked: [{ reason: "The synced snapshot does not advertise exact composed-color writes. Reload the current Figlets Bridge plugin and run sync_figma_data again." }],
    };
  }
  const maps = variableMaps(figmaData || {});
  const collectionName = ds && ds.collections && ds.collections.primitives || "1. Primitives";
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  const collection = collections.find(item => item && item.name === collectionName) || null;
  if (!collection) {
    return {
      collection: null,
      entries: [],
      blocked: [{ reason: `Primitives collection ${collectionName} was not found.` }],
    };
  }

  const modes = Array.isArray(collection.modes) && collection.modes.length
    ? collection.modes.map(mode => ({ modeId: mode.modeId, modeName: mode.name || mode.modeId }))
    : [];
  if (!modes.length) {
    return {
      collection: { id: collection.id, name: collection.name, modes: [] },
      entries: [],
      blocked: [{ reason: `Primitives collection ${collectionName} has no modes.` }],
    };
  }

  const endpoints = rampEndpointCandidates(maps, collection.id);
  const blackEndpoint = exactEndpoint(endpoints, 0, modes, maps);
  const whiteEndpoint = exactEndpoint(endpoints, 1, modes, maps);
  const entries = [];
  const blocked = [];

  for (const [channel, percentage] of SCRIM_SPECS) {
    const scrimName = `color/scrim/${channel}/${percentage}`;
    const opacityName = `opacity/${percentage}`;
    const scrim = maps.byName.get(scrimName) || null;
    const opacity = maps.byName.get(opacityName) || null;
    const target = channel === "white" ? 1 : 0;
    const endpoint = channel === "white" ? whiteEndpoint : blackEndpoint;

    if (scrim && scrim.variableCollectionId !== collection.id) {
      blocked.push({ name: scrimName, reason: "Scrim exists outside the configured Primitives collection." });
      continue;
    }
    if (scrim && scrim.resolvedType !== "COLOR") {
      blocked.push({ name: scrimName, reason: `Scrim is ${scrim.resolvedType}, not COLOR.` });
      continue;
    }
    if (opacity && opacity.variableCollectionId !== collection.id) {
      blocked.push({ name: scrimName, prerequisite: opacityName, reason: "Opacity prerequisite exists outside the configured Primitives collection." });
      continue;
    }
    if (opacity && opacity.resolvedType !== "FLOAT") {
      blocked.push({ name: scrimName, prerequisite: opacityName, reason: `Opacity prerequisite is ${opacity.resolvedType}, not FLOAT.` });
      continue;
    }

    const opacityModes = modes.map(mode => ({
      modeId: mode.modeId,
      modeName: mode.modeName,
      expectedCurrentSignature: opacity ? stableJson((opacity.valuesByMode || {})[mode.modeId]) : "missing",
      value: percentage,
    }));
    const scrimModes = [];
    let incompatible = null;
    let needsScrimChange = !scrim;
    for (const mode of modes) {
      const current = scrim ? (scrim.valuesByMode || {})[mode.modeId] : undefined;
      let currentResolved = null;
      if (scrim) {
        currentResolved = resolveColor(current, mode.modeId, maps);
        if (!currentResolved || !sameRgb(currentResolved, target) || !sameNumber(currentResolved.a, percentage / 100)) {
          incompatible = `Resolved RGBA in ${mode.modeName} does not match ${channel} at ${percentage} percent.`;
          break;
        }
      }
      const desired = {
        color: endpoint ? alias(endpoint.id) : { r: target, g: target, b: target },
        opacity: opacity ? alias(opacity.id) : { prerequisite: opacityName },
      };
      if (scrim && composedSignature(current) !== composedSignature(desired)) needsScrimChange = true;
      scrimModes.push({
        modeId: mode.modeId,
        modeName: mode.modeName,
        expectedCurrentSignature: scrim ? stableJson(current) : "missing",
        value: desired,
        resolvedBefore: currentResolved,
        resolvedAfter: { r: target, g: target, b: target, a: percentage / 100 },
      });
    }
    if (incompatible) {
      blocked.push({ name: scrimName, reason: incompatible });
      continue;
    }

    const opacityNeedsChange = !opacity
      || modes.some(mode => !sameNumber((opacity.valuesByMode || {})[mode.modeId], percentage))
      || stableJson(opacity.scopes || []) !== stableJson(["OPACITY", "COLOR_OPACITY"]);
    if (!needsScrimChange && !opacityNeedsChange) continue;

    entries.push({
      scrim: {
        id: scrim ? scrim.id : null,
        name: scrimName,
        expectedType: "COLOR",
        modes: scrimModes,
        resolvedRgba: { r: target, g: target, b: target, a: percentage / 100 },
        needsValueChange: needsScrimChange,
        colorSource: endpoint
          ? { kind: "alias", id: endpoint.id, name: endpoint.name }
          : { kind: "raw", value: { r: target, g: target, b: target } },
      },
      opacity: {
        id: opacity ? opacity.id : null,
        name: opacityName,
        expectedType: "FLOAT",
        needsValueChange: opacityNeedsChange,
        expectedCurrentScopes: opacity ? (opacity.scopes || []).slice() : null,
        expectedScopesSignature: opacity ? stableJson(opacity.scopes || []) : "missing",
        scopes: ["OPACITY", "COLOR_OPACITY"],
        modes: opacityModes,
      },
    });
  }

  return {
    collection: { id: collection.id, name: collection.name, modes },
    entries,
    blocked,
    expectedOpacityNames: OPACITY_VALUES.map(value => `opacity/${value}`),
  };
}

module.exports = {
  OPACITY_VALUES,
  SCRIM_SPECS,
  planPrimitiveOpacityRepairs,
  stableJson,
};
