"use strict";

const CATEGORIES = ["primitive-typography", "primitive-shadow"];

function observedFoundationRequirements(ds, snapshot) {
  const primitiveName = ds.collections && ds.collections.primitives;
  const ids = new Set((snapshot.collections || []).filter(c => c.name === primitiveName).map(c => c.id));
  const prefix = ds.naming && ds.naming.typePrefix || "type";
  const result = {};
  for (const category of CATEGORIES) {
    result[category] = (snapshot.variables || []).filter(v => ids.has(v.variableCollectionId)
      && (category === "primitive-shadow" ? /^shadow\//.test(v.name) : v.name.startsWith(prefix + "/") || /^font\//.test(v.name)))
      .map(v => {
        const values = Object.values(v.valuesByMode || {});
        const value = values[0];
        const hasLiteral = (v.resolvedType === "FLOAT" && Number.isFinite(value) || v.resolvedType === "STRING" && typeof value === "string")
          && values.every(item => item === value);
        return { name: v.name, expectedType: v.resolvedType, collection: primitiveName, ...(hasLiteral ? { value } : {}) };
      });
  }
  return result;
}

function mergeFoundationRequirements(previous = {}, observed = {}) {
  const result = {};
  for (const category of CATEGORIES) {
    const entries = new Map();
    for (const item of [...(previous[category] || []), ...(observed[category] || [])]) entries.set(item.name, item);
    result[category] = Array.from(entries.values());
  }
  return result;
}

function requiredFoundationEntries(ds, snapshot, category, generated) {
  if (!CATEGORIES.includes(category) || !ds.figlets || ds.figlets.source !== "figma-snapshot-bootstrap"
    || ds.figlets.foundationRequirementsApproved === true) return generated;
  const requirements = mergeFoundationRequirements(ds.figlets.foundationRequirements, observedFoundationRequirements(ds, snapshot));
  return requirements[category].map(item => ({ ...item, kind: "variable", category }));
}

function brokenFoundationReferences(ds, snapshot, categories) {
  const variables = snapshot.variables || [];
  const ids = new Set(variables.map(variable => variable.id));
  const prefix = ds.naming && ds.naming.typePrefix || "type";
  const findings = [];
  for (const variable of variables) {
    const category = variable.name.startsWith(prefix + "/") || variable.name.startsWith("font/")
      ? "primitive-typography" : /^(shadow|elevation)\//.test(variable.name) ? "primitive-shadow" : null;
    if (!categories.includes(category)) continue;
    const missing = new Set();
    function visit(value) {
      if (!value || typeof value !== "object") return;
      if (value.type === "VARIABLE_ALIAS" && !ids.has(value.id)) missing.add(value.id);
      else for (const child of Object.values(value)) visit(child);
    }
    visit(variable.valuesByMode);
    for (const targetId of missing) findings.push({ kind: "missing-alias-target", category, token: variable.name,
      targetId, productGap: false, repairReady: false, reason: "A referenced variable is absent from the synced snapshot. Resolve its source before choosing a repair; do not substitute a Figlets default." });
  }
  return findings;
}

module.exports = { observedFoundationRequirements, mergeFoundationRequirements, requiredFoundationEntries, brokenFoundationReferences };
