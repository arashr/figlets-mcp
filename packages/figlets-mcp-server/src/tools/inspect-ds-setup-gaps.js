const fs = require("fs");
const path = require("path");
const { getActiveFileConfigPath } = require("../utils/paths.js");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { computePlannedAliases, loadDsConfigSafe } = require("../utils/accessible-repair-aliases.js");
const { ensureActiveDsConfig } = require("../utils/ensure-ds-config.js");

const inspectDsSetupGapsTool = {
  name: "inspect_ds_setup_gaps",
  description:
    "Read-only QA pass over the semantic color layer in the synced Figma snapshot. Reports missing foreground companions, missing backgrounds for on-* tokens, incomplete modes, contrast failures, icon contrast failures, broken aliases, and missing neighboring roles. Emits deterministic plannedReAlias/role suggestions only after Figlets pre-checks the suggested aliases against the relevant contrast rule; agents must not parse figma-data.json or run ad hoc scripts to invent repairs. Never mutates Figma or config.",
  inputSchema: {
    type: "object",
    properties: {
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      }
    },
    additionalProperties: false
  }
};

const _BG_FAMILIES = ["surface", "bg", "background", "fill"];
const _ON_FAMILIES = ["on-surface", "on-bg", "on-background"];
const _ON_TO_BG = { "on-surface": "surface", "on-bg": "bg", "on-background": "background" };
const _BORDER_FAMILIES = ["border", "outline", "stroke"];
const _ICON_FAMILIES = ["icon"];
const _FG_FAMILIES = ["text", "fg", "foreground", "on-surface", "on-bg", "on-background"];
const _FOUNDATION_ROLE_SPECS = [
  {
    role: "focus-border",
    families: _BORDER_FAMILIES,
    leaves: ["focus", "focus-ring"],
    reason: "This DS uses border/outline semantics but has no focus indicator border token. Keyboard focus needs a deliberate, prominent role.",
  },
];

const _WCAG_THRESHOLD = 4.5;
const _WCAG_ICON_THRESHOLD = 3;
const _APCA_THRESHOLD = 75;
// Hairline-failure tolerance: scores within this distance of the threshold are
// flagged near-miss so a triage pass can prioritize gross failures first.
const _WCAG_NEARMISS = 0.3;
const _APCA_NEARMISS = 5;
// Minimum complete pairs before "every pair is missing role X" can be treated
// as "this DS doesn't use role X" instead of coincidence.
const _ADVISORY_SUPPRESS_MIN_PAIRS = 3;

function _norm(value) {
  return String(value == null ? "" : value).toLowerCase();
}

function _isPrimitiveColorName(name) {
  if (typeof name !== "string") return false;
  const parts = name.split("/");
  if (parts.length !== 3 || parts[0] !== "color") return false;
  return /^\d+$/.test(parts[2]);
}

function _isSemanticColorName(name) {
  if (typeof name !== "string" || !name.length) return false;
  if (name.split("/")[0] !== "color") return false;
  return !_isPrimitiveColorName(name);
}

function _stripVariantSuffix(leaf) {
  const value = String(leaf || "");
  if (/-(variant|subtle|strong)$/i.test(value)) return value.replace(/-(variant|subtle|strong)$/i, "");
  return value;
}

