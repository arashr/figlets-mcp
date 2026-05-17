"use strict";

/**
 * Build a starter DS shape from a synced Figma snapshot. This is used both as
 * an in-memory fallback for repair planning and as the persisted file-scoped
 * config for existing design systems that were not created by Figlets.
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

function _collectionFor(variable, collections) {
  return collections.find(c => Array.isArray(c.variableIds) && c.variableIds.includes(variable.id))
    || collections.find(c => c.id === variable.variableCollectionId)
    || null;
}

function _collectionSummary(figmaData) {
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  const byCollection = new Map(collections.map(c => [c.id, { collection: c, vars: [] }]));
  for (const variable of variables) {
    const coll = _collectionFor(variable, collections);
    if (!coll) continue;
    if (!byCollection.has(coll.id)) byCollection.set(coll.id, { collection: coll, vars: [] });
    byCollection.get(coll.id).vars.push(variable);
  }
  return Array.from(byCollection.values());
}

function inferCollectionsFromSnapshot(figmaData) {
  const result = {};
  const summaries = _collectionSummary(figmaData);

  function score(entry, role) {
    const name = String(entry.collection.name || "").toLowerCase();
    const vars = entry.vars || [];
    const colorCount = vars.filter(v => v.resolvedType === "COLOR").length;
    const floatCount = vars.filter(v => v.resolvedType === "FLOAT").length;
    const stringCount = vars.filter(v => v.resolvedType === "STRING").length;
    const aliasCount = vars.filter(v => {
      const values = v.valuesByMode || {};
      return Object.keys(values).some(id => values[id] && values[id].type === "VARIABLE_ALIAS");
    }).length;

    if (role === "primitives") {
      return (name.includes("primitive") ? 100 : 0)
        + vars.filter(v => /^color\/[^/]+\/\d+$/.test(v.name || "")).length * 4
        + (colorCount - aliasCount);
    }
    if (role === "color") {
      return (name === "color" || name.includes("semantic") ? 100 : 0)
        + vars.filter(v => /^color\/(surface|bg|background|on-|on_|text|icon|outline|border|stroke)/i.test(v.name || "")).length * 5
        + aliasCount * 2;
    }
    if (role === "spacing") {
      return (name.includes("spacing") ? 100 : 0)
        + vars.filter(v => /^spacing\//i.test(v.name || "")).length * 5
        + floatCount;
    }
    if (role === "typography") {
      return (name.includes("typography") || name.includes("type") ? 100 : 0)
        + vars.filter(v => /^type|^typography\//i.test(v.name || "")).length * 5
        + stringCount;
    }
    return 0;
  }

  for (const role of ["primitives", "color", "spacing", "typography"]) {
    const ranked = summaries
      .map(entry => ({ entry, score: score(entry, role) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ranked.length) result[role] = ranked[0].entry.collection.name;
  }

  return result;
}

function inferBreakpointsFromSnapshot(figmaData) {
  const summaries = _collectionSummary(figmaData);
  const responsive = summaries
    .map(entry => ({
      modes: (entry.collection.modes || []).map(m => m.name).filter(Boolean),
      score: (String(entry.collection.name || "").match(/spacing|type|typography/i) ? 20 : 0)
        + (entry.collection.modes || []).length
    }))
    .filter(entry => entry.modes.length > 1)
    .sort((a, b) => b.score - a.score)[0];
  const modes = responsive ? responsive.modes : ["Mobile", "Tablet", "Desktop"];
  return { modes, tier: modes.length };
}

function _nameSet(figmaData) {
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  return new Set(variables.filter(v => v && typeof v.name === "string").map(v => v.name));
}

function _swapRole(name, rolePattern, replacement) {
  const parts = String(name || "").split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!rolePattern.test(parts[i])) continue;
    const next = parts.slice();
    next[i] = replacement;
    return next.join("/");
  }
  return "";
}

function _findExisting(candidates, names) {
  return candidates.find(name => names.has(name)) || "";
}

function inferSemanticsFromSnapshot(figmaData) {
  const names = _nameSet(figmaData);
  const colorNames = Array.from(names).filter(name => /^color\//.test(name) && !/^color\/[^/]+\/\d+$/.test(name));
  const pairs = [];
  const pairedRoles = new Set();

  for (const bg of colorNames) {
    const parts = bg.split("/");
    const roleIndex = parts.findIndex(part => /^(surface|bg|background)$/i.test(part));
    if (roleIndex < 0) continue;
    const role = parts[roleIndex].toLowerCase();
    const leaf = parts[parts.length - 1] || "";
    const stem = leaf.replace(/-(variant|subtle|strong)$/i, "");
    const fgCandidates = [];

    if (role === "surface") fgCandidates.push(_swapRole(bg, /^(surface)$/i, "on-surface"));
    if (role === "bg") fgCandidates.push(_swapRole(bg, /^(bg)$/i, "text"), _swapRole(bg, /^(bg)$/i, "on-bg"));
    if (role === "background") fgCandidates.push(_swapRole(bg, /^(background)$/i, "on-background"), _swapRole(bg, /^(background)$/i, "text"));

    if (/-variant$/i.test(leaf)) {
      const defaultFg = parts.slice();
      defaultFg[roleIndex] = role === "surface" ? "on-surface" : "text";
      defaultFg[defaultFg.length - 1] = "default";
      fgCandidates.push(defaultFg.join("/"));
    }

    const text = _findExisting(fgCandidates, names);
    if (!text) continue;

    const borderCandidates = ["outline", "border", "stroke"].map(family => {
      const next = parts.slice();
      next[roleIndex] = family;
      return next.join("/");
    });
    if (stem !== leaf) {
      for (const family of ["outline", "border", "stroke"]) {
        const next = parts.slice();
        next[roleIndex] = family;
        next[next.length - 1] = stem;
        borderCandidates.push(next.join("/"));
      }
    }

    const iconCandidates = ["icon", "graphic", "symbol"].map(family => {
      const next = parts.slice();
      next[roleIndex] = family;
      return next.join("/");
    });
    if (stem !== leaf) {
      for (const family of ["icon", "graphic", "symbol"]) {
        const next = parts.slice();
        next[roleIndex] = family;
        next[next.length - 1] = stem;
        iconCandidates.push(next.join("/"));
      }
    }

    const pair = { bg, text };
    const border = _findExisting(borderCandidates, names);
    const icon = _findExisting(iconCandidates, names);
    if (border) {
      pair.border = border;
      pairedRoles.add(border);
    }
    if (icon) {
      pair.icon = icon;
      pairedRoles.add(icon);
    }
    pairedRoles.add(bg);
    pairedRoles.add(text);
    pairs.push(pair);
  }

  const icons = [];
  const unpaired = [];
  for (const name of colorNames) {
    if (pairedRoles.has(name)) continue;
    if (/\/icon\//i.test(name)) {
      icons.push({ token: name });
    } else if (/\/(outline|border|stroke)\//i.test(name)) {
      unpaired.push({ token: name });
    }
  }

  pairs.sort((a, b) => a.bg.localeCompare(b.bg));
  icons.sort((a, b) => a.token.localeCompare(b.token));
  unpaired.sort((a, b) => a.token.localeCompare(b.token));

  return { pairs, icons, unpaired };
}

function bootstrapDsFromSnapshot(figmaData, opts) {
  opts = opts || {};
  const ramps = buildRampsFromSnapshot(figmaData);
  const brand = detectBrand(ramps);
  const breakpoints = inferBreakpointsFromSnapshot(figmaData);
  const semantics = inferSemanticsFromSnapshot(figmaData);
  return {
    project: {
      name: (figmaData && figmaData.fileName) || "Imported Figma design system",
    },
    collections: inferCollectionsFromSnapshot(figmaData),
    grid: { base: 8 },
    breakpoints,
    typography: { scalePreset: "material3" },
    color: {
      ramps: ramps,
      brand: brand,
      contrastAlgorithm: opts.algorithm === "apca" ? "apca" : "wcag",
      semantics,
    },
    figlets: {
      source: "figma-snapshot-bootstrap",
      createdBy: "figlets-mcp",
      createdAt: opts.createdAt || new Date().toISOString(),
      fileKey: (figmaData && figmaData.fileKey) || null,
      note: "Generated from synced Figma variables because no file-scoped design-system.config.js existed.",
    },
  };
}

module.exports = {
  bootstrapDsFromSnapshot,
  buildRampsFromSnapshot,
  detectBrand,
  inferBreakpointsFromSnapshot,
  inferCollectionsFromSnapshot,
  inferSemanticsFromSnapshot,
};
