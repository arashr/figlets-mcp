"use strict";

function resolveVariableValue(variable, varsById = {}, depth = 0) {
  if (!variable || depth > 8) return null;
  const modeIds = Object.keys(variable.valuesByMode || {});
  if (modeIds.length === 0) return null;
  const value = variable.valuesByMode[modeIds[0]];
  if (!value && value !== 0) return null;
  if (typeof value === "object" && value.type === "VARIABLE_ALIAS") {
    const aliased = varsById instanceof Map ? varsById.get(value.id) : varsById[value.id];
    return aliased ? resolveVariableValue(aliased, varsById, depth + 1) : null;
  }
  return value;
}

function scoreFloatVariableName(name, purpose) {
  const n = String(name || "").toLowerCase();
  const depth = String(name || "").split("/").length;

  if (purpose === "typography") {
    if (!/(?:^|\/)(type|font|line-height|tracking|letter|weight|size)(?:\/|$|-)/i.test(n)) return -1;
    return (/^type\//.test(n) ? 50 : 20) + depth;
  }

  if (purpose === "border") {
    if (!/(?:^|\/)(border|stroke|outline)(?:\/|$|-)/i.test(n)) return -1;
    return (/^space\/border\//.test(n) ? 80 : 30) + depth;
  }

  if (purpose === "radius") {
    if (/shadow|elevation|blur|offset|type|font|line-height|tracking|weight/i.test(n)) return -1;
    if (!/(?:^|\/)(radius|corner|round)(?:\/|$|-)/i.test(n)) return -1;
    return (/^space\/radius\//.test(n) ? 80 : 30) + depth;
  }

  if (/shadow|elevation|type|font|line-height|tracking|weight|radius|border|stroke/i.test(n)) return -1;
  if (!/(?:^|\/)(space|spacing|gap|padding|margin|inset|stack|layout|component|touch)(?:\/|$|-)/i.test(n)) return -1;
  return (/^space\//.test(n) ? 80 : 30) + depth;
}

function pickFloatVariableByValue(variables, value, purpose, options = {}) {
  const want = Number(value);
  if (!Number.isFinite(want)) return null;

  const varsById = options.varsById || new Map((variables || []).map(v => [v.id, v]));
  let best = null;
  let bestScore = -1;

  for (const variable of variables || []) {
    if (!variable || variable.resolvedType !== "FLOAT") continue;
    const resolved = resolveVariableValue(variable, varsById);
    if (typeof resolved !== "number" || Number(resolved) !== want) continue;
    const score = scoreFloatVariableName(variable.name, purpose);
    if (score > bestScore) {
      best = variable;
      bestScore = score;
    }
  }

  return bestScore >= 0 ? best : null;
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pickTextStyleLike(textStyles, patterns) {
  const list = Array.isArray(textStyles) ? textStyles : [];
  const lower = (patterns || []).map(p => String(p).toLowerCase());
  const normalized = (patterns || []).map(normalizeName);

  for (const style of list) {
    const name = String(style && style.name ? style.name : "").toLowerCase();
    const normalizedName = normalizeName(name);
    for (let i = 0; i < lower.length; i++) {
      if (name.indexOf(lower[i]) >= 0 || normalizedName.indexOf(normalized[i]) >= 0) return style;
    }
  }

  return null;
}

function buildTypographyVariableGroups(variables, options = {}) {
  const varsById = options.varsById || new Map((variables || []).map(v => [v.id, v]));
  const groups = {};
  let sharedFamilyVar = null;

  for (const variable of variables || []) {
    if (!variable || !variable.name) continue;
    const name = String(variable.name);
    if (variable.resolvedType === "STRING" && /(?:^|\/)(family|font-family|fontFamily)(?:\/|$|-)/i.test(name)) {
      if (!sharedFamilyVar) sharedFamilyVar = variable;
    }

    if (variable.resolvedType !== "FLOAT" && variable.resolvedType !== "STRING") continue;
    const parts = name.split("/");
    if (parts.length < 4) continue;
    if (!/^(type|typo|typography)$/i.test(parts[0])) continue;
    const prop = parts[parts.length - 1].toLowerCase();
    const groupKey = parts.slice(0, -1).join("/");
    if (!groups[groupKey]) groups[groupKey] = { key: groupKey };
    if (prop === "size" || prop === "font-size" || prop === "fontsize") groups[groupKey].sizeVar = variable;
    if (prop === "line-height" || prop === "lineheight" || prop === "leading") groups[groupKey].lineHeightVar = variable;
    if (prop === "weight" || prop === "font-weight" || prop === "fontweight") groups[groupKey].weightVar = variable;
    if (prop === "tracking" || prop === "letter-spacing" || prop === "letterspacing") groups[groupKey].trackingVar = variable;
    if (prop === "family" || prop === "font-family" || prop === "fontfamily") groups[groupKey].familyVar = variable;
  }

  return Object.keys(groups).sort().map(key => {
    const group = groups[key];
    group.familyVar = group.familyVar || sharedFamilyVar || null;
    group.sizeValue = group.sizeVar ? resolveVariableValue(group.sizeVar, varsById) : null;
    group.lineHeightValue = group.lineHeightVar ? resolveVariableValue(group.lineHeightVar, varsById) : null;
    group.weightValue = group.weightVar ? resolveVariableValue(group.weightVar, varsById) : null;
    group.trackingValue = group.trackingVar ? resolveVariableValue(group.trackingVar, varsById) : null;
    group.familyValue = group.familyVar ? resolveVariableValue(group.familyVar, varsById) : null;
    return group;
  });
}

function pickTypographyVariableGroup(variables, patterns, options = {}) {
  const groups = Array.isArray(options.groups)
    ? options.groups
    : buildTypographyVariableGroups(variables, options);
  const normalizedPatterns = (patterns || []).map(normalizeName);

  for (const group of groups) {
    const groupName = normalizeName(group.key);
    for (const pattern of normalizedPatterns) {
      if (pattern && (groupName.indexOf(pattern) >= 0 || pattern.indexOf(groupName) >= 0)) return group;
    }
  }

  return null;
}

function pickTypographyBinding({ textStyles = [], variables = [], patterns = [], role = "text", groups } = {}) {
  const style = pickTextStyleLike(textStyles, patterns);
  if (style) return { kind: "style", role, style, warning: null };

  const variableGroup = pickTypographyVariableGroup(variables, patterns, { groups });
  if (variableGroup && (variableGroup.sizeVar || variableGroup.lineHeightVar || variableGroup.weightVar || variableGroup.familyVar)) {
    return { kind: "variables", role, variables: variableGroup, warning: null };
  }

  return {
    kind: "raw",
    role,
    warning: `No typography style or typography variables found for ${role}; using raw text values.`,
  };
}

module.exports = {
  buildTypographyVariableGroups,
  pickTextStyleLike,
  pickFloatVariableByValue,
  pickTypographyBinding,
  pickTypographyVariableGroup,
  resolveVariableValue,
  scoreFloatVariableName,
};
