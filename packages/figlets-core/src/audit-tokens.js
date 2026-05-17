/**
 * audit-tokens.js
 *
 * Analyzes a Figma data snapshot for design token health issues:
 * - Unaliased variables (raw values instead of references to other tokens)
 * - Duplicate values (same raw value defined in multiple variables)
 * - Naming inconsistencies (mixed naming conventions within a collection)
 */

/**
 * Detects whether a variable value is an alias to another variable.
 * Figma represents aliases as: { type: "VARIABLE_ALIAS", id: "VariableID:..." }
 */
function isAlias(value) {
  return value !== null && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}

/**
 * Detects naming convention of a single token name segment.
 */
function detectConvention(name) {
  if (/^\d+(?:_\d+)?$/.test(name)) return "numeric";
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name)) return "path-token";
  if (/^[a-z]+([A-Z][a-z0-9]+)+$/.test(name)) return "camelCase";
  if (/^[A-Z][a-z]+([A-Z][a-z0-9]+)+$/.test(name)) return "PascalCase";
  if (/^[A-Z_]+$/.test(name)) return "SCREAMING_SNAKE";
  return "other";
}

/**
 * Returns the leaf segment of a slash-separated token name.
 * e.g. "color/brand/primary" → "primary"
 */
function leafSegment(name) {
  const parts = name.split("/");
  return parts[parts.length - 1];
}

function parentPath(name) {
  const parts = String(name || "").split("/");
  return parts.slice(0, -1).join("/");
}

function tokenDomain(name) {
  const parts = String(name || "").split("/");
  return parts[0] || "";
}

function isPrimitiveLikeName(name) {
  const value = String(name || "");
  if (/^color\/[^/]+\/\d+$/.test(value)) return true;
  if (/^color\/scrim\//.test(value)) return true;
  if (/^(space|spacing)\/\d+(?:_\d+)?$/.test(value)) return true;
  if (/^(space|spacing)\/(radius|border)\//.test(value)) return true;
  if (/^type\/(size|line-height|tracking|weight)\//.test(value)) return true;
  if (/^type\/[^/]+\/[^/]+\/(line-height|size|tracking|weight)$/.test(value)) return true;
  if (/^font\//.test(value)) return true;
  if (/^shadow\//.test(value)) return true;
  return false;
}

function duplicateSeverity(names) {
  const parents = new Set(names.map(parentPath));
  const domains = new Set(names.map(tokenDomain));
  if (parents.size === 1) return "issue";
  if (domains.size === 1 && !names.every(isPrimitiveLikeName)) return "review";
  return "info";
}

function auditTokens(input = {}) {
  const variables = Array.isArray(input.variables) ? input.variables : [];
  const collections = Array.isArray(input.collections) ? input.collections : [];

  if (variables.length === 0) {
    return {
      error: "No variables found in the data. Run sync_figma_data first."
    };
  }

  // Build a map from variableId → name for alias resolution
  const idToName = {};
  for (const v of variables) {
    idToName[v.id] = v.name;
  }

  // Build a map from collectionId → name
  const collectionNames = {};
  for (const c of collections) {
    collectionNames[c.id] = c.name;
  }

  const unaliased = [];
  const rawPrimitives = [];
  const duplicateValueMap = {}; // "type::serializedValue" → [variableNames]
  const collectionConventions = {}; // collectionId → { convention → count }

  for (const variable of variables) {
    const { id, name, resolvedType, valuesByMode } = variable;

    if (!valuesByMode || typeof valuesByMode !== "object") continue;

    const modeValues = Object.values(valuesByMode);
    const hasAnyAlias = modeValues.some(isAlias);
    const allRaw = modeValues.every(v => !isAlias(v));

    // --- Unaliased check ---
    // A variable is "unaliased" if ALL its mode values are raw (not references).
    // We only flag COLOR and FLOAT types since strings/booleans are usually fine as raw.
    if (allRaw && (resolvedType === "COLOR" || resolvedType === "FLOAT")) {
      const rawValues = {};
      for (const [modeId, val] of Object.entries(valuesByMode)) {
        rawValues[modeId] = val;
      }
      const row = { id, name, type: resolvedType, values: rawValues };
      if (isPrimitiveLikeName(name)) rawPrimitives.push(row);
      else unaliased.push(row);
    }

    // --- Duplicate value check ---
    // Only for variables that have exactly one mode value (common for primitives)
    if (modeValues.length === 1 && !isAlias(modeValues[0])) {
      const key = `${resolvedType}::${JSON.stringify(modeValues[0])}`;
      if (!duplicateValueMap[key]) duplicateValueMap[key] = [];
      duplicateValueMap[key].push(name);
    }

    // --- Naming convention check ---
    // Check the leaf segment of each variable name per collection
    const collectionId = collections.find(c =>
      Array.isArray(c.variableIds) && c.variableIds.includes(id)
    )?.id;

    if (collectionId) {
      const leaf = leafSegment(name);
      const convention = detectConvention(leaf);
      if (convention !== "numeric") {
        if (!collectionConventions[collectionId]) collectionConventions[collectionId] = {};
        collectionConventions[collectionId][convention] = (collectionConventions[collectionId][convention] || 0) + 1;
      }
    }
  }

  // Collapse duplicates: only report groups with more than one variable
  const duplicates = Object.entries(duplicateValueMap)
    .filter(([, names]) => names.length > 1)
    .map(([key, names]) => {
      const [type, serializedValue] = key.split("::");
      const severity = duplicateSeverity(names);
      const reason = severity === "info"
        ? "Same literal value appears across different token domains; usually informational."
        : severity === "review"
        ? "Same literal value appears within one token domain; review if these are intended aliases or distinct decisions."
        : "Same literal value appears in the same token group; likely a real duplicate token.";
      return { type, value: JSON.parse(serializedValue), variables: names, severity, reason };
    })
    .sort((a, b) => {
      const rank = { issue: 0, review: 1, info: 2 };
      return rank[a.severity] - rank[b.severity] || b.variables.length - a.variables.length;
    });
  const duplicateIssues = duplicates.filter(d => d.severity !== "info");
  const informationalDuplicates = duplicates.filter(d => d.severity === "info");

  // Naming inconsistencies: collections that use more than one naming convention
  const namingIssues = [];
  for (const [collectionId, conventions] of Object.entries(collectionConventions)) {
    const usedConventions = Object.keys(conventions);
    const issueConventions = usedConventions.filter(c => c !== "path-token");
    if (issueConventions.length > 0 && usedConventions.length > 1) {
      namingIssues.push({
        collection: collectionNames[collectionId] || collectionId,
        conventions: conventions
      });
    }
  }

  return {
    summary: {
      totalVariables: variables.length,
      unaliasedCount: unaliased.length,
      rawPrimitiveCount: rawPrimitives.length,
      duplicateValueGroups: duplicateIssues.length,
      informationalDuplicateValueGroups: informationalDuplicates.length,
      collectionNamingIssues: namingIssues.length
    },
    unaliased,
    rawPrimitives,
    duplicates,
    informationalDuplicates,
    namingIssues
  };
}

module.exports = { auditTokens };
