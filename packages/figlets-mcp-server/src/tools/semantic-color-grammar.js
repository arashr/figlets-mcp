const BACKGROUND_GROUPS = ["surface", "bg", "background", "fill"];
const FOREGROUND_GROUPS = ["text", "fg", "foreground"];
const ICON_GROUPS = ["icon"];
const BORDER_GROUPS = ["border", "outline", "stroke"];
const ON_CONTEXT_GROUPS = ["on-surface", "on-bg", "on-background"];
const STRENGTH_WORDS = ["subtle", "muted", "bold", "emphasis", "strong", "weak", "container"];

function norm(value) {
  return String(value == null ? "" : value).toLowerCase();
}

function isPrimitiveColorName(name) {
  if (typeof name !== "string") return false;
  const parts = name.split("/");
  return parts.length === 3 && parts[0] === "color" && /^\d+$/.test(parts[2]);
}

function isSemanticColorName(name) {
  return typeof name === "string" && name.indexOf("color/") === 0 && !isPrimitiveColorName(name);
}

function findIndex(parts, groups) {
  return parts.findIndex(part => groups.includes(norm(part)));
}

function splitOnLeaf(leaf) {
  const value = norm(leaf);
  const contextual = /^on-(fill|surface|bg|background|color)-(.+)$/.exec(value);
  if (contextual) {
    return {
      kind: "contextual",
      context: contextual[1] === "color" ? "on-color" : `on-${contextual[1]}`,
      targetFamily: contextual[2],
    };
  }
  const shorthand = /^on-(.+)$/.exec(value);
  if (shorthand) {
    return {
      kind: "ambiguous",
      context: "ambiguous-on",
      targetFamily: shorthand[1],
    };
  }
  return {
    kind: "plain",
    context: "plain",
    targetFamily: value,
  };
}

function classifyName(name) {
  const parts = String(name || "").split("/");
  if (!isSemanticColorName(name)) return null;

  const bgIndex = findIndex(parts, BACKGROUND_GROUPS);
  if (bgIndex >= 0) {
    const group = norm(parts[bgIndex]);
    const leaf = parts[bgIndex + 1] || "";
    const on = splitOnLeaf(leaf);
    const family = on.targetFamily || norm(parts.slice(bgIndex + 1).join("/"));
    return {
      name,
      assetRole: "background",
      group,
      roleIndex: bgIndex,
      leaf: norm(leaf),
      family,
      context: group,
      targetContext: group,
      diagnostic: on.kind === "plain" ? "clean" : "invalid-name",
      diagnosticReason: on.kind === "plain"
        ? null
        : "Background/surface/fill tokens should not use an on-* leaf; on-* names describe foreground roles on a background context.",
      strength: parts.map(norm).find(part => STRENGTH_WORDS.includes(part)) || null,
      scope: parts.length > 4 ? "nested" : "global",
    };
  }

  const onGroupIndex = findIndex(parts, ON_CONTEXT_GROUPS);
  if (onGroupIndex >= 0) {
    const group = norm(parts[onGroupIndex]);
    const family = norm(parts[onGroupIndex + 1] || parts.slice(onGroupIndex + 1).join("/"));
    return {
      name,
      assetRole: "foreground",
      group,
      roleIndex: onGroupIndex,
      leaf: family,
      family,
      context: group,
      targetContext: group.replace(/^on-/, ""),
      diagnostic: "clean",
      diagnosticReason: null,
      strength: parts.map(norm).find(part => STRENGTH_WORDS.includes(part)) || null,
      scope: parts.length > 4 ? "nested" : "global",
    };
  }

  const fgIndex = findIndex(parts, FOREGROUND_GROUPS);
  const iconIndex = findIndex(parts, ICON_GROUPS);
  const borderIndex = findIndex(parts, BORDER_GROUPS);
  const roleIndex = fgIndex >= 0 ? fgIndex : iconIndex >= 0 ? iconIndex : borderIndex;
  if (roleIndex >= 0) {
    const group = norm(parts[roleIndex]);
    const leaf = parts[roleIndex + 1] || "";
    const on = splitOnLeaf(leaf);
    const assetRole = fgIndex >= 0 ? "text" : iconIndex >= 0 ? "icon" : "border";
    return {
      name,
      assetRole,
      group,
      roleIndex,
      leaf: norm(leaf),
      family: on.targetFamily || norm(parts.slice(roleIndex + 1).join("/")),
      context: on.context,
      targetContext: on.context === "plain" ? null : on.context.replace(/^on-/, ""),
      diagnostic: on.kind === "ambiguous" ? "ambiguous-name" : "clean",
      diagnosticReason: on.kind === "ambiguous"
        ? "The on-* suffix does not name an explicit context such as fill, surface, bg, or color. It may be valid in a paired-context system, but Figlets should not treat it as canonical without confirming the grammar."
        : null,
      strength: parts.map(norm).find(part => STRENGTH_WORDS.includes(part)) || null,
      scope: parts.length > 4 ? "nested" : "global",
    };
  }

  return {
    name,
    assetRole: "unknown",
    group: norm(parts[1] || ""),
    roleIndex: 1,
    leaf: norm(parts[parts.length - 1] || ""),
    family: norm(parts[parts.length - 1] || ""),
    context: "unknown",
    targetContext: null,
    diagnostic: "unknown-grammar",
    diagnosticReason: "Figlets does not recognize this semantic color naming shape yet.",
    strength: parts.map(norm).find(part => STRENGTH_WORDS.includes(part)) || null,
    scope: parts.length > 4 ? "nested" : "global",
  };
}