function _sameCaseSegment(sourceSegment, replacement) {
  if (/^[A-Z0-9_-]+$/.test(sourceSegment)) return replacement.toUpperCase();
  if (/^[A-Z]/.test(sourceSegment)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function _swapSegment(parts, index, replacement) {
  const next = parts.slice();
  next[index] = _sameCaseSegment(parts[index], replacement);
  return next;
}

function _findFamilyIndex(parts, families) {
  return parts.findIndex(part => families.includes(_norm(part)));
}

function _roleForParts(parts) {
  const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
  if (bgIndex >= 0) return { role: "background", roleIndex: bgIndex };
  const fgIndex = _findFamilyIndex(parts, _FG_FAMILIES);
  if (fgIndex >= 0) return { role: "foreground", roleIndex: fgIndex };
  const iconIndex = _findFamilyIndex(parts, _ICON_FAMILIES);
  if (iconIndex >= 0) return { role: "icon", roleIndex: iconIndex };
  const borderIndex = _findFamilyIndex(parts, _BORDER_FAMILIES);
  if (borderIndex >= 0) return { role: "border", roleIndex: borderIndex };
  return null;
}

function _familyKeyForParts(parts, roleIndex) {
  const roleSegment = _norm(parts[roleIndex]);
  const afterRole = parts.slice(roleIndex + 1);
  if (afterRole.length && /^(text|fg|foreground|icon|border|outline|stroke)$/.test(roleSegment)) {
    const leaf = _norm(afterRole[0]);
    if (/^on-[^/]+$/.test(leaf)) {
      return [leaf.replace(/^on-/, "")].concat(afterRole.slice(1)).join("/");
    }
  }
  if (afterRole.length) return afterRole.join("/");
  const beforeRole = parts.slice(1, roleIndex);
  return beforeRole.length ? beforeRole.join("/") : parts.slice(1).join("/");
}

function _candidateNameForRole(exampleName, role, preferredFamilies) {
  const parts = String(exampleName || "").split("/");
  const info = _roleForParts(parts);
  if (!info) return null;
  const roleSegment = _norm(parts[info.roleIndex]);
  const roleLeaf = parts[info.roleIndex + 1];
  const hasOnLeaf = /^(text|fg|foreground|icon|border|outline|stroke)$/.test(roleSegment)
    && /^on-[^/]+$/i.test(_norm(roleLeaf));
  const preferred = preferredFamilies && preferredFamilies[role];
  const replacements = {
    foreground: info.role === "background" && _norm(parts[info.roleIndex]) === "surface" ? "on-surface" : "text",
    background: hasOnLeaf
      ? "fill"
      : info.role === "foreground" && /^on-/.test(_norm(parts[info.roleIndex]))
        ? _norm(parts[info.roleIndex]).replace(/^on-/, "")
      : "bg",
    icon: "icon",
    border: preferred || "border",
  };
  const replacement = replacements[role];
  if (!replacement) return null;
  const next = _swapSegment(parts, info.roleIndex, replacement);
  if (role === "background" && hasOnLeaf) {
    next[info.roleIndex + 1] = _sameCaseSegment(roleLeaf, _norm(roleLeaf).replace(/^on-/, ""));
  }
  return next.join("/");
}

function _hasRoleBasedFillBackground(cluster, byName) {
  if (!cluster || !byName) return false;
  const family = String(cluster.family || "");
  if (!family.length) return false;
  if (!cluster.roles || !Array.isArray(cluster.roles.foreground)) return false;
  const hasRoleBasedOnForeground = cluster.roles.foreground.some(name => {
    const parts = String(name || "").split("/");
    if (parts.length < 3) return false;
    const roleIndex = _findFamilyIndex(parts, ["text", "fg", "foreground"]);
    if (roleIndex < 0 || roleIndex + 1 >= parts.length) return false;
    return /^on-[^/]+$/i.test(_norm(parts[roleIndex + 1]));
  });
  if (!hasRoleBasedOnForeground) return false;
  return byName.has(`color/fill/${family}`);
}

function _clusterSemanticFamilies(semanticVars) {
  const clusters = new Map();
  for (const variable of semanticVars) {
    const parts = variable.name.split("/");
    const info = _roleForParts(parts);
    if (!info) continue;
    const key = _familyKeyForParts(parts, info.roleIndex);
    if (!key) continue;
    if (!clusters.has(key)) {
      clusters.set(key, {
        family: key,
        roles: { background: [], foreground: [], icon: [], border: [] },
      });
    }
    clusters.get(key).roles[info.role].push(variable.name);
  }
  return Array.from(clusters.values()).sort((a, b) => a.family.localeCompare(b.family));
}

function _roleConventionForName(name) {
  const parts = String(name || "").split("/");
  const info = _roleForParts(parts);
  if (!info) return null;
  const roleSegment = _norm(parts[info.roleIndex]);
  const leaf = parts[info.roleIndex + 1] || "";
  const normalizedLeaf = _norm(leaf);
  const family = _familyKeyForParts(parts, info.roleIndex);
  if (!family) return null;

  if (info.role === "background") {
    const convention = roleSegment === "fill" ? "role-based-fill" : "surface-based-background";
    return {
      name,
      role: "background",
      family,
      convention,
      familySegment: roleSegment,
      impliedCanonical: convention === "role-based-fill" ? "role-based" : "surface-based",
    };
  }

  const canUseOnLeaf = /^(text|fg|foreground|icon|border|outline|stroke)$/.test(roleSegment);
  const roleBased = canUseOnLeaf && /^on-[^/]+$/.test(normalizedLeaf);
  return {
    name,
    role: info.role,
    family,
    convention: roleBased ? "role-based-on-fill" : "surface-based-role",
    familySegment: roleSegment,
    leaf: normalizedLeaf,
    impliedCanonical: roleBased ? "role-based" : "surface-based",
  };
}

function _canonicalNamingRecommendation(familyConventions, role, tokens) {
  const backgroundConventions = familyConventions.background || [];
  const hasFill = backgroundConventions.some(entry => entry.convention === "role-based-fill");
  const hasSurface = backgroundConventions.some(entry => entry.convention === "surface-based-background");
  const hasRoleBasedCompanion = Object.keys(familyConventions).some(key =>
    key !== "background" &&
    familyConventions[key].some(entry => entry.convention === "role-based-on-fill")
  );
  const hasSurfaceBasedCompanion = Object.keys(familyConventions).some(key =>
    key !== "background" &&
    familyConventions[key].some(entry => entry.convention === "surface-based-role")
  );

  if (hasFill && !hasSurface && role !== "background") {
    return {
      convention: "role-based",
      keep: tokens.roleBased.slice(),
      review: tokens.surfaceBased.slice(),
      reason: "A color/fill/* background exists for this family, so the on-* role convention is likely the safer canonical path.",
    };
  }
  if (hasSurface && !hasFill && role !== "background") {
    return {
      convention: "surface-based",
      keep: tokens.surfaceBased.slice(),
      review: tokens.roleBased.slice(),
      reason: "A bg/surface/background token exists for this family, so the plain role token is likely the safer canonical path.",
    };
  }
  if (role === "background" && hasRoleBasedCompanion && !hasSurfaceBasedCompanion) {
    return {
      convention: "role-based",
      keep: tokens.roleBased.slice(),
      review: tokens.surfaceBased.slice(),
      reason: "This family already uses on-* foreground/icon/border roles, so color/fill/* is likely the safer background convention.",
    };
  }
  if (role === "background" && hasSurfaceBasedCompanion && !hasRoleBasedCompanion) {
    return {
      convention: "surface-based",
      keep: tokens.surfaceBased.slice(),
      review: tokens.roleBased.slice(),
      reason: "This family already uses plain foreground/icon/border roles, so bg/surface/background is likely the safer background convention.",
    };
  }
  return {
    convention: "designer-decision",
    keep: [],
    review: tokens.surfaceBased.concat(tokens.roleBased).sort(),
    reason: "Both naming systems are present or the surrounding context is incomplete, so Figlets should not pick a canonical token automatically.",
  };
}

function _detectSemanticNamingConflicts(semanticVars) {
  const byFamily = new Map();
  for (const variable of semanticVars) {
    const entry = _roleConventionForName(variable && variable.name);
    if (!entry) continue;
    if (!byFamily.has(entry.family)) byFamily.set(entry.family, {});
    const familyConventions = byFamily.get(entry.family);
    if (!familyConventions[entry.role]) familyConventions[entry.role] = [];
    familyConventions[entry.role].push(entry);
  }

  const conflicts = [];
  for (const [family, familyConventions] of byFamily) {
    for (const role of Object.keys(familyConventions)) {
      const entries = familyConventions[role];
      let surfaceBased = [];
      let roleBased = [];
      if (role === "background") {
        surfaceBased = entries
          .filter(entry => entry.convention === "surface-based-background")
          .map(entry => entry.name);
        roleBased = entries
          .filter(entry => entry.convention === "role-based-fill")
          .map(entry => entry.name);
      } else {
        surfaceBased = entries
          .filter(entry => entry.convention === "surface-based-role")
          .map(entry => entry.name);
        roleBased = entries
          .filter(entry => entry.convention === "role-based-on-fill")
          .map(entry => entry.name);
      }
      if (!surfaceBased.length || !roleBased.length) continue;
      surfaceBased = Array.from(new Set(surfaceBased)).sort();
      roleBased = Array.from(new Set(roleBased)).sort();
      const tokens = { surfaceBased, roleBased };
      const recommendation = _canonicalNamingRecommendation(familyConventions, role, tokens);
      conflicts.push({
        kind: "duplicate-intent-semantic",
        family,
        role,
        conventions: ["surface-based", "role-based"],
        tokens,
        canonicalRecommendation: recommendation,
        repairTier: "needs-designer-decision",
        agentAction: "ask-designer",
        reason: "This family mixes plain semantic names and on-* role names for the same apparent intent, which makes audits and downstream binding choices ambiguous.",
      });
    }
  }
  return conflicts.sort((a, b) => a.family.localeCompare(b.family) || a.role.localeCompare(b.role));
}

function _roleEvidence(cluster) {
  const names = [];
  for (const role of ["background", "foreground", "icon", "border"]) {
    for (const name of cluster.roles[role]) names.push(name);
  }
  return names.sort();
}

function _missingRoleFinding(cluster, missingRole, exampleName, confidence, reason, preferredFamilies) {
  return {
    kind: "missing-semantic-role",
    family: cluster.family,
    missingRole,
    suggestedName: _candidateNameForRole(exampleName, missingRole, preferredFamilies),
    evidence: _roleEvidence(cluster),
    confidence,
    basis: "semantic-family",
    agentAction: confidence === "high" ? "ask-designer" : "advisory-only",
    reason,
  };
}

function _preferredFamilyForRole(names, roleFamilies, fallback) {
  const counts = new Map();
  for (const name of names) {
    const parts = String(name || "").split("/");
    for (const part of parts) {
      const normalized = _norm(part);
      if (roleFamilies.indexOf(normalized) === -1) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  let best = fallback;
  let bestCount = 0;
  for (const family of roleFamilies) {
    const count = counts.get(family) || 0;
    if (count > bestCount) {
      best = family;
      bestCount = count;
    }
  }
  return best;
}

function _roleFamilySeen(names, families) {
  return names.some(name => {
    const parts = String(name || "").split("/");
    return _findFamilyIndex(parts, families) >= 0;
  });
}

function _foundationRoleFindings(allNames, semanticContext) {
  const findings = [];
  const configUnpaired = semanticContext && semanticContext.unpairedTokens
    ? Array.from(semanticContext.unpairedTokens)
    : [];
  const hasBorderSemantics = _roleFamilySeen(allNames, _BORDER_FAMILIES) || _roleFamilySeen(configUnpaired, _BORDER_FAMILIES);
  if (!hasBorderSemantics) return findings;

  for (const spec of _FOUNDATION_ROLE_SPECS) {
    const candidates = [];
    for (const family of spec.families) {
      for (const leaf of spec.leaves) candidates.push(`color/${family}/${leaf}`);
    }
    if (candidates.some(name => allNames.indexOf(name) !== -1)) continue;
    findings.push({
      kind: "missing-foundation-role",
      role: spec.role,
      suggestedNames: candidates,
      confidence: "high",
      basis: "foundation-role",
      agentAction: "ask-designer",
      reason: spec.reason,
    });
  }
  return findings;
}

function _semanticContextFromConfig(ds) {
  const semantics = ds && ds.color && ds.color.semantics ? ds.color.semantics : {};
  const pairTextByBg = new Map();
  const pairIconByBg = new Map();
  const pairBorderByBg = new Map();
  const unpairedTokens = new Set();
  const unpairedRows = [];
  if (Array.isArray(semantics.pairs)) {
    for (const pair of semantics.pairs) {
      if (pair && pair.bg && pair.text) pairTextByBg.set(pair.bg, pair.text);
      if (pair && pair.bg && pair.icon) pairIconByBg.set(pair.bg, pair.icon);
      if (pair && pair.bg && pair.border) pairBorderByBg.set(pair.bg, pair.border);
    }
  }
  if (Array.isArray(semantics.unpaired)) {
    for (const item of semantics.unpaired) {
      if (item && item.token) {
        unpairedTokens.add(item.token);
        unpairedRows.push(item);
      }
    }
  }
  return { pairTextByBg, pairIconByBg, pairBorderByBg, unpairedTokens, unpairedRows };
}

// Pick fg target families in priority order. Preserves the existing convention
// (surface→on-surface→text, bg→text→on-bg, background→on-background→text), then
// re-sorts so families that already appear somewhere in the file outrank ones
// that don't — keeps the recommended companion in the kit's own naming style.
function _targetFamiliesFor(bgSegment, allNames) {
  const segment = _norm(bgSegment);
  const preferred = segment === "surface"
    ? ["on-surface", "text", "fg", "foreground"]
    : segment === "fill"
      ? ["text", "on-fill", "fg", "foreground"]
    : segment === "background"
      ? ["on-background", "text", "fg", "foreground"]
      : ["text", "fg", "foreground", "on-bg"];

  return preferred.slice().sort((left, right) => {
    const leftSeen = allNames.some(name => name.split("/").some(part => _norm(part) === left));
    const rightSeen = allNames.some(name => name.split("/").some(part => _norm(part) === right));
    if (leftSeen === rightSeen) return 0;
    return leftSeen ? -1 : 1;
  });
}

function _foregroundCandidatesForBackgroundParts(parts, bgIndex, allNames) {
  const targetFamilies = _targetFamiliesFor(parts[bgIndex], allNames);
  const candidates = targetFamilies.map(family => _swapSegment(parts, bgIndex, family).join("/"));
  if (_norm(parts[bgIndex]) === "fill") {
    const roleBased = _swapSegment(parts, bgIndex, "text");
    const leafIndex = roleBased.length - 1;
    roleBased[leafIndex] = _sameCaseSegment(roleBased[leafIndex], `on-${_norm(roleBased[leafIndex])}`);
    candidates.unshift(roleBased.join("/"));
  }
  return Array.from(new Set(candidates));
}

function _iconCandidatesForBackgroundParts(parts, bgIndex) {
  const candidates = [];
  const base = _swapSegment(parts, bgIndex, "icon");
  candidates.push(base.join("/"));
  if (_norm(parts[bgIndex]) === "fill") {
    const withOnLeaf = base.slice();
    const leafIndex = withOnLeaf.length - 1;
    withOnLeaf[leafIndex] = _sameCaseSegment(withOnLeaf[leafIndex], `on-${_norm(withOnLeaf[leafIndex])}`);
    candidates.unshift(withOnLeaf.join("/"));
  }
  return Array.from(new Set(candidates));
}

function _companionRoleCandidate(bgName, targetFamilies, allNames) {
  const names = new Set(allNames);
  const parts = String(bgName || "").split("/");
  const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
  if (bgIndex < 0) return null;
  const leaf = parts[parts.length - 1] || "";
  const stem = _stripVariantSuffix(leaf);
  const candidates = [];
  for (const family of targetFamilies) {
    const next = _swapSegment(parts, bgIndex, family);
    candidates.push(next.join("/"));
  }
  if (stem !== leaf) {
    for (const family of targetFamilies) {
      const next = _swapSegment(parts, bgIndex, family);
      next[next.length - 1] = stem;
      candidates.push(next.join("/"));
    }
  }
  return candidates.find(candidate => names.has(candidate)) || null;
}

function _collectionFor(variable, collections) {
  return collections.find(c => Array.isArray(c.variableIds) && c.variableIds.includes(variable.id))
    || collections.find(c => c.id === variable.variableCollectionId)
    || null;
}

function _semanticConventionNames(colorVars, collections, existingDs) {
  const configuredColorCollection = existingDs &&
    existingDs.collections &&
    typeof existingDs.collections.color === "string"
    ? existingDs.collections.color
    : null;
  const selected = [];

  if (configuredColorCollection) {
    for (const collection of collections) {
      if (collection && collection.name === configuredColorCollection) selected.push(collection);
    }
  }

  if (!selected.length) {
    for (const collection of collections) {
      const name = _norm(collection && collection.name);
      if (/color/.test(name) && /semantic/.test(name)) selected.push(collection);
    }
  }

  if (!selected.length) {
    for (const collection of collections) {
      const name = _norm(collection && collection.name);
      if (/color/.test(name) && !/(primitive|ramp|base|foundation)/.test(name)) selected.push(collection);
    }
  }

  const configNames = [];
  const semantics = existingDs && existingDs.color && existingDs.color.semantics
    ? existingDs.color.semantics
    : {};
  if (Array.isArray(semantics.pairs)) {
    for (const pair of semantics.pairs) {
      if (pair && pair.bg) configNames.push(pair.bg);
      if (pair && pair.text) configNames.push(pair.text);
      if (pair && pair.icon) configNames.push(pair.icon);
      if (pair && pair.border) configNames.push(pair.border);
    }
  }
  if (Array.isArray(semantics.unpaired)) {
    for (const item of semantics.unpaired) {
      if (item && item.token) configNames.push(item.token);
    }
  }

  const fallback = colorVars
    .map(v => v.name)
    .filter(name => _isSemanticColorName(name));
  if (!selected.length) return fallback.concat(configNames);

  const selectedIds = new Set(selected.map(collection => collection && collection.id).filter(Boolean));
  const names = colorVars
    .filter(variable => {
      if (!_isSemanticColorName(variable.name)) return false;
      const collection = _collectionFor(variable, collections);
      return collection && selectedIds.has(collection.id);
    })
    .map(variable => variable.name);

  return names.length ? names.concat(configNames) : fallback.concat(configNames);
}

function _modeNameFor(collection, modeId) {
  if (!collection || !Array.isArray(collection.modes)) return null;
  const m = collection.modes.find(x => x.modeId === modeId);
  return m ? m.name : null;
}

function _aliasTargetNames(variable, varsById, collections) {
  const result = {};
  const values = variable && variable.valuesByMode ? variable.valuesByMode : {};
  const coll = _collectionFor(variable, collections);

  for (const modeId of Object.keys(values)) {
    const raw = values[modeId];
    if (!raw || typeof raw !== "object" || raw.type !== "VARIABLE_ALIAS") continue;
    const target = varsById.get(raw.id);
    const mode = coll && Array.isArray(coll.modes) ? coll.modes.find(m => m.modeId === modeId) : null;
    result[mode ? mode.name : modeId] = target ? target.name : raw.id;
  }
  return result;
}

// Walk an alias chain by mode name to a literal RGB and capture the terminal
// primitive's name. Mode IDs differ across collections, so each hop resolves
// by human-readable mode name (e.g. "Light", "Dark"); single-mode targets
// (primitives) fall back to their only mode. Returns { rgb, name } or null.
function _resolveTerminalByModeName(variable, modeName, varsById, collections, depth) {
  if (!variable || (depth || 0) > 8) return null;
  const coll = _collectionFor(variable, collections);
  let modeId = null;
  if (coll && Array.isArray(coll.modes)) {
    const m = coll.modes.find(x => _norm(x.name) === _norm(modeName));
    if (m) modeId = m.modeId;
  }
  if (!modeId) {
    const ids = Object.keys(variable.valuesByMode || {});
    if (ids.length === 1) modeId = ids[0];
  }
  if (!modeId) return null;
  const val = variable.valuesByMode && variable.valuesByMode[modeId];
  if (!val) return null;
  if (typeof val === "object" && val.type === "VARIABLE_ALIAS") {
    const next = varsById.get(val.id);
    if (!next) return null;
    return _resolveTerminalByModeName(next, modeName, varsById, collections, (depth || 0) + 1);
  }
  if (typeof val === "object" && "r" in val && "g" in val && "b" in val) {
    return { rgb: { r: val.r, g: val.g, b: val.b }, name: variable.name };
  }
  return null;
}

// Contrast math mirrors validate-semantic-pairs.js. Inlined here so the QA
// inspector has no hard dependency on a config — Figma is the source of truth.
function _linearize(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function _luminance(rgb) { return 0.2126 * _linearize(rgb.r) + 0.7152 * _linearize(rgb.g) + 0.0722 * _linearize(rgb.b); }
function _wcagRatio(a, b) {
  const la = _luminance(a), lb = _luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
function _hex(rgb) {
  if (!rgb || typeof rgb !== "object") return null;
  const channel = value => {
    const n = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255);
    const s = n.toString(16).toUpperCase();
    return s.length === 1 ? "0" + s : s;
  };
  return "#" + channel(rgb.r) + channel(rgb.g) + channel(rgb.b);
}
function _apcaLum(rgb) { return 0.2126729 * Math.pow(rgb.r, 2.4) + 0.7151522 * Math.pow(rgb.g, 2.4) + 0.0721750 * Math.pow(rgb.b, 2.4); }
function _apcaLc(txt, bg) {
  const BC = 0.022, BE = 1.414;
  const Yt = _apcaLum(txt), Yb = _apcaLum(bg);
  const Yt2 = Yt < BC ? Yt + Math.pow(BC - Yt, BE) : Yt;
  const Yb2 = Yb < BC ? Yb + Math.pow(BC - Yb, BE) : Yb;
  let lc;
  if (Yb2 >= Yt2) lc = (Math.pow(Yb2, 0.56) - Math.pow(Yt2, 0.57)) * 1.14;
  else            lc = (Math.pow(Yb2, 0.65) - Math.pow(Yt2, 0.62)) * 1.14;
  if (Math.abs(lc) < 0.1) return 0;
  return Math.round(lc > 0 ? lc * 100 - 2.7 : lc * 100 + 2.7);
}

function _primitiveInfo(name) {
  if (!_isPrimitiveColorName(name)) return null;
  const parts = String(name).split("/");
  const step = Number(parts[2]);
  if (!Number.isFinite(step)) return null;
  return { name, ramp: parts[1], step };
}

function _planIconReAlias(bgTerm, iconTerm, modeName, colorVars, varsById, collections) {
  const current = _primitiveInfo(iconTerm && iconTerm.name);
  if (!bgTerm || !bgTerm.rgb || !current) return null;
  const candidates = [];
  for (const variable of colorVars) {
    const info = _primitiveInfo(variable && variable.name);
    if (!info || info.ramp !== current.ramp || info.name === current.name) continue;
    const terminal = _resolveTerminalByModeName(variable, modeName, varsById, collections);
    if (!terminal || !terminal.rgb) continue;
    const ratio = _wcagRatio(bgTerm.rgb, terminal.rgb);
    if (ratio < _WCAG_ICON_THRESHOLD) continue;
    candidates.push({
      name: info.name,
      step: info.step,
      distance: Math.abs(info.step - current.step),
      ratio,
    });
  }
  candidates.sort((a, b) =>
    (a.distance - b.distance)
    || (b.ratio - a.ratio)
    || (a.step - b.step)
    || a.name.localeCompare(b.name)
  );
  return candidates[0] ? candidates[0].name : null;
}

function _nearestAccessiblePrimitiveOnRamp(colorVars, ramp, targetStep, bgRgb, varsById, collections, modeName, threshold) {
  const candidates = [];
  for (const variable of colorVars) {
    const info = _primitiveInfo(variable && variable.name);
    if (!info || info.ramp !== ramp) continue;
    const terminal = _resolveTerminalByModeName(variable, modeName, varsById, collections);
    if (!terminal || !terminal.rgb) continue;
    const ratio = _wcagRatio(bgRgb, terminal.rgb);
    if (ratio < threshold) continue;
    candidates.push({
      name: info.name,
      rgb: terminal.rgb,
      ratio,
      step: info.step,
      distance: Math.abs(info.step - targetStep),
    });
  }
  candidates.sort((a, b) =>
    (a.distance - b.distance)
    || (b.ratio - a.ratio)
    || (a.step - b.step)
    || a.name.localeCompare(b.name)
  );
  return candidates[0] || null;
}

function _nearestPrimitiveOnRamp(colorVars, ramp, targetStep) {
  const candidates = [];
  for (const variable of colorVars) {
    const info = _primitiveInfo(variable && variable.name);
    if (!info || info.ramp !== ramp) continue;
    candidates.push({
      name: info.name,
      distance: Math.abs(info.step - targetStep),
      step: info.step,
    });
  }
  candidates.sort((a, b) => (a.distance - b.distance) || (a.step - b.step) || a.name.localeCompare(b.name));
  return candidates[0] ? candidates[0].name : null;
}

function _modeTargetStepForRole(role, modeName, bgRgb) {
  const mode = _norm(modeName);
  if (role === "border") return mode === "dark" ? 800 : 200;
  if (role === "icon") return _luminance(bgRgb) >= 0.35 ? 700 : 300;
  if (role === "focus-border") return mode === "dark" ? 400 : 500;
  return null;
}

function _evidenceNameForRole(evidence, byName, roleName) {
  for (const name of evidence || []) {
    const variable = byName.get(name);
    if (!variable) continue;
    const role = _roleForParts(String(name).split("/"));
    if (role && role.role === roleName) return name;
  }
  return null;
}

function _planMissingIconRepairFromForeground(finding, byName, colorVars, varsById, collections) {
  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  const bgName = _evidenceNameForRole(evidence, byName, "background");
  const fgName = _evidenceNameForRole(evidence, byName, "foreground");
  if (!bgName || !fgName) return null;

  const bgVar = byName.get(bgName);
  const fgVar = byName.get(fgName);
  const coll = _collectionFor(bgVar, collections);
  if (!coll || !Array.isArray(coll.modes) || !coll.modes.length) return null;

  const aliases = {};
  const contrast = {};
  for (const mode of coll.modes) {
    const modeName = mode.name || mode.modeId;
    const bgTerm = _resolveTerminalByModeName(bgVar, mode.name, varsById, collections);
    const fgTerm = _resolveTerminalByModeName(fgVar, mode.name, varsById, collections);
    const fgInfo = _primitiveInfo(fgTerm && fgTerm.name);
    if (!bgTerm || !bgTerm.rgb || !fgTerm || !fgTerm.rgb || !fgInfo) return null;

    const fgRatio = _wcagRatio(bgTerm.rgb, fgTerm.rgb);
    let candidate = {
      name: fgTerm.name,
      rgb: fgTerm.rgb,
      ratio: fgRatio,
      source: "foreground-alias",
    };

    if (fgRatio < _WCAG_ICON_THRESHOLD) {
      const upgraded = _nearestAccessiblePrimitiveOnRamp(
        colorVars,
        fgInfo.ramp,
        fgInfo.step,
        bgTerm.rgb,
        varsById,
        collections,
        mode.name,
        _WCAG_ICON_THRESHOLD
      );
      if (!upgraded) return null;
      candidate = Object.assign({ source: "nearest-accessible-foreground-ramp" }, upgraded);
    }

    aliases[modeName] = candidate.name;
    contrast[modeName] = {
      background: bgName,
      backgroundAlias: bgTerm.name,
      backgroundHex: _hex(bgTerm.rgb),
      foreground: fgName,
      foregroundAlias: fgTerm.name,
      foregroundHex: _hex(fgTerm.rgb),
      alias: candidate.name,
      aliasHex: _hex(candidate.rgb),
      aliasSource: candidate.source,
      wcagRatio: Math.round(candidate.ratio * 10) / 10,
      threshold: _WCAG_ICON_THRESHOLD,
      pass: true,
    };
  }

  if (!Object.keys(aliases).length) return null;
  return {
    name: finding.suggestedName,
    role: "icon",
    aliases,
    source: bgName,
    basis: "foreground-alias",
    reason: "Icon role aliases are planned from the paired foreground aliases and pre-checked against WCAG non-text contrast before being suggested.",
    contrast,
  };
}

function _planMissingRoleRepair(finding, byName, colorVars, varsById, collections) {
  if (!finding || !finding.suggestedName) return null;
  if (finding.missingRole !== "border" && finding.missingRole !== "icon") return null;
  if (finding.missingRole === "icon") {
    return _planMissingIconRepairFromForeground(finding, byName, colorVars, varsById, collections);
  }
  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  const bgName = _evidenceNameForRole(evidence, byName, "background");
  if (!bgName) return null;
  const bgVar = byName.get(bgName);
  const coll = _collectionFor(bgVar, collections);
  if (!coll || !Array.isArray(coll.modes) || !coll.modes.length) return null;

  const aliases = {};
  const contrast = {};
  for (const mode of coll.modes) {
    const bgTerm = _resolveTerminalByModeName(bgVar, mode.name, varsById, collections);
    const info = _primitiveInfo(bgTerm && bgTerm.name);
    if (!info || !bgTerm || !bgTerm.rgb) return null;
    const targetStep = _modeTargetStepForRole(finding.missingRole, mode.name, bgTerm.rgb);
    if (!targetStep) return null;
    const modeName = mode.name || mode.modeId;
    if (finding.missingRole === "border") {
      const alias = _nearestPrimitiveOnRamp(colorVars, info.ramp, targetStep);
      if (alias) aliases[modeName] = alias;
      continue;
    }
    const candidate = _nearestAccessiblePrimitiveOnRamp(
      colorVars,
      info.ramp,
      targetStep,
      bgTerm.rgb,
      varsById,
      collections,
      mode.name,
      _WCAG_ICON_THRESHOLD
    );
    if (!candidate) return null;
    aliases[modeName] = candidate.name;
    contrast[modeName] = {
      background: bgName,
      backgroundAlias: bgTerm.name,
      backgroundHex: _hex(bgTerm.rgb),
      alias: candidate.name,
      aliasHex: _hex(candidate.rgb),
      wcagRatio: Math.round(candidate.ratio * 10) / 10,
      threshold: _WCAG_ICON_THRESHOLD,
      pass: true,
    };
  }
  if (!Object.keys(aliases).length) return null;
  const repair = {
    name: finding.suggestedName,
    role: finding.missingRole,
    aliases,
    source: bgName,
    basis: "background-ramp",
    reason: finding.missingRole === "icon"
      ? "Icon role aliases are planned from the paired background ramp and pre-checked against WCAG non-text contrast before being suggested."
      : "Border/outline role aliases are planned from the paired background ramp using the standard passive border steps.",
  };
  if (finding.missingRole === "icon") repair.contrast = contrast;
  return repair;
}

function _cleanConfigAliases(row) {
  const aliases = {};
  if (!row || typeof row !== "object") return aliases;
  for (const key of Object.keys(row)) {
    if (key === "token") continue;
    const value = row[key];
    if (typeof value === "string" && /^color\//.test(value)) aliases[key] = value;
  }
  return aliases;
}

function _foundationNameForRole(finding, preferredFamilies) {
  if (!finding || !Array.isArray(finding.suggestedNames)) return null;
  const preferred = preferredFamilies && preferredFamilies.border ? preferredFamilies.border : "border";
  const exact = finding.suggestedNames.find(name => {
    const parts = String(name || "").split("/");
    return parts.some(part => _norm(part) === preferred);
  });
  return exact || finding.suggestedNames[0] || null;
}

function _findDefaultBackground(byName) {
  for (const family of ["surface", "bg", "background"]) {
    const name = `color/${family}/default`;
    if (byName.has(name)) return byName.get(name);
  }
  return null;
}

function _primitiveByName(colorVars) {
  const out = new Map();
  for (const variable of colorVars) {
    if (_primitiveInfo(variable && variable.name)) out.set(variable.name, variable);
  }
  return out;
}

function _focusConfigRow(focusName, semanticContext) {
  const rows = semanticContext && Array.isArray(semanticContext.unpairedRows)
    ? semanticContext.unpairedRows
    : [];
  for (const row of rows) {
    if (row && row.token === focusName) return row;
  }
  return null;
}

function _focusContrastForAliases(focusName, aliases, bgVar, byName, colorVars, varsById, collections) {
  if (!bgVar) return null;
  const coll = _collectionFor(bgVar, collections);
  if (!coll || !Array.isArray(coll.modes) || !coll.modes.length) return null;
  const primitives = _primitiveByName(colorVars);
  const contrast = {};
  for (const mode of coll.modes) {
    const modeName = mode.name || mode.modeId;
    const aliasName = aliases[modeName];
    if (!aliasName) return null;
    const aliasVar = byName.get(aliasName) || primitives.get(aliasName);
    if (!aliasVar) return null;
    const bgTerm = _resolveTerminalByModeName(bgVar, mode.name, varsById, collections);
    const aliasTerm = _resolveTerminalByModeName(aliasVar, mode.name, varsById, collections);
    if (!bgTerm || !bgTerm.rgb || !aliasTerm || !aliasTerm.rgb) return null;
    const ratio = _wcagRatio(bgTerm.rgb, aliasTerm.rgb);
    if (ratio < _WCAG_ICON_THRESHOLD) return null;
    contrast[modeName] = {
      background: bgVar.name,
      backgroundAlias: bgTerm.name,
      backgroundHex: _hex(bgTerm.rgb),
      alias: aliasName,
      aliasHex: _hex(aliasTerm.rgb),
      wcagRatio: Math.round(ratio * 10) / 10,
      threshold: _WCAG_ICON_THRESHOLD,
      pass: true,
    };
  }
  return contrast;
}

function _planMissingForegroundFromBackground(bgVar, fgName, colorVars, varsById, collections, algorithm) {
  if (!bgVar || !fgName) return null;
  const coll = _collectionFor(bgVar, collections);
  if (!coll || !Array.isArray(coll.modes) || !coll.modes.length) return null;

  const aliases = {};
  const contrast = {};
  const threshold = algorithm === "apca" ? _APCA_THRESHOLD : _WCAG_THRESHOLD;

  for (const mode of coll.modes) {
    const bgTerm = _resolveTerminalByModeName(bgVar, mode.name, varsById, collections);
    const bgInfo = _primitiveInfo(bgTerm && bgTerm.name);
    if (!bgInfo || !bgTerm || !bgTerm.rgb) return null;

    const targetStep = _luminance(bgTerm.rgb) >= 0.5 ? 900 : 50;
    let candidate = null;
    if (algorithm === "apca") {
      const candidates = [];
      for (const variable of colorVars) {
        const info = _primitiveInfo(variable && variable.name);
        if (!info || info.ramp !== bgInfo.ramp) continue;
        const terminal = _resolveTerminalByModeName(variable, mode.name, varsById, collections);
        if (!terminal || !terminal.rgb) continue;
        const lc = Math.abs(_apcaLc(terminal.rgb, bgTerm.rgb));
        if (lc < _APCA_THRESHOLD) continue;
        candidates.push({
          name: info.name,
          rgb: terminal.rgb,
          score: lc,
          step: info.step,
          distance: Math.abs(info.step - targetStep),
        });
      }
      candidates.sort((a, b) =>
        (a.distance - b.distance)
        || (b.score - a.score)
        || (a.step - b.step)
        || a.name.localeCompare(b.name)
      );
      candidate = candidates[0] || null;
      if (candidate) {
        const modeName = mode.name || mode.modeId;
        aliases[modeName] = candidate.name;
        contrast[modeName] = {
          background: bgVar.name,
          backgroundAlias: bgTerm.name,
          backgroundHex: _hex(bgTerm.rgb),
          foreground: fgName,
          alias: candidate.name,
          aliasHex: _hex(candidate.rgb),
          apcaLc: Math.round(candidate.score * 10) / 10,
          threshold: _APCA_THRESHOLD,
          algorithm: "apca",
          pass: true,
        };
      }
    } else {
      candidate = _nearestAccessiblePrimitiveOnRamp(
        colorVars,
        bgInfo.ramp,
        targetStep,
        bgTerm.rgb,
        varsById,
        collections,
        mode.name,
        _WCAG_THRESHOLD
      );
      if (candidate) {
        const modeName = mode.name || mode.modeId;
        aliases[modeName] = candidate.name;
        contrast[modeName] = {
          background: bgVar.name,
          backgroundAlias: bgTerm.name,
          backgroundHex: _hex(bgTerm.rgb),
          foreground: fgName,
          alias: candidate.name,
          aliasHex: _hex(candidate.rgb),
          wcagRatio: Math.round(candidate.ratio * 10) / 10,
          threshold: _WCAG_THRESHOLD,
          algorithm: "wcag",
          pass: true,
        };
      }
    }
    if (!candidate) return null;
  }

  if (!Object.keys(aliases).length) return null;
  return {
    name: fgName,
    source: "background-ramp",
    aliases,
    contrast,
    basis: "background-ramp-contrast-search",
    reason: "Foreground aliases were derived from the background's ramp and checked for text contrast accessibility.",
  };
}

function _planFoundationRoleRepair(finding, byName, colorVars, varsById, collections, semanticContext, preferredFamilies) {
  if (!finding || finding.role !== "focus-border") return null;
  const name = _foundationNameForRole(finding, preferredFamilies);
  if (!name) return null;

  const bgVar = _findDefaultBackground(byName);
  const configRow = _focusConfigRow(name, semanticContext);
  if (configRow) {
    const aliases = _cleanConfigAliases(configRow);
    if (!Object.keys(aliases).length) return null;
    const contrast = _focusContrastForAliases(name, aliases, bgVar, byName, colorVars, varsById, collections);
    if (bgVar && !contrast) return null;
    const repair = {
      name,
      role: "focus-border",
      aliases,
      source: "config",
      basis: "config-focus-role",
      reason: bgVar
        ? "Focus border aliases come from the active config and were checked against the default surface/background."
        : "Focus border aliases come from the active config; no default surface/background was available for contrast verification.",
    };
    if (contrast) repair.contrast = contrast;
    return repair;
  }

  if (!bgVar) return null;
  const coll = _collectionFor(bgVar, collections);
  if (!coll || !Array.isArray(coll.modes) || !coll.modes.length) return null;

  const aliases = {};
  const contrast = {};
  for (const mode of coll.modes) {
    const bgTerm = _resolveTerminalByModeName(bgVar, mode.name, varsById, collections);
    if (!bgTerm || !bgTerm.rgb) return null;
    const targetStep = _modeTargetStepForRole("focus-border", mode.name, bgTerm.rgb);
    if (!targetStep) return null;
    let candidate = null;
    for (const ramp of ["brand", "primary", "accent", "blue"]) {
      candidate = _nearestAccessiblePrimitiveOnRamp(
        colorVars,
        ramp,
        targetStep,
        bgTerm.rgb,
        varsById,
        collections,
        mode.name,
        _WCAG_ICON_THRESHOLD
      );
      if (candidate) break;
    }
    if (!candidate) return null;
    const modeName = mode.name || mode.modeId;
    aliases[modeName] = candidate.name;
    contrast[modeName] = {
      background: bgVar.name,
      backgroundAlias: bgTerm.name,
      backgroundHex: _hex(bgTerm.rgb),
      alias: candidate.name,
      aliasHex: _hex(candidate.rgb),
      wcagRatio: Math.round(candidate.ratio * 10) / 10,
      threshold: _WCAG_ICON_THRESHOLD,
      pass: true,
    };
  }

  if (!Object.keys(aliases).length) return null;
  return {
    name,
    role: "focus-border",
    aliases,
    source: bgVar.name,
    basis: "default-background-ramp",
    reason: "Focus border aliases were selected from brand/primary/accent/blue ramps and checked against the default surface/background.",
    contrast,
  };
}

function inspectDsSetupGapsFromFigmaData(figmaData = {}, options = {}) {
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const colorVars = variables.filter(v => v && v.resolvedType === "COLOR" && typeof v.name === "string");
  const semanticVars = colorVars.filter(v => _isSemanticColorName(v.name));
  const byName = new Map(colorVars.map(v => [v.name, v]));
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));
  const allColorNames = colorVars.map(v => v.name);
  const algorithm = options.algorithm === "apca" ? "apca" : "wcag";
  const semanticFamilies = _clusterSemanticFamilies(semanticVars);
  const semanticNamingConflicts = _detectSemanticNamingConflicts(semanticVars);
  const semanticContext = _semanticContextFromConfig(options.existingDs);
  const foundationRoleFindings = _foundationRoleFindings(allColorNames, semanticContext);

  // ── Missing-foreground gaps ────────────────────────────────────────────────
  // Any background-family semantic token without a matching foreground in the
  // file (broadened from the original variant-only check). Status is "proposed"
  // when a usable source token can be inferred for the apply flow, "unresolved"
  // otherwise — designer decides what to do.
  const semanticGaps = [];
  for (const variable of semanticVars) {
    const parts = variable.name.split("/");
    const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
    if (bgIndex < 0) continue;
    if (_norm(parts[bgIndex]) === "fill") continue;
    const configuredText = semanticContext.pairTextByBg.get(variable.name);
    if (configuredText && byName.has(configuredText)) continue;
    if (semanticContext.unpairedTokens.has(variable.name)) continue;

    const families = _targetFamiliesFor(parts[bgIndex], allColorNames);
    const companionCandidates = _foregroundCandidatesForBackgroundParts(parts, bgIndex, allColorNames);
    if (companionCandidates.some(candidate => byName.has(candidate))) continue;

    const recommended = companionCandidates[0];
    const baseLeaf = _stripVariantSuffix(parts[parts.length - 1]);
    const sourceCandidates = [];
    for (const family of families) {
      const next = _swapSegment(parts, bgIndex, family);
      next[next.length - 1] = baseLeaf;
      sourceCandidates.push(next.join("/"));
    }
    for (const family of families) {
      const next = _swapSegment(parts, bgIndex, family);
      next[next.length - 1] = "default";
      sourceCandidates.push(next.join("/"));
    }
    const source = sourceCandidates.find(candidate => byName.has(candidate)) || null;
    const sourceVariable = source ? byName.get(source) : null;

    const gap = {
      kind: "missing-foreground-companion",
      bg: variable.name,
      recommended,
      source,
      sourceAliases: sourceVariable ? _aliasTargetNames(sourceVariable, varsById, collections) : {},
      reason: "Background semantic token has no matching foreground companion.",
      status: source ? "proposed" : "unresolved",
    };

    if (!source) {
      const derivedPlan = _planMissingForegroundFromBackground(
        variable,
        recommended,
        colorVars,
        varsById,
        collections,
        algorithm
      );
      if (derivedPlan && derivedPlan.aliases) {
        gap.source = "background-ramp";
        gap.sourceAliases = derivedPlan.aliases;
        gap.plannedAliases = derivedPlan.aliases;
        gap.plannedContrast = derivedPlan.contrast;
        gap.plannedBasis = derivedPlan.basis;
        gap.plannedReason = derivedPlan.reason;
        gap.status = "proposed";
      }
    }

    semanticGaps.push(gap);
  }
  semanticGaps.sort((left, right) => left.bg.localeCompare(right.bg));

  // ── Missing-background for on-* foregrounds ────────────────────────────────
  // Restricted to the explicit on-* pair pattern. Generic text/icon tokens
  // (`text/heading` etc.) often live without a dedicated surface, so they are
  // intentionally NOT treated as missing-bg candidates.
  const missingBackgrounds = [];
  for (const variable of semanticVars) {
    const parts = variable.name.split("/");
    const onIndex = _findFamilyIndex(parts, _ON_FAMILIES);
    if (onIndex < 0) continue;
    const onFamily = _norm(parts[onIndex]);
    const bgFamily = _ON_TO_BG[onFamily];
    if (!bgFamily) continue;
    const expectedBg = _swapSegment(parts, onIndex, bgFamily).join("/");
    if (byName.has(expectedBg)) continue;
    missingBackgrounds.push({
      kind: "missing-background-for-foreground",
      fg: variable.name,
      expectedBg,
      confidence: "high",
      agentAction: "ask-designer",
      reason: "Foreground (on-*) semantic token has no matching background. Figlets does not infer background aliases from foreground/icon/border roles; ask the designer what surface this role belongs on.",
    });
  }
  missingBackgrounds.sort((left, right) => left.fg.localeCompare(right.fg));

  // ── Incomplete modes ───────────────────────────────────────────────────────
  // A semantic token that has a value in some collection modes but not others.
  // Tokens with zero values everywhere are skipped — that's a different
  // problem (likely a placeholder), not "the dark mode value is missing".
  const incompleteModes = [];
  for (const variable of semanticVars) {
    const coll = _collectionFor(variable, collections);
    if (!coll || !Array.isArray(coll.modes) || coll.modes.length < 2) continue;
    const values = variable.valuesByMode || {};
    const definedIds = Object.keys(values).filter(id => values[id] != null);
    if (!definedIds.length) continue;
    const missing = [];
    for (const m of coll.modes) {
      if (values[m.modeId] == null) missing.push(m.name || m.modeId);
    }
    if (missing.length) {
      incompleteModes.push({
        kind: "incomplete-modes",
        token: variable.name,
        collection: coll.name,
        missingModes: missing,
        reason: "Semantic token has values in some collection modes but not others.",
      });
    }
  }
  incompleteModes.sort((left, right) => left.token.localeCompare(right.token));

  // ── Contrast failures ──────────────────────────────────────────────────────
  // For each background that has a resolvable foreground partner (by naming),
  // resolve both to literal RGB per mode and check WCAG ratio (or APCA Lc) at
  // the same thresholds the setup flow uses (4.5 / 75). Pairs that can't be
  // resolved to RGB on either side are skipped silently.
  const contrastFailures = [];
  for (const variable of semanticVars) {
    const parts = variable.name.split("/");
    const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
    if (bgIndex < 0) continue;
    const families = _targetFamiliesFor(parts[bgIndex], allColorNames);
    const configuredText = semanticContext.pairTextByBg.get(variable.name);
    const candidate = (configuredText && byName.has(configuredText))
      ? configuredText
      : _foregroundCandidatesForBackgroundParts(parts, bgIndex, allColorNames).find(name => byName.has(name));
    if (!candidate) continue;
    const fgVar = byName.get(candidate);
    const coll = _collectionFor(variable, collections);
    if (!coll || !Array.isArray(coll.modes)) continue;

    for (const mode of coll.modes) {
      const bgTerm = _resolveTerminalByModeName(variable, mode.name, varsById, collections);
      const fgTerm = _resolveTerminalByModeName(fgVar, mode.name, varsById, collections);
      if (!bgTerm || !fgTerm) continue;
      let pass = true, score = null, threshold = null, nearMissDelta = null;
      if (algorithm === "apca") {
        const lc = Math.abs(_apcaLc(fgTerm.rgb, bgTerm.rgb));
        score = lc;
        threshold = _APCA_THRESHOLD;
        nearMissDelta = _APCA_NEARMISS;
        pass = lc >= _APCA_THRESHOLD;
      } else {
        const ratio = _wcagRatio(bgTerm.rgb, fgTerm.rgb);
        score = Math.round(ratio * 10) / 10;
        threshold = _WCAG_THRESHOLD;
        nearMissDelta = _WCAG_NEARMISS;
        pass = ratio >= _WCAG_THRESHOLD;
      }
      if (!pass) {
        contrastFailures.push({
          kind: "contrast-failure",
          bg: variable.name,
          fg: fgVar.name,
          mode: mode.name,
          algorithm,
          score,
          threshold,
          nearMiss: (threshold - score) <= nearMissDelta,
          gap: Math.round((threshold - score) * 10) / 10,
          bgPrimitive: { name: bgTerm.name, rgb: bgTerm.rgb },
          fgPrimitive: { name: fgTerm.name, rgb: fgTerm.rgb },
          reason: "Pair fails the contrast threshold in this mode.",
        });
      }
    }
  }
  contrastFailures.sort((a, b) => a.bg.localeCompare(b.bg) || a.mode.localeCompare(b.mode));

  // ── Icon contrast failures ─────────────────────────────────────────────────
  // Icons are legal non-text contrast objects, so they always get a WCAG 3:1
  // check even when the text-pair algorithm is APCA. Config-authored pair.icon
  // wins; otherwise infer the companion by the same bg→icon naming pattern the
  // showcase uses for paired semantic rows.
  const iconContrastFailures = [];
  for (const variable of semanticVars) {
    const parts = variable.name.split("/");
    const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
    if (bgIndex < 0) continue;
    const configuredIcon = semanticContext.pairIconByBg.get(variable.name);
    let iconName = null;
    if (configuredIcon && byName.has(configuredIcon)) {
      iconName = configuredIcon;
    } else {
      const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
      if (bgIndex >= 0) {
        const iconCandidates = _iconCandidatesForBackgroundParts(parts, bgIndex);
        iconName = iconCandidates.find(name => byName.has(name)) || null;
      }
      if (!iconName) iconName = _companionRoleCandidate(variable.name, _ICON_FAMILIES, allColorNames);
    }
    if (!iconName || !byName.has(iconName)) continue;
    const iconVar = byName.get(iconName);
    const coll = _collectionFor(variable, collections);
    if (!coll || !Array.isArray(coll.modes)) continue;

    for (const mode of coll.modes) {
      const bgTerm = _resolveTerminalByModeName(variable, mode.name, varsById, collections);
      const iconTerm = _resolveTerminalByModeName(iconVar, mode.name, varsById, collections);
      if (!bgTerm || !iconTerm) continue;
      const ratio = _wcagRatio(bgTerm.rgb, iconTerm.rgb);
      if (ratio >= _WCAG_ICON_THRESHOLD) continue;
      const plannedIconAlias = _planIconReAlias(bgTerm, iconTerm, mode.name, colorVars, varsById, collections);
      iconContrastFailures.push({
        kind: "icon-contrast-failure",
        bg: variable.name,
        icon: iconVar.name,
        mode: mode.name,
        algorithm: "wcag-non-text",
        score: Math.round(ratio * 10) / 10,
        threshold: _WCAG_ICON_THRESHOLD,
        nearMiss: (_WCAG_ICON_THRESHOLD - ratio) <= _WCAG_NEARMISS,
        gap: Math.round((_WCAG_ICON_THRESHOLD - ratio) * 10) / 10,
        bgPrimitive: { name: bgTerm.name, rgb: bgTerm.rgb },
        iconPrimitive: { name: iconTerm.name, rgb: iconTerm.rgb },
        plannedReAlias: plannedIconAlias ? {
          token: iconVar.name,
          mode: mode.name,
          from: iconTerm.name,
          to: plannedIconAlias,
          expectedCurrentAlias: iconTerm.name,
          newAliasTarget: plannedIconAlias,
          threshold: _WCAG_ICON_THRESHOLD,
        } : null,
        reason: "Icon semantic role fails WCAG non-text contrast (3:1) on its paired surface.",
      });
    }
  }
  iconContrastFailures.sort((a, b) =>
    (a.score - b.score)
    || (b.gap - a.gap)
    || a.bg.localeCompare(b.bg)
    || a.icon.localeCompare(b.icon)
    || a.mode.localeCompare(b.mode)
  );

  // ── Broken aliases (semantic layer only) ───────────────────────────────────
  // Any semantic token whose VARIABLE_ALIAS points at a target id that's no
  // longer in the snapshot. No setup-vs-component classification — this tool
  // is scoped to the semantic layer; downstream component breakage is out of
  // scope for the QA pass.
  const brokenAliases = [];
  for (const variable of semanticVars) {
    const values = variable.valuesByMode || {};
    const coll = _collectionFor(variable, collections);
    for (const modeId of Object.keys(values)) {
      const v = values[modeId];
      if (!v || typeof v !== "object" || v.type !== "VARIABLE_ALIAS") continue;
      if (varsById.has(v.id)) continue;
      brokenAliases.push({
        kind: "broken-alias",
        holder: variable.name,
        mode: _modeNameFor(coll, modeId) || modeId,
        missingTargetId: v.id,
        reason: "Semantic token aliases a variable that no longer exists in this Figma file.",
      });
    }
  }
  brokenAliases.sort((a, b) => a.holder.localeCompare(b.holder) || String(a.mode).localeCompare(String(b.mode)));

  // ── Companion advisories (border, icon) ────────────────────────────────────
  // Pairs that have bg + fg but no border or icon companion. Advisory only.
  // If a role is missing in EVERY complete pair (and there are at least
  // _ADVISORY_SUPPRESS_MIN_PAIRS pairs), that's a property of the DS, not N
  // findings — suppress passive border/outline roles and report them once via
  // suppressedRoles. Icons are not suppressed here because they can be planned
  // as structured bulk repairs from the paired foreground token.
  const _RAW_ROLES = [
    { name: "border", families: _BORDER_FAMILIES },
    { name: "icon", families: _ICON_FAMILIES },
  ];
  const rawAdvisories = [];
  let totalCompletePairs = 0;
  for (const variable of semanticVars) {
    const parts = variable.name.split("/");
    const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
    if (bgIndex < 0) continue;
    const fgName = _foregroundCandidatesForBackgroundParts(parts, bgIndex, allColorNames).find(name => byName.has(name));
    if (!fgName) continue;
    const configuredText = semanticContext.pairTextByBg.get(variable.name);
    if (configuredText && configuredText !== fgName) continue;
    totalCompletePairs += 1;

    const missing = [];
    for (const role of _RAW_ROLES) {
      let candidates = [];
      if (role.name === "icon") {
        candidates = _iconCandidatesForBackgroundParts(parts, bgIndex);
      } else {
        for (const family of role.families) {
          candidates.push(_swapSegment(parts, bgIndex, family).join("/"));
          const stripped = _swapSegment(parts, bgIndex, family);
          stripped[stripped.length - 1] = _stripVariantSuffix(stripped[stripped.length - 1]);
          candidates.push(stripped.join("/"));
        }
      }
      if (!candidates.some(c => byName.has(c))) {
        missing.push({ role: role.name, suggestedNames: Array.from(new Set(candidates)).slice(0, 3) });
      }
    }
    if (missing.length) {
      rawAdvisories.push({
        kind: "missing-companion-advisory",
        bg: variable.name,
        fg: fgName,
        missing,
        reason: "Pair has a foreground but no border/icon companion. Optional — only flag if your DS uses these roles.",
      });
    }
  }
  // Decide which roles to suppress (DS doesn't use them at all).
  const roleMissingCounts = {};
  for (const role of _RAW_ROLES) roleMissingCounts[role.name] = 0;
  for (const adv of rawAdvisories) {
    for (const m of adv.missing) roleMissingCounts[m.role] = (roleMissingCounts[m.role] || 0) + 1;
  }
  const suppressedRoles = [];
  for (const role of _RAW_ROLES) {
    if (role.name === "icon") continue;
    const count = roleMissingCounts[role.name] || 0;
    if (totalCompletePairs >= _ADVISORY_SUPPRESS_MIN_PAIRS && count === totalCompletePairs) {
      suppressedRoles.push({ role: role.name, suppressedCount: count });
    }
  }
  const suppressedRoleNames = new Set(suppressedRoles.map(r => r.role));
  let companionAdvisories = [];
  for (const adv of rawAdvisories) {
    const filtered = adv.missing.filter(m => !suppressedRoleNames.has(m.role));
    if (!filtered.length) continue;
    companionAdvisories.push(Object.assign({}, adv, { missing: filtered }));
  }
  companionAdvisories.sort((a, b) => a.bg.localeCompare(b.bg));

  // ── Semantic-family role gaps ─────────────────────────────────────────────
  // This is still Figma-first QA: infer whether a semantic family looks
  // incomplete from the live token neighborhood, not from a saved contract.
  // It is intentionally read-only and emits confidence/action metadata so the
  // agent asks before moving into the repair flow.
  const rolePresence = { foreground: 0, icon: 0, border: 0 };
  for (const cluster of semanticFamilies) {
    for (const role of Object.keys(rolePresence)) {
      if (cluster.roles[role] && cluster.roles[role].length) rolePresence[role] += 1;
    }
  }
  const missingSemanticRoles = [];
  const semanticConventionNames = _semanticConventionNames(colorVars, collections, options.existingDs);
  const preferredFamilies = {
    border: _preferredFamilyForRole(semanticConventionNames, _BORDER_FAMILIES, "border"),
    icon: _preferredFamilyForRole(semanticConventionNames, _ICON_FAMILIES, "icon"),
  };
  for (const finding of foundationRoleFindings) {
    const planned = _planFoundationRoleRepair(
      finding,
      byName,
      colorVars,
      varsById,
      collections,
      semanticContext,
      preferredFamilies
    );
    if (planned) finding.plannedRoleRepair = planned;
  }
  for (const cluster of semanticFamilies) {
    const hasBg = cluster.roles.background.length > 0;
    const hasRoleBasedFillBg = !hasBg && _hasRoleBasedFillBackground(cluster, byName);
    const hasFg = cluster.roles.foreground.length > 0;
    const hasIcon = cluster.roles.icon.length > 0;
    const hasBorder = cluster.roles.border.length > 0;
    const evidenceCount = _roleEvidence(cluster).length;
    const example = (cluster.roles.background[0] || cluster.roles.foreground[0] || cluster.roles.icon[0] || cluster.roles.border[0]);
    const backgroundConfiguredElsewhere = cluster.roles.background.some(name => {
      const configuredText = semanticContext.pairTextByBg.get(name);
      return configuredText && byName.has(configuredText);
    });
    const backgroundConfiguredInCluster = cluster.roles.background.some(name => {
      const configuredText = semanticContext.pairTextByBg.get(name);
      return configuredText && cluster.roles.foreground.indexOf(configuredText) !== -1;
    });
    const hasPairContext = semanticContext.pairTextByBg.size > 0;
    const allBackgroundsUnpaired = hasBg && cluster.roles.background.every(name => semanticContext.unpairedTokens.has(name));

    if (hasBg && !hasFg && !backgroundConfiguredElsewhere && !allBackgroundsUnpaired) {
      missingSemanticRoles.push(_missingRoleFinding(
        cluster,
        "foreground",
        example,
        (hasIcon || hasBorder) ? "high" : "medium",
        "This semantic family has a background role but no foreground/text role in Figma.",
        preferredFamilies
      ));
    }

    if (!hasBg && !hasRoleBasedFillBg && hasFg && (hasIcon || hasBorder)) {
      missingSemanticRoles.push(_missingRoleFinding(
        cluster,
        "background",
        example,
        "high",
        "This semantic family has foreground/icon/border roles but no background role in Figma.",
        preferredFamilies
      ));
    }

    if (hasBg && hasFg && !hasIcon && evidenceCount >= 2 && (!hasPairContext || backgroundConfiguredInCluster)) {
      missingSemanticRoles.push(_missingRoleFinding(
        cluster,
        "icon",
        example,
        "high",
        "This semantic family has background and foreground roles, so Figlets can bulk-create an icon role from the paired foreground after approval.",
        preferredFamilies
      ));
    }

    if (rolePresence.border >= _ADVISORY_SUPPRESS_MIN_PAIRS && hasBg && hasFg && !hasBorder && evidenceCount >= 2 && (!hasPairContext || backgroundConfiguredInCluster)) {
      missingSemanticRoles.push(_missingRoleFinding(
        cluster,
        "border",
        example,
        hasIcon ? "high" : "medium",
        "This semantic family has background and foreground roles, and this DS uses border roles elsewhere.",
        preferredFamilies
      ));
    }
  }
  for (const finding of missingSemanticRoles) {
    const planned = _planMissingRoleRepair(finding, byName, colorVars, varsById, collections);
    if (planned) finding.plannedRoleRepair = planned;
  }
  const optionalSemanticRoleFindings = [];
  if (suppressedRoleNames.has("border")) {
    const reported = new Set(missingSemanticRoles.map(gap => `${gap.family}:${gap.missingRole}`));
    for (const cluster of semanticFamilies) {
      const hasBg = cluster.roles.background.length > 0;
      const hasFg = cluster.roles.foreground.length > 0;
      const hasBorder = cluster.roles.border.length > 0;
      const evidenceCount = _roleEvidence(cluster).length;
      const example = (cluster.roles.background[0] || cluster.roles.foreground[0] || cluster.roles.icon[0] || cluster.roles.border[0]);
      const backgroundConfiguredInCluster = cluster.roles.background.some(name => {
        const configuredText = semanticContext.pairTextByBg.get(name);
        return configuredText && cluster.roles.foreground.indexOf(configuredText) !== -1;
      });
      const hasPairContext = semanticContext.pairTextByBg.size > 0;
      if (!hasBg || !hasFg || hasBorder || evidenceCount < 2) continue;
      if (hasPairContext && !backgroundConfiguredInCluster) continue;
      if (reported.has(`${cluster.family}:border`)) continue;
      const finding = _missingRoleFinding(
        cluster,
        "border",
        example,
        "medium",
        "This design system appears to omit passive border/outline/stroke roles by convention; Figlets can bulk-create them if the designer wants that convention.",
        preferredFamilies
      );
      finding.optional = true;
      finding.repairTier = "optional";
      finding.agentAction = "optional-ask-designer";
      const planned = _planMissingRoleRepair(finding, byName, colorVars, varsById, collections);
      if (planned) finding.plannedRoleRepair = planned;
      optionalSemanticRoleFindings.push(finding);
    }
  }
  optionalSemanticRoleFindings.sort((a, b) =>
    a.family.localeCompare(b.family) || a.missingRole.localeCompare(b.missingRole)
  );
  missingSemanticRoles.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    const leftOrder = Object.prototype.hasOwnProperty.call(order, a.confidence) ? order[a.confidence] : 9;
    const rightOrder = Object.prototype.hasOwnProperty.call(order, b.confidence) ? order[b.confidence] : 9;
    return leftOrder - rightOrder
      || a.family.localeCompare(b.family)
      || a.missingRole.localeCompare(b.missingRole);
  });
  const reportedRoleByFamily = new Set(missingSemanticRoles.map(gap => `${gap.family}:${gap.missingRole}`));
  companionAdvisories = companionAdvisories
    .map((adv) => {
      const parts = String(adv.bg || "").split("/");
      const bgIndex = _findFamilyIndex(parts, _BG_FAMILIES);
      const family = bgIndex >= 0 ? _familyKeyForParts(parts, bgIndex) : "";
      const missing = adv.missing.filter(m => !reportedRoleByFamily.has(`${family}:${m.role}`));
      return Object.assign({}, adv, { missing });
    })
    .filter(adv => adv.missing.length);

  const highConfidenceIssues = []
    .concat(semanticNamingConflicts.map(item => Object.assign({ priority: "high" }, item)))
    .concat(iconContrastFailures.map(item => Object.assign({ priority: "high" }, item)))
    .concat(missingSemanticRoles.filter(gap => gap.confidence === "high").map(item => Object.assign({ priority: "high" }, item)))
    .concat(contrastFailures.filter(f => !f.nearMiss).map(item => Object.assign({ priority: "high" }, item)))
    .concat(foundationRoleFindings.map(item => Object.assign({ priority: "high" }, item)))
    .slice(0, 12);

  return {
    semanticGaps,
    semanticFamilies,
    missingSemanticRoles,
    missingBackgrounds,
    incompleteModes,
    contrastFailures,
    iconContrastFailures,
    semanticNamingConflicts,
    brokenAliases,
    foundationRoleFindings,
    optionalSemanticRoleFindings,
    companionAdvisories,
    suppressedAdvisoryRoles: suppressedRoles,
    contrastAlgorithm: algorithm,
    counts: {
      semanticVariables: semanticVars.length,
      completePairs: totalCompletePairs,
      semanticFamilies: semanticFamilies.length,
    },
    topFindings: {
      highConfidenceIssues,
      iconContrastFailures: iconContrastFailures.slice(0, 8),
      semanticNamingConflicts: semanticNamingConflicts.slice(0, 8),
      highConfidenceMissingRoles: missingSemanticRoles.filter(gap => gap.confidence === "high").slice(0, 8),
      optionalRoleRepairs: optionalSemanticRoleFindings.filter(gap => gap.plannedRoleRepair).slice(0, 8),
    },
    summary: {
      missingSemanticRoleCount: missingSemanticRoles.length,
      highConfidenceSemanticRoleGapCount: missingSemanticRoles.filter(gap => gap.confidence === "high").length,
      semanticGapCount: semanticGaps.length,
      proposedCount: semanticGaps.filter(gap => gap.status === "proposed").length,
      unresolvedCount: semanticGaps.filter(gap => gap.status === "unresolved").length,
      missingBackgroundCount: missingBackgrounds.length,
      incompleteModeCount: incompleteModes.length,
      contrastFailureCount: contrastFailures.length,
      contrastNearMissCount: contrastFailures.filter(f => f.nearMiss).length,
      iconContrastFailureCount: iconContrastFailures.length,
      iconContrastNearMissCount: iconContrastFailures.filter(f => f.nearMiss).length,
      semanticNamingConflictCount: semanticNamingConflicts.length,
      brokenAliasCount: brokenAliases.length,
      foundationRoleFindingCount: foundationRoleFindings.length,
      companionAdvisoryCount: companionAdvisories.length,
      suppressedAdvisoryRoleCount: suppressedRoles.length,
      optionalSemanticRoleRepairCount: optionalSemanticRoleFindings.filter(gap => gap.plannedRoleRepair).length,
    },
  };
}

// Env-first config-path lookup. paths.js caches LOCAL_DIR at require time, so
// late env changes there have no effect — but the inspector is called late, so
// re-read here to keep test isolation working without touching paths.js.
function _activeConfigPath() {
  if (process.env.FIGLETS_LOCAL_DIR) {
    const localDir = process.env.FIGLETS_LOCAL_DIR;
    try {
      const activeJson = path.join(localDir, "active-file.json");
      if (fs.existsSync(activeJson)) {
        const active = JSON.parse(fs.readFileSync(activeJson, "utf8"));
        if (active && active.fileKey) return path.join(localDir, active.fileKey, "design-system.config.js");
      }
    } catch (err) {}
    return path.join(localDir, "design-system.config.js");
  }
  try { return getActiveFileConfigPath(); }
  catch (err) { return null; }
}

function handleInspectDsSetupGaps(input = {}) {
  const dataSource = input.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: input.figmaDataPath })
    : (loadActiveFigmaDataSource(input) || loadFigmaDataSource(input));

  if (!dataSource) {
    return {
      error: "No synced Figma snapshot found.",
      hint: "Run sync_figma_data first, then inspect setup gaps again."
    };
  }

  const configStatus = input.config_path
    ? { configPath: path.resolve(input.config_path), configExists: fs.existsSync(path.resolve(input.config_path)), created: false }
    : ensureActiveDsConfig({ dataSource, reason: "inspect-ds-setup-gaps", refreshGenerated: true });
  const configPath = configStatus.configPath || _activeConfigPath();
  const existingDs = loadDsConfigSafe(configPath);
  const answers = (input.answers && typeof input.answers === "object") ? input.answers : {};
  const algorithm = answers.algorithm === "apca"
    ? "apca"
    : (existingDs && existingDs.color && existingDs.color.contrastAlgorithm === "apca" ? "apca" : "wcag");

  const result = inspectDsSetupGapsFromFigmaData(dataSource.figmaData, { algorithm, existingDs });
  result.config = {
    path: configPath,
    exists: Boolean(existingDs),
    created: Boolean(configStatus.created),
    refreshed: Boolean(configStatus.refreshed),
    sourceMode: existingDs ? "config-backed" : "snapshot-only",
    message: configStatus.message || null,
  };

  // Compute per-mode primitive aliases the designer would actually get if they
  // approved a missing-fg repair. Forwarded verbatim by apply_ds_setup_repairs
  // when present, so what the designer sees here matches what gets written.
  // Falls back silently when the snapshot or config don't support the picker.
  // Skips gaps that already have plannedAliases from background-ramp derivation.
  const algoOpt = { algorithm };
  for (const gap of result.semanticGaps) {
    if (gap.status !== "proposed" || !gap.source) continue;
    if (gap.plannedAliases) continue;
    const repair = { bg: gap.bg, name: gap.recommended, source: gap.source };
    const planned = computePlannedAliases(repair, dataSource.figmaData, existingDs, algoOpt);
    if (!planned) continue;
    gap.plannedAliases = planned.aliases;
    gap.plannedAlgorithm = planned.algorithm;
    gap.plannedUpgrades = planned.upgraded;
  }

  // Compute the upgrade for each contrast failure so the agent can offer it
  // as a one-tap fix. We reuse the same picker the setup flow uses by passing
  // the existing fg as both `name` and `source` of a synthetic repair — the
  // picker walks the fg's ramp and returns the nearest step that passes the
  // active contrast threshold. Falls back silently if either side doesn't
  // alias directly to a primitive (multi-hop chains aren't supported by the
  // picker, by design).
  const failuresByPair = new Map();
  for (const f of result.contrastFailures) {
    const key = f.bg + "|" + f.fg;
    if (!failuresByPair.has(key)) failuresByPair.set(key, []);
    failuresByPair.get(key).push(f);
  }
  for (const [key, fails] of failuresByPair) {
    const [bgName, fgName] = key.split("|");
    const planned = computePlannedAliases(
      { bg: bgName, name: fgName, source: fgName },
      dataSource.figmaData,
      existingDs,
      algoOpt
    );
    if (!planned || !planned.aliases) continue;
    for (const f of fails) {
      const upgrade = planned.aliases[f.mode];
      if (!upgrade) continue;
      if (!planned.upgraded || !planned.upgraded[f.mode]) continue;
      if (f.fgPrimitive && upgrade === f.fgPrimitive.name) continue;
      f.plannedReAlias = {
        token: fgName,
        mode: f.mode,
        from: f.fgPrimitive ? f.fgPrimitive.name : null,
        to: upgrade,
        expectedCurrentAlias: f.fgPrimitive ? f.fgPrimitive.name : null,
        newAliasTarget: upgrade,
      };
    }
  }

  const sourcePath = dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null;
  let syncedAt = null;
  if (sourcePath) {
    try { syncedAt = fs.statSync(sourcePath).mtime.toISOString(); }
    catch (err) { syncedAt = null; }
  }
  const variableCount = Array.isArray(dataSource.figmaData && dataSource.figmaData.variables)
    ? dataSource.figmaData.variables.length : 0;
  const collectionCount = Array.isArray(dataSource.figmaData && dataSource.figmaData.collections)
    ? dataSource.figmaData.collections.length : 0;
  const repairPlan = _buildRepairPlan(result);

  const source = {
      kind: dataSource.kind,
      target: dataSource.target,
      path: sourcePath,
    };
  const snapshot = {
      path: sourcePath,
      syncedAt,
      variableCount,
      collectionCount,
    };
  const message = _composeMessage(result.summary);

  return {
    // Keep the agent-actionable fields first. Some MCP hosts truncate or hide
    // long tool results behind local files; the repair payload must remain
    // visible without asking the agent to parse tool-results from disk.
    message,
    summary: result.summary,
    repairPlan,
    topFindings: result.topFindings,
    config: result.config,
    source,
    snapshot,
    semanticGaps: result.semanticGaps,
    missingSemanticRoles: result.missingSemanticRoles,
    contrastFailures: result.contrastFailures,
    iconContrastFailures: result.iconContrastFailures,
    semanticNamingConflicts: result.semanticNamingConflicts,
    missingBackgrounds: result.missingBackgrounds,
    incompleteModes: result.incompleteModes,
    brokenAliases: result.brokenAliases,
    foundationRoleFindings: result.foundationRoleFindings,
    optionalSemanticRoleFindings: result.optionalSemanticRoleFindings,
    companionAdvisories: result.companionAdvisories,
    suppressedAdvisoryRoles: result.suppressedAdvisoryRoles,
    semanticFamilies: result.semanticFamilies,
    contrastAlgorithm: result.contrastAlgorithm,
    counts: result.counts,
  };
}

