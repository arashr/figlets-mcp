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

function _modeNameForId(collection, modeId) {
  const modes = collection && Array.isArray(collection.modes) ? collection.modes : [];
  const match = modes.find(mode => mode.modeId === modeId);
  return match ? match.name : null;
}

function _modeIdByName(collection, modeName) {
  if (!collection || !Array.isArray(collection.modes)) return null;
  const wanted = String(modeName || "").toLowerCase();
  const match = collection.modes.find(mode => String(mode.name || "").toLowerCase() === wanted);
  return match ? match.modeId : null;
}

function _resolveLiteralValue(variable, varsById, collections, modeId, modeName, depth) {
  if (!variable || (depth || 0) > 8) return null;
  const values = variable.valuesByMode || {};
  const valueModeIds = Object.keys(values);
  const ownCollection = _collectionFor(variable, collections || []);
  let selectedModeId = modeId && values[modeId] !== undefined ? modeId : null;
  if (!selectedModeId && modeName) {
    const namedModeId = _modeIdByName(ownCollection, modeName);
    if (namedModeId && values[namedModeId] !== undefined) selectedModeId = namedModeId;
  }
  if (!selectedModeId && valueModeIds.length === 1) selectedModeId = valueModeIds[0];
  if (!selectedModeId && valueModeIds.length) selectedModeId = valueModeIds[0];
  if (!selectedModeId) return null;
  const val = values[selectedModeId];
  if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") {
    const carriedModeName = modeName || _modeNameForId(ownCollection, selectedModeId);
    return _resolveLiteralValue(varsById.get(val.id), varsById, collections, null, carriedModeName, (depth || 0) + 1);
  }
  return val;
}

function _literalValuesByMode(variable, varsById, collections) {
  const collection = _collectionFor(variable, collections || []);
  const modes = collection && Array.isArray(collection.modes) && collection.modes.length
    ? collection.modes
    : Object.keys(variable.valuesByMode || {}).map(modeId => ({ modeId, name: modeId }));
  const values = [];
  for (const mode of modes) {
    const value = _resolveLiteralValue(variable, varsById, collections, mode.modeId, mode.name, 0);
    values.push(value);
  }
  return values;
}

function _numericValuesByMode(variable, varsById, collections) {
  const values = _literalValuesByMode(variable, varsById, collections).filter(value => typeof value === "number" && isFinite(value));
  return values.length ? values : null;
}

function _firstNumericValue(variable, varsById, collections) {
  const values = _numericValuesByMode(variable, varsById, collections);
  return values && values.length ? values[values.length - 1] : null;
}

function _firstStringValue(variable, varsById, collections) {
  const values = _literalValuesByMode(variable, varsById, collections).filter(value => typeof value === "string" && value.trim());
  return values.length ? values[values.length - 1] : null;
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
        + vars.filter(v => /^(?:space|spacing)\//i.test(v.name || "")).length * 5
        + floatCount;
    }
    if (role === "typography") {
      return (name.includes("typography") || name.includes("type") ? 100 : 0)
        + vars.filter(v => /^(?:type|typography|font)\//i.test(v.name || "")).length * 5
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
  const collections = inferCollectionsFromSnapshot(figmaData);
  const responsiveCollectionNames = Array.from(new Set([
    collections.spacing,
    collections.typography,
  ].filter(Boolean)));
  const responsive = responsiveCollectionNames
    .map((collectionName, priority) => {
      const entry = summaries.find(item => item.collection.name === collectionName);
      const modes = entry
        ? (entry.collection.modes || []).map(mode => mode.name).filter(Boolean)
        : [];
      return { modes, priority };
    })
    .filter(entry => {
      if (!entry.modes.length) return false;
      const normalized = entry.modes.map(mode => String(mode).trim().toLowerCase());
      const themeOnly = normalized.every(mode => mode === "light" || mode === "dark");
      const genericOnly = normalized.every(mode =>
        mode === "default" || mode === "value" || /^mode\s*\d+$/.test(mode)
      );
      return !themeOnly && !genericOnly;
    })
    .sort((a, b) => b.modes.length - a.modes.length || a.priority - b.priority)[0];
  const modes = responsive ? responsive.modes : ["Mobile", "Tablet", "Desktop"];
  return { modes, tier: modes.length };
}

function inferSpacingFromSnapshot(figmaData) {
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));
  const semantic = {};
  const radius = {};
  const border = {};
  const primitiveValues = [];

  for (const variable of variables) {
    if (!variable || variable.resolvedType !== "FLOAT" || typeof variable.name !== "string") continue;
    const name = variable.name;
    const values = _numericValuesByMode(variable, varsById, collections);
    if (!values) continue;
    const scalar = values[values.length - 1];
    if (/^(?:space|spacing)\/(?:\d|0|full\b)/i.test(name)) {
      if (scalar > 0 && scalar <= 32) primitiveValues.push(Math.round(scalar));
      continue;
    }
    let match = name.match(/^(?:space|spacing)\/radius\/(.+)$/i) || name.match(/^radius\/(.+)$/i);
    if (match) {
      radius[match[1]] = scalar;
      continue;
    }
    match = name.match(/^(?:space|spacing)\/border\/(.+)$/i) || name.match(/^border\/(?:width\/)?(.+)$/i);
    if (match) {
      border[match[1]] = scalar;
      continue;
    }
    match = name.match(/^space\/(.+)$/i) || name.match(/^spacing\/(.+)$/i);
    if (match && match[1].split("/").length >= 2) {
      semantic[match[1]] = values;
    }
  }

  const out = {
    responsiveModeValidation: {
      allowSameValueModes: {
        categories: ["component", "stack", "touch"],
      },
    },
  };
  if (Object.keys(semantic).length) out.semantic = semantic;
  if (Object.keys(radius).length) out.radius = radius;
  if (Object.keys(border).length) out.border = border;

  return { spacing: out, primitiveValues };
}