function scoreGrammars(classifications) {
  const clean = classifications.filter(item => item && item.diagnostic !== "invalid-name");
  const pairedEvidence = clean.filter(item =>
    (item.assetRole === "foreground" && item.context && item.context.indexOf("on-") === 0) ||
    (item.context === "surface" || item.context === "bg" || item.context === "background")
  ).length;
  const elementEvidence = clean.filter(item =>
    ["text", "icon", "border", "background"].includes(item.assetRole) &&
    ["text", "icon", "border", "fill", "bg", "surface", "background"].includes(item.group)
  ).length;
  const emphasisEvidence = clean.filter(item => item.strength).length;
  const nestedEvidence = clean.filter(item => item.scope === "nested").length;
  const total = Math.max(clean.length, 1);
  const candidates = [
    {
      id: "element-first",
      confidence: Math.round((elementEvidence / total) * 100) / 100,
      evidenceCount: elementEvidence,
      reason: "Tokens are grouped by applied element/function such as text, icon, border, fill, bg, or surface.",
    },
    {
      id: "paired-context",
      confidence: Math.round((pairedEvidence / total) * 100) / 100,
      evidenceCount: pairedEvidence,
      reason: "Tokens include background contexts and foreground roles that sit on those contexts.",
    },
    {
      id: "intent-emphasis",
      confidence: Math.round((emphasisEvidence / total) * 100) / 100,
      evidenceCount: emphasisEvidence,
      reason: "Tokens use strength words such as subtle, muted, bold, emphasis, or container.",
    },
    {
      id: "component-scoped",
      confidence: Math.round((nestedEvidence / total) * 100) / 100,
      evidenceCount: nestedEvidence,
      reason: "Tokens are nested deeply enough to suggest component or state scope.",
    },
  ].sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount || a.id.localeCompare(b.id));

  const best = candidates[0] || null;
  return {
    candidates,
    inferredGrammar: best && best.confidence >= 0.35 ? best.id : "unknown",
    confidence: best ? best.confidence : 0,
  };
}

function roleKey(item) {
  if (!item) return "";
  return [item.assetRole, item.context, item.family, item.scope].join("|");
}

function resolveAmbiguousOnContexts(items) {
  const backgroundByFamily = new Map();
  const preference = ["fill", "surface", "bg", "background"];
  for (const item of items) {
    if (!item || item.assetRole !== "background" || item.diagnostic !== "clean") continue;
    if (!backgroundByFamily.has(item.family)) backgroundByFamily.set(item.family, []);
    backgroundByFamily.get(item.family).push(item);
  }
  return items.map((item) => {
    if (!item || item.diagnostic !== "ambiguous-name") return item;
    const backgrounds = backgroundByFamily.get(item.family) || [];
    if (!backgrounds.length) return item;
    const background = backgrounds.slice().sort((left, right) =>
      preference.indexOf(left.group) - preference.indexOf(right.group)
    )[0];
    if (!background) return item;
    return Object.assign({}, item, {
      context: `on-${background.group}`,
      targetContext: background.group,
      diagnostic: "clean",
      diagnosticReason: null,
      resolvedContextToken: background.name,
    });
  });
}

function classifySemanticColorGrammar(variables = []) {
  const colorNames = variables
    .filter(variable => variable && variable.resolvedType === "COLOR" && isSemanticColorName(variable.name))
    .map(variable => variable.name);
  const tokenClassifications = resolveAmbiguousOnContexts(colorNames
    .map(classifyName)
    .filter(Boolean))
    .sort((a, b) => a.name.localeCompare(b.name));
  const grammar = scoreGrammars(tokenClassifications);
  const diagnostics = [];

  for (const item of tokenClassifications) {
    if (item.diagnostic === "invalid-name" || item.diagnostic === "ambiguous-name" || item.diagnostic === "unknown-grammar") {
      diagnostics.push({
        kind: item.diagnostic,
        token: item.name,
        assetRole: item.assetRole,
        context: item.context,
        family: item.family,
        severity: item.diagnostic === "invalid-name" ? "medium" : "low",
        reason: item.diagnosticReason,
      });
    }
  }

  const groups = new Map();
  for (const item of tokenClassifications) {
    if (item.diagnostic === "invalid-name" || item.diagnostic === "unknown-grammar") continue;
    const key = roleKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    diagnostics.push({
      kind: "true-duplicate",
      tokens: entries.map(item => item.name).sort(),
      assetRole: entries[0].assetRole,
      context: entries[0].context,
      family: entries[0].family,
      severity: "medium",
      reason: "Multiple semantic color tokens appear to occupy the same role, context, family, and scope.",
    });
  }

  return {
    inferredGrammar: grammar.inferredGrammar,
    confidence: grammar.confidence,
    grammarCandidates: grammar.candidates,
    tokenClassifications,
    diagnostics: diagnostics.sort((a, b) => {
      const order = { "invalid-name": 0, "true-duplicate": 1, "ambiguous-name": 2, "unknown-grammar": 3 };
      return (order[a.kind] || 9) - (order[b.kind] || 9)
        || String(a.token || (a.tokens || [])[0] || "").localeCompare(String(b.token || (b.tokens || [])[0] || ""));
    }),
  };
}

module.exports = {
  classifySemanticColorGrammar,
  classifyName,
  isSemanticColorName,
};