function _buildRepairPlan(result) {
  const repairs = [];
  const aliasUpdates = [];
  const roleRepairs = [];
  const optionalRoleRepairs = [];
  const seenAlias = new Set();
  const seenRole = new Set();
  const seenOptionalRole = new Set();

  for (const gap of result.semanticGaps || []) {
    if (gap.status !== "proposed" || !gap.source || !gap.plannedAliases) continue;
    repairs.push({
      bg: gap.bg,
      recommended: gap.recommended,
      name: gap.recommended,
      source: gap.source,
      aliases: gap.plannedAliases,
    });
  }

  const collectAlias = (item) => {
    if (!item || !item.plannedReAlias) return;
    const update = item.plannedReAlias;
    const key = `${update.token}|${update.mode}`;
    if (seenAlias.has(key)) return;
    seenAlias.add(key);
    aliasUpdates.push({
      token: update.token,
      mode: update.mode,
      newAliasTarget: update.newAliasTarget || update.to,
      expectedCurrentAlias: update.expectedCurrentAlias || update.from || undefined,
    });
  };
  for (const item of result.contrastFailures || []) collectAlias(item);
  for (const item of result.iconContrastFailures || []) collectAlias(item);

  for (const gap of result.missingSemanticRoles || []) {
    if (gap.confidence !== "high" || !gap.plannedRoleRepair) continue;
    const repair = gap.plannedRoleRepair;
    if (!repair.name || !repair.role || !repair.aliases) continue;
    if (seenRole.has(repair.name)) continue;
    seenRole.add(repair.name);
    roleRepairs.push({
      name: repair.name,
      role: repair.role,
      aliases: repair.aliases,
    });
  }
  for (const gap of result.missingSemanticRoles || []) {
    if (gap.confidence === "high" || gap.missingRole !== "border" || !gap.plannedRoleRepair) continue;
    const repair = gap.plannedRoleRepair;
    if (!repair.name || !repair.role || !repair.aliases) continue;
    if (seenRole.has(repair.name) || seenOptionalRole.has(repair.name)) continue;
    seenOptionalRole.add(repair.name);
    optionalRoleRepairs.push({
      name: repair.name,
      role: repair.role,
      aliases: repair.aliases,
    });
  }
  for (const finding of result.foundationRoleFindings || []) {
    if (finding.confidence !== "high" || !finding.plannedRoleRepair) continue;
    const repair = finding.plannedRoleRepair;
    if (!repair.name || !repair.role || !repair.aliases) continue;
    if (seenRole.has(repair.name)) continue;
    seenRole.add(repair.name);
    roleRepairs.push({
      name: repair.name,
      role: repair.role,
      aliases: repair.aliases,
    });
  }
  for (const gap of result.optionalSemanticRoleFindings || []) {
    if (!gap.plannedRoleRepair) continue;
    const repair = gap.plannedRoleRepair;
    if (!repair.name || !repair.role || !repair.aliases) continue;
    if (seenRole.has(repair.name) || seenOptionalRole.has(repair.name)) continue;
    seenOptionalRole.add(repair.name);
    optionalRoleRepairs.push({
      name: repair.name,
      role: repair.role,
      aliases: repair.aliases,
    });
  }

  const total = repairs.length + aliasUpdates.length + roleRepairs.length;
  const optionalTotal = optionalRoleRepairs.length;
  const missingCapabilityNotes = [];
  for (const item of result.missingBackgrounds || []) {
    missingCapabilityNotes.push({
      kind: "missing-background",
      token: item.fg,
      expectedBg: item.expectedBg,
      reason: "Figlets found a foreground without a matching background, but background aliases are ambiguous and are not inferred from foreground/icon/border usage.",
      agentAction: "ask-designer",
    });
  }
  for (const gap of result.missingSemanticRoles || []) {
    if (gap.missingRole !== "background") continue;
    missingCapabilityNotes.push({
      kind: "missing-background",
      family: gap.family,
      suggestedName: gap.suggestedName,
      evidence: gap.evidence,
      reason: "Figlets found semantic roles without a background, but does not bulk-create missing backgrounds unless a future config-backed planner provides explicit aliases.",
      agentAction: "ask-designer",
    });
  }
  for (const conflict of result.semanticNamingConflicts || []) {
    missingCapabilityNotes.push({
      kind: "naming-system-mismatch",
      family: conflict.family,
      role: conflict.role,
      tokens: conflict.tokens,
      canonicalRecommendation: conflict.canonicalRecommendation,
      reason: "Figlets found mixed semantic naming conventions for the same apparent intent. Consolidation needs a designer-approved migration/deprecation decision.",
      agentAction: "ask-designer",
    });
  }
  const designerPresentation = _buildDesignerPresentation({
    total,
    optionalTotal,
    repairs,
    aliasUpdates,
    roleRepairs,
    optionalRoleRepairs,
    missingCapabilityNotes,
    result,
  });
  return {
    tool: "apply_ds_setup_repairs",
    approvalRequired: true,
    applyInput: { repairs, aliasUpdates, roleRepairs },
    optionalApplyInput: { repairs: [], aliasUpdates: [], roleRepairs: optionalRoleRepairs },
    counts: {
      repairs: repairs.length,
      aliasUpdates: aliasUpdates.length,
      roleRepairs: roleRepairs.length,
      optionalRoleRepairs: optionalRoleRepairs.length,
      total,
      optionalTotal,
    },
    designerSummary: total
      ? `Figlets has ${total} accessibility-checked structured repair suggestion${total === 1 ? "" : "s"} ready for designer approval.`
      : "Figlets has no deterministic repair payload for the current QA findings.",
    optionalDesignerSummary: optionalTotal
      ? `Figlets also has ${optionalTotal} optional passive border/outline/stroke role creation${optionalTotal === 1 ? "" : "s"} available if the designer wants that convention.`
      : "No optional convention-level bulk repairs are available.",
    missingCapabilityNotes,
    designerPresentation,
    agentInstruction: total
      ? "Before asking for approval, show every entry in repairPlan.designerPresentation.proposedChanges.readyToApply (or the matching What will change section) with exact token, action, mode aliases, and reason — not only a count. If approved, pass repairPlan.applyInput to apply_ds_setup_repairs unchanged; do not parse local tool-results files. Optional convention-level repairs in repairPlan.designerPresentation.proposedChanges.optional require separate designer approval before applying repairPlan.optionalApplyInput. Do not infer or create missing backgrounds unless Figlets provides an explicit background repair payload."
      : optionalTotal
        ? "Do not treat optional convention-level repairs as health-check failures. Explain repairPlan.optionalApplyInput in plain language, ask whether the designer wants those roles created, and only pass that payload to apply_ds_setup_repairs after explicit approval. Do not infer or create missing backgrounds unless Figlets provides an explicit background repair payload."
        : "Do not invent repairs or parse local tool-results files. Explain which findings need a product/tooling follow-up or designer decision, especially missing backgrounds with no explicit repair payload.",
  };
}

