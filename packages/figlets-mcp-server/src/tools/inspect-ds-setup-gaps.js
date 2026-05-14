const fs = require("fs");
const path = require("path");
const { getActiveFileKey, getActiveFileConfigPath, getActiveFilePaths } = require("../utils/paths.js");
const { loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { computePlannedAliases, loadDsConfigSafe } = require("../utils/accessible-repair-aliases.js");

const inspectDsSetupGapsTool = {
  name: "inspect_ds_setup_gaps",
  description:
    "Read-only QA pass over the semantic color layer in the synced Figma snapshot. Reports missing foreground companions, missing backgrounds for on-* tokens, incomplete modes, contrast failures, broken aliases, and advisory missing border/icon companions. Never mutates Figma or config.",
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

const _BG_FAMILIES = ["surface", "bg", "background"];
const _ON_FAMILIES = ["on-surface", "on-bg", "on-background"];
const _ON_TO_BG = { "on-surface": "surface", "on-bg": "bg", "on-background": "background" };
const _BORDER_FAMILIES = ["border", "outline", "stroke"];
const _ICON_FAMILIES = ["icon"];
const _FG_FAMILIES = ["text", "fg", "foreground", "on-surface", "on-bg", "on-background"];

const _WCAG_THRESHOLD = 4.5;
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
  const afterRole = parts.slice(roleIndex + 1);
  if (afterRole.length) return afterRole.join("/");
  const beforeRole = parts.slice(1, roleIndex);
  return beforeRole.length ? beforeRole.join("/") : parts.slice(1).join("/");
}

function _candidateNameForRole(exampleName, role) {
  const parts = String(exampleName || "").split("/");
  const info = _roleForParts(parts);
  if (!info) return null;
  const replacements = {
    foreground: info.role === "background" && _norm(parts[info.roleIndex]) === "surface" ? "on-surface" : "text",
    background: info.role === "foreground" && /^on-/.test(_norm(parts[info.roleIndex]))
      ? _norm(parts[info.roleIndex]).replace(/^on-/, "")
      : "bg",
    icon: "icon",
    border: "border",
  };
  const replacement = replacements[role];
  if (!replacement) return null;
  return _swapSegment(parts, info.roleIndex, replacement).join("/");
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

function _roleEvidence(cluster) {
  const names = [];
  for (const role of ["background", "foreground", "icon", "border"]) {
    for (const name of cluster.roles[role]) names.push(name);
  }
  return names.sort();
}

function _missingRoleFinding(cluster, missingRole, exampleName, confidence, reason) {
  return {
    kind: "missing-semantic-role",
    family: cluster.family,
    missingRole,
    suggestedName: _candidateNameForRole(exampleName, missingRole),
    evidence: _roleEvidence(cluster),
    confidence,
    basis: "semantic-family",
    agentAction: confidence === "high" ? "ask-designer" : "advisory-only",
    reason,
  };
}

function _semanticContextFromConfig(ds) {
  const semantics = ds && ds.color && ds.color.semantics ? ds.color.semantics : {};
  const pairTextByBg = new Map();
  const unpairedTokens = new Set();
  if (Array.isArray(semantics.pairs)) {
    for (const pair of semantics.pairs) {
      if (pair && pair.bg && pair.text) pairTextByBg.set(pair.bg, pair.text);
    }
  }
  if (Array.isArray(semantics.unpaired)) {
    for (const item of semantics.unpaired) {
      if (item && item.token) unpairedTokens.add(item.token);
    }
  }
  return { pairTextByBg, unpairedTokens };
}

// Pick fg target families in priority order. Preserves the existing convention
// (surface→on-surface→text, bg→text→on-bg, background→on-background→text), then
// re-sorts so families that already appear somewhere in the file outrank ones
// that don't — keeps the recommended companion in the kit's own naming style.
function _targetFamiliesFor(bgSegment, allNames) {
  const segment = _norm(bgSegment);
  const preferred = segment === "surface"
    ? ["on-surface", "text", "fg", "foreground"]
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

function _collectionFor(variable, collections) {
  return collections.find(c => Array.isArray(c.variableIds) && c.variableIds.includes(variable.id))
    || collections.find(c => c.id === variable.variableCollectionId)
    || null;
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
  const semanticContext = _semanticContextFromConfig(options.existingDs);

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
    const configuredText = semanticContext.pairTextByBg.get(variable.name);
    if (configuredText && byName.has(configuredText)) continue;
    if (semanticContext.unpairedTokens.has(variable.name)) continue;

    const families = _targetFamiliesFor(parts[bgIndex], allColorNames);
    const companionCandidates = families.map(family => _swapSegment(parts, bgIndex, family).join("/"));
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

    semanticGaps.push({
      kind: "missing-foreground-companion",
      bg: variable.name,
      recommended,
      source,
      sourceAliases: sourceVariable ? _aliasTargetNames(sourceVariable, varsById, collections) : {},
      reason: "Background semantic token has no matching foreground companion.",
      status: source ? "proposed" : "unresolved",
    });
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
      reason: "Foreground (on-*) semantic token has no matching background.",
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
      : families
        .map(family => _swapSegment(parts, bgIndex, family).join("/"))
        .find(name => byName.has(name));
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
  // findings — suppress the role and report it once via suppressedRoles.
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
    const families = _targetFamiliesFor(parts[bgIndex], allColorNames);
    const fgName = families
      .map(family => _swapSegment(parts, bgIndex, family).join("/"))
      .find(name => byName.has(name));
    if (!fgName) continue;
    const configuredText = semanticContext.pairTextByBg.get(variable.name);
    if (configuredText && configuredText !== fgName) continue;
    totalCompletePairs += 1;

    const missing = [];
    for (const role of _RAW_ROLES) {
      const candidates = [];
      for (const family of role.families) {
        candidates.push(_swapSegment(parts, bgIndex, family).join("/"));
        const stripped = _swapSegment(parts, bgIndex, family);
        stripped[stripped.length - 1] = _stripVariantSuffix(stripped[stripped.length - 1]);
        candidates.push(stripped.join("/"));
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
  for (const cluster of semanticFamilies) {
    const hasBg = cluster.roles.background.length > 0;
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
        "This semantic family has a background role but no foreground/text role in Figma."
      ));
    }

    if (!hasBg && hasFg && (hasIcon || hasBorder)) {
      missingSemanticRoles.push(_missingRoleFinding(
        cluster,
        "background",
        example,
        "high",
        "This semantic family has foreground/icon/border roles but no background role in Figma."
      ));
    }

    if (rolePresence.icon >= _ADVISORY_SUPPRESS_MIN_PAIRS && hasBg && hasFg && !hasIcon && evidenceCount >= 2 && (!hasPairContext || backgroundConfiguredInCluster)) {
      missingSemanticRoles.push(_missingRoleFinding(
        cluster,
        "icon",
        example,
        hasBorder ? "high" : "medium",
        "This semantic family has background and foreground roles, and this DS uses icon roles elsewhere."
      ));
    }

    if (rolePresence.border >= _ADVISORY_SUPPRESS_MIN_PAIRS && hasBg && hasFg && !hasBorder && evidenceCount >= 2 && (!hasPairContext || backgroundConfiguredInCluster)) {
      missingSemanticRoles.push(_missingRoleFinding(
        cluster,
        "border",
        example,
        hasIcon ? "high" : "medium",
        "This semantic family has background and foreground roles, and this DS uses border roles elsewhere."
      ));
    }
  }
  missingSemanticRoles.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.confidence] || 9) - (order[b.confidence] || 9)
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

  return {
    semanticGaps,
    semanticFamilies,
    missingSemanticRoles,
    missingBackgrounds,
    incompleteModes,
    contrastFailures,
    brokenAliases,
    companionAdvisories,
    suppressedAdvisoryRoles: suppressedRoles,
    contrastAlgorithm: algorithm,
    counts: {
      semanticVariables: semanticVars.length,
      completePairs: totalCompletePairs,
      semanticFamilies: semanticFamilies.length,
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
      brokenAliasCount: brokenAliases.length,
      companionAdvisoryCount: companionAdvisories.length,
      suppressedAdvisoryRoleCount: suppressedRoles.length,
    },
  };
}