function inferTypographyFromSnapshot(figmaData) {
  const variables = Array.isArray(figmaData && figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData && figmaData.collections) ? figmaData.collections : [];
  const textStyles = Array.isArray(figmaData && figmaData.textStyles) ? figmaData.textStyles : [];
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));
  const groups = {};
  const families = {};
  const familyCounts = {};

  function groupFor(role) {
    if (!groups[role]) groups[role] = {};
    return groups[role];
  }

  for (const variable of variables) {
    if (!variable || typeof variable.name !== "string") continue;
    let match = variable.name.match(/^type\/(.+?)\/(.+?)\/(size|line-height|weight|tracking|letter-spacing)$/i);
    if (match && variable.resolvedType === "FLOAT") {
      const role = match[1] + "/" + match[2];
      const prop = match[3].toLowerCase();
      const values = _numericValuesByMode(variable, varsById, collections);
      if (!values) continue;
      const group = groupFor(role);
      if (prop === "size") group.sizes = values;
      else if (prop === "line-height") group.lineHeights = values;
      else if (prop === "weight") group.weight = values[values.length - 1];
      else if (prop === "tracking" || prop === "letter-spacing") group.tracking = values[values.length - 1];
      continue;
    }
    match = variable.name.match(/^font\/(.+)$/i);
    if (match && variable.resolvedType === "STRING") {
      const value = _firstStringValue(variable, varsById, collections);
      if (value) families[match[1]] = value;
    }
  }

  for (const style of textStyles) {
    if (!style || !style.name) continue;
    const parts = String(style.name).replace(/^type\//, "").split("/");
    if (parts.length < 2) continue;
    const role = parts.slice(0, 2).join("/");
    const group = groupFor(role);
    if (!group.sizes && typeof style.fontSize === "number") group.sizes = [style.fontSize, style.fontSize, style.fontSize];
    if (!group.lineHeights) {
      const lh = style.lineHeight && typeof style.lineHeight === "object" && typeof style.lineHeight.value === "number"
        ? style.lineHeight.value
        : null;
      if (lh) group.lineHeights = [lh, lh, lh];
    }
    if (group.tracking == null && style.letterSpacing && typeof style.letterSpacing === "object" && typeof style.letterSpacing.value === "number") {
      group.tracking = style.letterSpacing.value;
    }
    if (style.fontName && style.fontName.family) {
      familyCounts[style.fontName.family] = (familyCounts[style.fontName.family] || 0) + 1;
    }
  }

  const scale = {};
  for (const role of Object.keys(groups).sort()) {
    const group = groups[role];
    if (!group.sizes || !group.sizes.length) continue;
    scale[role] = {
      sizes: group.sizes,
      lineHeights: group.lineHeights || group.sizes.map(size => Math.round(size * 1.4)),
      weight: group.weight || 400,
      tracking: group.tracking || 0,
    };
  }

  if (!families.sans) {
    let bestFamily = null;
    for (const family of Object.keys(familyCounts)) {
      if (!bestFamily || familyCounts[family] > familyCounts[bestFamily]) bestFamily = family;
    }
    if (bestFamily) families.sans = bestFamily;
  }

  const out = { scalePreset: Object.keys(scale).length ? "custom" : "material3" };
  if (Object.keys(scale).length) out.scale = scale;
  if (Object.keys(families).length) out.families = families;
  return out;
}