function _formatModeAliasLine(aliases) {
  if (!aliases || typeof aliases !== "object") return "";
  return Object.entries(aliases)
    .map(([mode, target]) => `${mode} → ${target}`)
    .join("; ");
}

function _aliasUpdateReason(update) {
  const token = update && update.token ? update.token : "";
  if (token.includes("/icon/")) return "icon contrast fix";
  return "contrast fix";
}

function _roleReason(role) {
  if (role === "border") return "missing passive border role";
  if (role === "icon") return "missing icon role";
  return `missing ${role} role`;
}

function _buildProposedSetupChanges(context) {
  const readyToApply = [];
  const optional = [];
  const needsDesignerDecision = [];

  for (const repair of context.repairs || []) {
    const token = repair.recommended || repair.name;
    const aliases = repair.aliases || {};
    readyToApply.push({
      tier: "ready to apply",
      token,
      action: "create companion",
      modes: Object.entries(aliases).map(([mode, target]) => ({ mode, target })),
      reason: "missing companion",
      summaryLine: `Create companion ${token} for ${repair.bg}: ${_formatModeAliasLine(aliases)} (missing companion).`,
    });
  }

  for (const update of context.aliasUpdates || []) {
    const from = update.expectedCurrentAlias;
    const to = update.newAliasTarget;
    const modeEntry = { mode: update.mode, target: to };
    if (from) modeEntry.from = from;
    const reason = _aliasUpdateReason(update);
    const modeText = from
      ? `${update.mode}: ${from} → ${to}`
      : `${update.mode} → ${to}`;
    readyToApply.push({
      tier: "ready to apply",
      token: update.token,
      action: "re-alias",
      modes: [modeEntry],
      reason,
      summaryLine: `Re-alias ${update.token} in ${modeText} (${reason}).`,
    });
  }

  for (const repair of context.roleRepairs || []) {
    const aliases = repair.aliases || {};
    const reason = _roleReason(repair.role);
    readyToApply.push({
      tier: "ready to apply",
      token: repair.name,
      action: "create role",
      modes: Object.entries(aliases).map(([mode, target]) => ({ mode, target })),
      reason,
      summaryLine: `Create ${repair.role} role ${repair.name}: ${_formatModeAliasLine(aliases)} (${reason}).`,
    });
  }

  for (const repair of context.optionalRoleRepairs || []) {
    const aliases = repair.aliases || {};
    const reason = _roleReason(repair.role);
    optional.push({
      tier: "optional",
      token: repair.name,
      action: "create role",
      modes: Object.entries(aliases).map(([mode, target]) => ({ mode, target })),
      reason,
      summaryLine: `Optionally create ${repair.role} role ${repair.name}: ${_formatModeAliasLine(aliases)} (${reason}).`,
    });
  }

  for (const note of context.missingCapabilityNotes || []) {
    if (note.kind === "missing-background") {
      const token = note.token || note.suggestedName || note.family;
      needsDesignerDecision.push({
        tier: "needs designer decision",
        token,
        action: "design decision",
        reason: "missing background",
        summaryLine: note.token
          ? `${token} needs a background role decision before Figlets can create anything.`
          : `${note.family || "semantic family"} needs a background role decision.`,
      });
    }
    if (note.kind === "naming-system-mismatch") {
      const tokens = note.tokens || {};
      const surfaceBased = Array.isArray(tokens.surfaceBased) ? tokens.surfaceBased : [];
      const roleBased = Array.isArray(tokens.roleBased) ? tokens.roleBased : [];
      const recommendation = note.canonicalRecommendation || {};
      const canonical = recommendation.convention || "designer-decision";
      needsDesignerDecision.push({
        tier: "needs designer decision",
        token: `${note.family}/${note.role}`,
        action: "choose canonical naming",
        reason: "mixed semantic naming",
        summaryLine: `Choose canonical naming for ${note.family} ${note.role}: ${surfaceBased.join(", ")} conflicts with ${roleBased.join(", ")} (${canonical}).`,
      });
    }
  }

  return { readyToApply, optional, needsDesignerDecision };
}