function _loadDefaultActiveSnapshot() {
  const activePaths = getActiveFilePaths();
  if (!fs.existsSync(activePaths.data)) return null;
  return {
    kind: "active-file-snapshot",
    target: getActiveFileKey() || activePaths.data,
    figmaData: JSON.parse(fs.readFileSync(activePaths.data, "utf8")),
    meta: { path: activePaths.data }
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
    : (_loadDefaultActiveSnapshot() || loadFigmaDataSource(input));

  if (!dataSource) {
    return {
      error: "No synced Figma snapshot found.",
      hint: "Run sync_figma_data first, then inspect setup gaps again."
    };
  }

  const configPath = input.config_path ? path.resolve(input.config_path) : _activeConfigPath();
  const existingDs = loadDsConfigSafe(configPath);
  const answers = (input.answers && typeof input.answers === "object") ? input.answers : {};
  const algorithm = answers.algorithm === "apca"
    ? "apca"
    : (existingDs && existingDs.color && existingDs.color.contrastAlgorithm === "apca" ? "apca" : "wcag");

  const result = inspectDsSetupGapsFromFigmaData(dataSource.figmaData, { algorithm, existingDs });

  // Compute per-mode primitive aliases the designer would actually get if they
  // approved a missing-fg repair. Forwarded verbatim by apply_ds_setup_repairs
  // when present, so what the designer sees here matches what gets written.
  // Falls back silently when the snapshot or config don't support the picker.
  const algoOpt = { algorithm };
  for (const gap of result.semanticGaps) {
    if (gap.status !== "proposed" || !gap.source) continue;
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

  return Object.assign({}, result, {
    source: {
      kind: dataSource.kind,
      target: dataSource.target,
      path: sourcePath,
    },
    snapshot: {
      path: sourcePath,
      syncedAt,
      variableCount,
      collectionCount,
    },
    message: _composeMessage(result.summary),
  });
}

function _composeMessage(s) {
  const parts = [];
  if (s.missingSemanticRoleCount) parts.push(`${s.missingSemanticRoleCount} semantic-family role gap${s.missingSemanticRoleCount === 1 ? "" : "s"}`);
  if (s.semanticGapCount) parts.push(`${s.semanticGapCount} missing fg companion${s.semanticGapCount === 1 ? "" : "s"}`);
  if (s.missingBackgroundCount) parts.push(`${s.missingBackgroundCount} fg without bg`);
  if (s.incompleteModeCount) parts.push(`${s.incompleteModeCount} token${s.incompleteModeCount === 1 ? "" : "s"} with incomplete modes`);
  if (s.contrastFailureCount) parts.push(`${s.contrastFailureCount} contrast failure${s.contrastFailureCount === 1 ? "" : "s"}`);
  if (s.brokenAliasCount) parts.push(`${s.brokenAliasCount} broken alias${s.brokenAliasCount === 1 ? "" : "es"}`);
  if (s.companionAdvisoryCount) parts.push(`${s.companionAdvisoryCount} pair${s.companionAdvisoryCount === 1 ? "" : "s"} missing border/icon (advisory)`);
  if (!parts.length) return "Semantic color layer looks clean — no QA findings in the synced Figma snapshot.";
  return parts.join(", ") + ". Read-only QA pass — review with the designer before changing anything in Figma.";
}

module.exports = {
  inspectDsSetupGapsTool,
  handleInspectDsSetupGaps,
  inspectDsSetupGapsFromFigmaData,
};