function inferElevationFromSnapshot(figmaData) {
  const effectStyles = Array.isArray(figmaData && figmaData.effectStyles) ? figmaData.effectStyles : [];
  const elevation = {};
  for (const style of effectStyles) {
    if (!style || !style.name || !Array.isArray(style.effects)) continue;
    if (!/(?:^|\/)(?:elevation|shadow)(?:\/|$)/i.test(style.name)) continue;
    const key = style.name.replace(/^(?:elevation|shadow)\//i, "");
    elevation[key || style.name] = style.effects.map(effect => ({
      type: effect.type,
      color: effect.color || null,
      offset: effect.offset || null,
      radius: effect.radius,
      spread: effect.spread,
      blendMode: effect.blendMode,
      visible: effect.visible !== false,
    }));
  }
  return elevation;
}

function inferGridBaseFromSnapshot(figmaData, primitiveValues) {
  const candidates = Array.isArray(primitiveValues) ? primitiveValues.slice() : [];
  const spacing = inferSpacingFromSnapshot(figmaData).spacing;
  if (spacing && spacing.semantic) {
    for (const values of Object.values(spacing.semantic)) {
      for (const value of values) if (value > 0 && value <= 32) candidates.push(Math.round(value));
    }
  }
  if (!candidates.length) return 8;
  return candidates.some(value => value % 8 !== 0 && value % 4 === 0) ? 4 : 8;
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

function _loadValidateSemanticPairs() {
  try {
    return require("../figlets-core.js").dsConfig.validateSemanticPairs;
  } catch (_) {
    try {
      return require("../figlets-core.js").dsConfig.validateSemanticPairs;
    } catch (err) {
      return null;
    }
  }
}

function _inferSemanticConvention(names) {
  const list = Array.from(names || []);
  let roleScore = 0;
  let surfaceScore = 0;
  for (const name of list) {
    if (/^color\/(?:bg|text|icon|border)\//i.test(name)) roleScore += 1;
    if (/^color\/text\/on-/i.test(name)) roleScore += 1;
    if (/^color\/(?:surface|on-surface|outline|on-fill)\//i.test(name)) surfaceScore += 1;
  }
  return surfaceScore > roleScore ? "surface-based" : "role-based";
}

function _filterGeneratedSemantics(generated, names) {
  if (!generated || !names || !names.size) return null;
  const pairs = [];
  const seenPairs = new Set();
  for (const pair of Array.isArray(generated.pairs) ? generated.pairs : []) {
    if (!pair || !names.has(pair.bg) || !names.has(pair.text)) continue;
    const next = {
      bg: pair.bg,
      text: pair.text,
    };
    if (pair.Light) next.Light = pair.Light;
    if (pair.Dark) next.Dark = pair.Dark;
    if (pair.min === null || typeof pair.min === "number") next.min = pair.min;
    if (pair.minLc === null || typeof pair.minLc === "number") next.minLc = pair.minLc;
    if (pair.note) next.note = pair.note;
    if (pair.icon && names.has(pair.icon)) next.icon = pair.icon;
    if (pair.border && names.has(pair.border)) next.border = pair.border;
    const key = next.bg + "|" + next.text;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    pairs.push(next);
  }

  const icons = (Array.isArray(generated.icons) ? generated.icons : [])
    .filter(item => item && names.has(item.token))
    .map(item => Object.assign({}, item));
  const unpaired = (Array.isArray(generated.unpaired) ? generated.unpaired : [])
    .filter(item => item && names.has(item.token))
    .map(item => Object.assign({}, item));

  return {
    convention: generated.convention,
    pairs,
    icons,
    unpaired,
  };
}

function _templateSemanticsFromSnapshot(figmaData, ramps, brand, opts) {
  const validateSemanticPairs = _loadValidateSemanticPairs();
  if (typeof validateSemanticPairs !== "function" || !ramps || !ramps.length || !brand || !brand.length) {
    return null;
  }
  const names = _nameSet(figmaData);
  const convention = _inferSemanticConvention(names);
  let validated;
  try {
    validated = validateSemanticPairs({
      color: {
        ramps,
        brand,
        convention,
        contrastAlgorithm: opts && opts.algorithm === "apca" ? "apca" : "wcag",
      },
    });
  } catch (_) {
    return null;
  }
  const generated = validated && validated.ds && validated.ds.color && validated.ds.color.semantics;
  return _filterGeneratedSemantics(generated, names);
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
  const spacingInfo = inferSpacingFromSnapshot(figmaData);
  const typography = inferTypographyFromSnapshot(figmaData);
  const elevation = inferElevationFromSnapshot(figmaData);
  const gridBase = inferGridBaseFromSnapshot(figmaData, spacingInfo.primitiveValues);
  const templateSemantics = _templateSemanticsFromSnapshot(figmaData, ramps, brand, opts);
  const inferredSemantics = inferSemanticsFromSnapshot(figmaData);
  const semantics = templateSemantics && templateSemantics.pairs && templateSemantics.pairs.length
    ? {
      convention: templateSemantics.convention || inferredSemantics.convention,
      pairs: templateSemantics.pairs,
      icons: templateSemantics.icons || [],
      unpaired: templateSemantics.unpaired || [],
    }
    : inferredSemantics;
  return {
    project: {
      name: (figmaData && figmaData.fileName) || "Imported Figma design system",
    },
    collections: inferCollectionsFromSnapshot(figmaData),
    grid: { base: gridBase },
    breakpoints,
    spacing: spacingInfo.spacing,
    typography,
    color: {
      ramps: ramps,
      brand: brand,
      contrastAlgorithm: opts.algorithm === "apca" ? "apca" : "wcag",
      semantics,
    },
    ...(Object.keys(elevation).length ? { elevation } : {}),
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
  inferElevationFromSnapshot,
  inferSemanticsFromSnapshot,
  inferSpacingFromSnapshot,
  inferTypographyFromSnapshot,
};