function _buildDesignerPresentation(context) {
  const result = context.result || {};
  const summary = result.summary || {};
  const proposedChanges = _buildProposedSetupChanges(context);
  const lines = [];
  const sections = [];

  if (context.total > 0) {
    lines.push(
      `I found ${context.total} safe repair${context.total === 1 ? "" : "s"} Figlets can apply after you approve. Each proposed change is listed below before you decide.`
    );
    sections.push({
      title: "What will change (ready to apply)",
      message: proposedChanges.readyToApply.map(change => change.summaryLine).join("\n"),
      items: proposedChanges.readyToApply.map(change => change.summaryLine),
    });
  } else {
    lines.push("I do not see any required one-click setup repairs for Figlets to apply right now.");
  }

  if (context.optionalTotal > 0) {
    lines.push(
      `There ${context.optionalTotal === 1 ? "is" : "are"} also ${context.optionalTotal} optional passive border/outline/stroke role${context.optionalTotal === 1 ? "" : "s"} available separately — not required for a healthy check.`
    );
    sections.push({
      title: "Optional convention (separate approval)",
      message: proposedChanges.optional.map(change => change.summaryLine).join("\n"),
      items: proposedChanges.optional.map(change => change.summaryLine),
    });
  }

  if (proposedChanges.needsDesignerDecision.length) {
    const missingBg = proposedChanges.needsDesignerDecision;
    const missingBgCount = missingBg.filter(change => change.reason === "missing background").length;
    const namingCount = missingBg.filter(change => change.reason === "mixed semantic naming").length;
    if (missingBgCount && !namingCount) {
      lines.push(
        `${missingBgCount} background role${missingBgCount === 1 ? " needs" : "s need"} your design decision before Figlets can create anything.`
      );
    } else if (namingCount && !missingBgCount) {
      lines.push(
        `${namingCount} semantic naming conflict${namingCount === 1 ? " needs" : "s need"} your design decision before Figlets can migrate or deprecate anything.`
      );
    } else {
      lines.push(
        `${missingBg.length} item${missingBg.length === 1 ? " needs" : "s need"} your design decision before Figlets can create, migrate, or deprecate anything.`
      );
    }
    sections.push({
      title: "Needs your call (not in apply payload)",
      message: missingBg.map(change => change.summaryLine).join("\n"),
      items: missingBg.map(change => change.summaryLine),
    });
  }

  if (!context.total && !context.optionalTotal && !proposedChanges.needsDesignerDecision.length) {
    lines[0] = "The semantic color setup looks clean from this QA pass.";
  }

  return {
    audience: "designer",
    tone: "plain-language",
    sayToDesigner: lines,
    sections,
    proposedChanges,
    approvalPrompt: context.total > 0
      ? "Review the ready-to-apply changes above, then tell me which entries to apply (or approve all)."
      : context.optionalTotal > 0
        ? "Review the optional convention changes above. Do you want Figlets to create those roles?"
        : null,
    avoid: [
      "Do not ask for approval using only a repair count — show the exact What will change lines first.",
      "Do not present this as a verification checklist.",
      "Do not dump repairPlan JSON unless the designer asks for exact payload details.",
      "Do not describe absent optional payloads as failures.",
      "Do not mix optional or needs-designer-decision items into the ready-to-apply apply payload.",
    ],
    sourceFields: [
      "repairPlan.applyInput",
      "repairPlan.optionalApplyInput",
      "repairPlan.missingCapabilityNotes",
      "repairPlan.designerPresentation.proposedChanges",
    ],
    summaryCounts: {
      readyRepairs: context.total,
      optionalRepairs: context.optionalTotal,
      missingBackgroundDecisions: proposedChanges.needsDesignerDecision.length,
      findings: {
        missingBackgrounds: summary.missingBackgroundCount || 0,
        semanticNamingConflicts: summary.semanticNamingConflictCount || 0,
        semanticRoleGaps: summary.missingSemanticRoleCount || 0,
        iconContrastFailures: summary.iconContrastFailureCount || 0,
      },
    },
  };
}

function _composeMessage(s) {
  const parts = [];
  if (s.missingSemanticRoleCount) parts.push(`${s.missingSemanticRoleCount} semantic-family role gap${s.missingSemanticRoleCount === 1 ? "" : "s"}`);
  if (s.semanticGapCount) parts.push(`${s.semanticGapCount} missing fg companion${s.semanticGapCount === 1 ? "" : "s"}`);
  if (s.missingBackgroundCount) parts.push(`${s.missingBackgroundCount} fg without bg`);
  if (s.incompleteModeCount) parts.push(`${s.incompleteModeCount} token${s.incompleteModeCount === 1 ? "" : "s"} with incomplete modes`);
  if (s.contrastFailureCount) parts.push(`${s.contrastFailureCount} contrast failure${s.contrastFailureCount === 1 ? "" : "s"}`);
  if (s.iconContrastFailureCount) parts.push(`${s.iconContrastFailureCount} icon contrast failure${s.iconContrastFailureCount === 1 ? "" : "s"}`);
  if (s.semanticNamingConflictCount) parts.push(`${s.semanticNamingConflictCount} semantic naming conflict${s.semanticNamingConflictCount === 1 ? "" : "s"}`);
  if (s.brokenAliasCount) parts.push(`${s.brokenAliasCount} broken alias${s.brokenAliasCount === 1 ? "" : "es"}`);
  if (s.foundationRoleFindingCount) parts.push(`${s.foundationRoleFindingCount} foundation role gap${s.foundationRoleFindingCount === 1 ? "" : "s"}`);
  if (s.companionAdvisoryCount) parts.push(`${s.companionAdvisoryCount} pair${s.companionAdvisoryCount === 1 ? "" : "s"} missing border/icon (advisory)`);
  if (!parts.length) return "Semantic color layer looks clean — no QA findings in the synced Figma snapshot.";
  return parts.join(", ") + ". Read-only QA pass — review with the designer before changing anything in Figma.";
}

module.exports = {
  inspectDsSetupGapsTool,
  handleInspectDsSetupGaps,
  inspectDsSetupGapsFromFigmaData,
  _buildRepairPlan,
};
