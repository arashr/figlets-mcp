"use strict";

const crypto = require("crypto");
const path = require("path");

const SCHEMA_VERSION = 3;
const FIGMA_DOCS_REVIEWED_AT = "2026-07-23";
const PROFILE_KEYS = new Set([
  "productPurpose",
  "productCharacter",
  "density",
  "surfaceStrategy",
  "compositionRules",
  "iconRules",
  "mustDo",
  "mustNot",
  "breakpointWidths",
  "componentPolicies",
  "skippedSuggestions",
]);

function _plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function _stable(value) {
  if (Array.isArray(value)) return value.map(_stable);
  if (!_plainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = _stable(value[key]);
  return output;
}

function stableStringify(value) {
  return JSON.stringify(_stable(value));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function slugify(value, fallback) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback || "design-system";
}

function _cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function _cleanStringArray(value, field, errors) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings.`);
    return undefined;
  }
  const output = [];
  for (const item of value) {
    const clean = _cleanString(item);
    if (!clean) errors.push(`${field} entries must be non-empty strings.`);
    else if (!output.includes(clean)) output.push(clean);
  }
  return output;
}

function _cleanStringMap(value, field, errors, numericValues) {
  if (value === undefined) return undefined;
  if (!_plainObject(value)) {
    errors.push(`${field} must be an object.`);
    return undefined;
  }
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (!key.trim()) {
      errors.push(`${field} keys must be non-empty.`);
      continue;
    }
    const raw = value[key];
    if (numericValues) {
      if (!Number.isFinite(raw) || raw <= 0) errors.push(`${field}.${key} must be a positive number.`);
      else output[key.trim()] = raw;
    } else {
      const clean = _cleanString(raw);
      if (!clean) errors.push(`${field}.${key} must be a non-empty string.`);
      else output[key.trim()] = clean;
    }
  }
  return output;
}

function normalizeProfile(input) {
  const errors = [];
  if (input === undefined || input === null) return { profile: {}, errors };
  if (!_plainObject(input)) return { profile: {}, errors: ["profile must be an object."] };
  for (const key of Object.keys(input)) {
    if (!PROFILE_KEYS.has(key)) errors.push(`Unsupported profile field: ${key}.`);
  }
  const profile = {};
  for (const field of ["productPurpose", "productCharacter", "density", "surfaceStrategy"]) {
    if (input[field] !== undefined) {
      const clean = _cleanString(input[field]);
      if (!clean) errors.push(`${field} must be a non-empty string.`);
      else profile[field] = clean;
    }
  }
  for (const field of ["compositionRules", "iconRules", "mustDo", "mustNot", "skippedSuggestions"]) {
    const clean = _cleanStringArray(input[field], field, errors);
    if (clean !== undefined) profile[field] = clean;
  }
  const widths = _cleanStringMap(input.breakpointWidths, "breakpointWidths", errors, true);
  if (widths !== undefined) profile.breakpointWidths = widths;
  const policies = _cleanStringMap(input.componentPolicies, "componentPolicies", errors, false);
  if (policies !== undefined) profile.componentPolicies = policies;
  return { profile, errors };
}

function _rgbFromHex(hex) {
  const match = String(hex || "").match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
    a: 1,
  };
}

function snapshotFromDsConfig(inputDs) {
  const dsCore = require("./ds-config/index.js");
  let ds = JSON.parse(JSON.stringify(inputDs || {}));
  if (!ds.color || !Array.isArray(ds.color.ramps) || !ds.color.ramps.length || !ds.primitives || !ds.primitives.spacing) {
    ds = dsCore.computeDsConfig(ds).ds;
    if (!ds.color || !Array.isArray(ds.color.ramps) || !ds.color.ramps.length) ds = dsCore.generateColorRamps(ds).ds;
  }
  const primitives = dsCore.generatePrimitivesData(ds);
  const variables = [];
  const collections = [];
  let variableCounter = 0;
  const addCollection = (id, name, modes) => {
    const collection = {
      id,
      name,
      variableIds: [],
      defaultModeId: modes[0].modeId,
      modes,
    };
    collections.push(collection);
    return collection;
  };
  const addVariable = (collection, name, resolvedType, valuesByMode) => {
    const id = `figlets-config-${++variableCounter}`;
    collection.variableIds.push(id);
    variables.push({ id, name, resolvedType, variableCollectionId: collection.id, valuesByMode });
  };
  const singleMode = [{ modeId: "default", name: "Default" }];
  const primitiveCollection = addCollection(
    "figlets-config-primitives",
    (ds.collections && ds.collections.primitives) || primitives.collectionName || "Primitives",
    singleMode
  );
  const primitiveValues = new Map();
  for (const item of primitives.colors || []) {
    const value = _rgbFromHex(item.hex);
    if (!value) continue;
    primitiveValues.set(item.name, value);
    addVariable(primitiveCollection, item.name, "COLOR", { default: value });
  }
  for (const item of primitives.scrims || []) {
    const value = { r: item.r, g: item.g, b: item.b, a: item.a };
    primitiveValues.set(item.name, value);
    addVariable(primitiveCollection, item.name, "COLOR", { default: value });
  }
  for (const item of primitives.floats || []) {
    primitiveValues.set(item.name, item.value);
    addVariable(primitiveCollection, item.name, "FLOAT", { default: item.value });
  }
  for (const item of primitives.strings || []) {
    primitiveValues.set(item.name, item.value);
    addVariable(primitiveCollection, item.name, "STRING", { default: item.value });
  }

  const semanticModes = [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }];
  const semanticCollection = addCollection(
    "figlets-config-color",
    (ds.collections && ds.collections.color) || "Color",
    semanticModes
  );
  const semanticRows = new Map();
  const setSemantic = (name, mode, ref) => {
    if (!name || !ref || !primitiveValues.has(ref)) return;
    if (!semanticRows.has(name)) semanticRows.set(name, {});
    semanticRows.get(name)[mode.toLowerCase()] = primitiveValues.get(ref);
  };
  const semantics = ds.color && ds.color.semantics ? ds.color.semantics : {};
  for (const pair of semantics.pairs || []) {
    for (const mode of ["Light", "Dark"]) {
      if (!pair[mode]) continue;
      setSemantic(pair.bg, mode, pair[mode].bg);
      setSemantic(pair.text, mode, pair[mode].text);
    }
  }
  for (const item of (semantics.icons || []).concat(semantics.unpaired || [])) {
    for (const mode of ["Light", "Dark"]) setSemantic(item.token, mode, item[mode]);
  }
  for (const [name, values] of semanticRows) addVariable(semanticCollection, name, "COLOR", values);

  const breakpointNames = ds.breakpoints && Array.isArray(ds.breakpoints.modes) && ds.breakpoints.modes.length
    ? ds.breakpoints.modes
    : ["Default"];
  const responsiveModes = breakpointNames.map((name, index) => ({ modeId: `mode-${index}`, name }));
  const responsiveValues = values => {
    const list = Array.isArray(values) ? values : [values];
    const output = {};
    responsiveModes.forEach((mode, index) => { output[mode.modeId] = list[index] !== undefined ? list[index] : list[list.length - 1]; });
    return output;
  };
  const spacing = ds.spacing || {};
  const spacingCollection = addCollection(
    "figlets-config-spacing",
    (ds.collections && ds.collections.spacing) || "Spacing",
    responsiveModes
  );
  for (const [name, values] of Object.entries(spacing.semantic || {})) addVariable(spacingCollection, `space/${name}`, "FLOAT", responsiveValues(values));
  for (const [name, value] of Object.entries(spacing.radius || {})) addVariable(spacingCollection, `space/radius/${name}`, "FLOAT", responsiveValues(value));
  for (const [name, value] of Object.entries(spacing.border || {})) addVariable(spacingCollection, `space/border/${name}`, "FLOAT", responsiveValues(value));

  const typography = ds.typography || {};
  const typePrefix = ds.naming && ds.naming.typePrefix ? ds.naming.typePrefix : "type";
  const typographyCollection = addCollection(
    "figlets-config-typography",
    (ds.collections && ds.collections.typography) || "Typography",
    responsiveModes
  );
  for (const [role, definition] of Object.entries(typography.scale || {})) {
    addVariable(typographyCollection, `${typePrefix}/${role}/size`, "FLOAT", responsiveValues(definition.sizes || []));
    addVariable(typographyCollection, `${typePrefix}/${role}/line-height`, "FLOAT", responsiveValues(definition.lineHeights || []));
    addVariable(typographyCollection, `${typePrefix}/${role}/weight`, "FLOAT", responsiveValues(definition.weight || 400));
    addVariable(typographyCollection, `${typePrefix}/${role}/tracking`, "FLOAT", responsiveValues(definition.tracking || 0));
  }
  for (const [name, value] of Object.entries(typography.families || {})) addVariable(typographyCollection, `font/${name}`, "STRING", responsiveValues(value));

  return {
    fileName: ds.project && ds.project.name ? ds.project.name : "Design system",
    source: "figlets-config-derived",
    collections: collections.filter(collection => collection.variableIds.length),
    variables,
    textStyles: [],
    effectStyles: [],
    paintStyles: [],
    components: [],
  };
}

function _collectionIndex(figmaData) {
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const byId = new Map();
  const variableToCollection = new Map();
  for (const collection of collections) {
    byId.set(collection.id, collection);
    for (const variableId of collection.variableIds || []) variableToCollection.set(variableId, collection);
  }
  return { collections, byId, variableToCollection };
}

function _modeName(collection, modeId) {
  const mode = (collection && collection.modes || []).find(item => item.modeId === modeId);
  return mode ? mode.name : modeId;
}

function _targetModeId(variable, desiredModeName, collectionIndex) {
  const collection = collectionIndex.byId.get(variable.variableCollectionId)
    || collectionIndex.variableToCollection.get(variable.id);
  const modes = collection && Array.isArray(collection.modes) ? collection.modes : [];
  const sameName = modes.find(mode => String(mode.name).toLowerCase() === String(desiredModeName).toLowerCase());
  if (sameName && Object.prototype.hasOwnProperty.call(variable.valuesByMode || {}, sameName.modeId)) return sameName.modeId;
  return Object.keys(variable.valuesByMode || {})[0];
}

function _resolveValue(variable, modeId, modeName, variablesById, collectionIndex, seen) {
  if (!variable || !modeId) return undefined;
  const marker = `${variable.id}:${modeId}`;
  if (seen.has(marker)) return undefined;
  seen.add(marker);
  const values = variable.valuesByMode || {};
  const value = Object.prototype.hasOwnProperty.call(values, modeId)
    ? values[modeId]
    : values[Object.keys(values)[0]];
  if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
    const target = variablesById.get(value.id);
    const targetModeId = target ? _targetModeId(target, modeName, collectionIndex) : null;
    return _resolveValue(target, targetModeId, modeName, variablesById, collectionIndex, seen);
  }
  return value;
}

function _hexByte(value) {
  const normalized = Math.max(0, Math.min(1, Number(value)));
  return Math.round(normalized * 255).toString(16).padStart(2, "0").toUpperCase();
}

function _cssValue(value, resolvedType) {
  if (value === undefined || value === null) return null;
  if (resolvedType === "COLOR" && _plainObject(value) && value.r !== undefined && value.g !== undefined && value.b !== undefined) {
    const alpha = value.a === undefined ? 1 : Number(value.a);
    if (alpha >= 0.999) return `#${_hexByte(value.r)}${_hexByte(value.g)}${_hexByte(value.b)}`;
    return `rgba(${Math.round(value.r * 255)}, ${Math.round(value.g * 255)}, ${Math.round(value.b * 255)}, ${Math.round(alpha * 1000) / 1000})`;
  }
  if (resolvedType === "FLOAT" && Number.isFinite(value)) return String(value);
  if (resolvedType === "BOOLEAN" && typeof value === "boolean") return value ? "true" : "false";
  if (resolvedType === "STRING" && typeof value === "string") return JSON.stringify(value);
  return null;
}

function _webCustomProperty(variable) {
  const web = variable && variable.codeSyntax && typeof variable.codeSyntax.WEB === "string"
    ? variable.codeSyntax.WEB.trim()
    : "";
  const match = web.match(/^var\(\s*(--[A-Za-z_][A-Za-z0-9_-]*)\s*(?:,[^)]+)?\)$/);
  if (match) return match[1];
  if (/^--[A-Za-z_][A-Za-z0-9_-]*$/.test(web)) return web;
  return null;
}

function _fallbackCustomProperty(name) {
  const normalized = String(name || "token")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return `--${normalized || "token"}`;
}

function _assignCssNames(variables) {
  const used = new Map();
  const rows = [];
  for (const variable of variables) {
    const preferred = _webCustomProperty(variable);
    let cssName = preferred || _fallbackCustomProperty(variable.name);
    const existing = used.get(cssName);
    let collisionRepaired = false;
    if (existing) {
      cssName += `-${fingerprint(`${variable.id}:${variable.name}`).slice(0, 6)}`;
      collisionRepaired = true;
    }
    used.set(cssName, variable.id);
    rows.push({
      variableId: variable.id,
      variableName: variable.name,
      cssName,
      source: preferred ? "codeSyntax.WEB" : "figlets-path-fallback",
      collisionRepaired,
    });
  }
  return rows;
}

function serializeStylesheet(figmaData, librarySlug) {
  figmaData = figmaData || {};
  const collectionIndex = _collectionIndex(figmaData);
  const variables = (Array.isArray(figmaData.variables) ? figmaData.variables : [])
    .filter(variable => variable && !variable.hiddenFromPublishing && ["COLOR", "FLOAT", "STRING", "BOOLEAN"].includes(variable.resolvedType))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const variablesById = new Map((Array.isArray(figmaData.variables) ? figmaData.variables : [])
    .filter(variable => variable && variable.id)
    .map(variable => [variable.id, variable]));
  const nameMap = _assignCssNames(variables);
  const cssNameById = new Map(nameMap.map(row => [row.variableId, row.cssName]));
  const base = [];
  const alternate = new Map();
  const omitted = [];

  for (const variable of variables) {
    const collection = collectionIndex.byId.get(variable.variableCollectionId)
      || collectionIndex.variableToCollection.get(variable.id)
      || { modes: Object.keys(variable.valuesByMode || {}).map(modeId => ({ modeId, name: modeId })) };
    const collectionModes = (collection.modes || []).slice();
    if (collection.defaultModeId) {
      collectionModes.sort((a, b) => (a.modeId === collection.defaultModeId ? -1 : b.modeId === collection.defaultModeId ? 1 : 0));
    }
    const modes = collectionModes.filter(mode => Object.prototype.hasOwnProperty.call(variable.valuesByMode || {}, mode.modeId));
    const effectiveModes = modes.length ? modes : Object.keys(variable.valuesByMode || {}).map(modeId => ({ modeId, name: modeId }));
    for (let index = 0; index < effectiveModes.length; index += 1) {
      const mode = effectiveModes[index];
      const resolved = _resolveValue(variable, mode.modeId, mode.name, variablesById, collectionIndex, new Set());
      const cssValue = _cssValue(resolved, variable.resolvedType);
      if (cssValue === null) {
        omitted.push({ variableName: variable.name, mode: mode.name, reason: "unsupported-or-unresolved-value" });
        continue;
      }
      const row = `  ${cssNameById.get(variable.id)}: ${cssValue};`;
      if (index === 0) base.push(row);
      else {
        const modeSlug = slugify(mode.name, mode.modeId);
        if (!alternate.has(modeSlug)) alternate.set(modeSlug, { name: mode.name, rows: [] });
        alternate.get(modeSlug).rows.push(row);
      }
    }
  }

  const lines = [
    "/* Generated by Figlets. Refresh through Figlets after reviewing the export preview. */",
    `/* Source library: ${librarySlug} */`,
    "",
    ":root {",
    ...base,
    "}",
  ];
  for (const [modeSlug, group] of [...alternate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push("", `/* Figma mode: ${group.name} */`, `[data-figma-mode="${modeSlug}"] {`, ...group.rows, "}");
  }
  lines.push("");
  return {
    css: lines.join("\n"),
    nameMap,
    omitted,
    variableCount: variables.length,
    declarationCount: base.length + [...alternate.values()].reduce((sum, group) => sum + group.rows.length, 0),
    modes: [...alternate.keys()],
  };
}

function _extractMarkdownSection(markdown, heading) {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    if (lines[index].trim() === "---") continue;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

function _componentSpecSummary(spec) {
  if (!spec || typeof spec.content !== "string") return null;
  const descriptionMatch = spec.content.match(/^>\s+(.+)$/m);
  const sections = [
    "Variants",
    "Variable Modes",
    "Component Properties",
    "Boolean Property Behavior",
    "Conditional Layers",
    "Slots",
    "Token Bindings",
    "Sizing",
    "Layout",
    "Anatomy",
    "Usage Rules",
    "Accessibility",
  ]
    .map(heading => ({ heading, body: _extractMarkdownSection(spec.content, heading) }))
    .filter(section => section.body);
  const description = descriptionMatch ? descriptionMatch[1].trim() : "";
  return {
    path: spec.path || null,
    description: /^_?\[add\b/i.test(description) ? "" : description,
    sections,
  };
}

function _components(figmaData, componentSpecs) {
  const specs = (Array.isArray(componentSpecs) ? componentSpecs : [])
    .filter(spec => spec && typeof spec.name === "string")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const specsByName = new Map(specs.map(spec => [spec.name, spec]));
  const rows = (Array.isArray(figmaData.components) ? figmaData.components : [])
    .filter(component => component && (component.type === "COMPONENT_SET" || !component.parentSetId))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const figmaNames = new Set(rows.map(component => component.name));
  const components = rows.map(component => {
    const spec = _componentSpecSummary(specsByName.get(component.name));
    return {
      id: component.id,
      name: component.name,
      type: component.type,
      description: (spec && spec.description) || _cleanString(component.description) || "",
      properties: Object.keys(component.componentPropertyDefinitions || {}).sort(),
      spec,
      source: spec ? "figma+component-spec" : "figma",
    };
  });
  for (const sourceSpec of specs) {
    if (figmaNames.has(sourceSpec.name)) continue;
    const spec = _componentSpecSummary(sourceSpec);
    if (!spec) continue;
    components.push({
      id: `component-spec:${sourceSpec.path || sourceSpec.name}`,
      name: sourceSpec.name,
      type: "COMPONENT_SPEC",
      description: spec.description || "",
      properties: [],
      spec,
      source: "component-spec",
    });
  }
  return components.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function _modeNames(figmaData) {
  const names = [];
  for (const collection of Array.isArray(figmaData.collections) ? figmaData.collections : []) {
    for (const mode of collection.modes || []) if (mode.name && !names.includes(mode.name)) names.push(mode.name);
  }
  return names;
}

function _variableFacts(figmaData, nameMap) {
  const cssById = new Map(nameMap.map(row => [row.variableId, row]));
  return (Array.isArray(figmaData.variables) ? figmaData.variables : [])
    .filter(variable => variable && cssById.has(variable.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(variable => ({
      id: variable.id,
      name: variable.name,
      type: variable.resolvedType,
      description: _cleanString(variable.description) || "",
      scopes: Array.isArray(variable.scopes) ? variable.scopes.slice() : [],
      cssName: cssById.get(variable.id).cssName,
      cssNameSource: cssById.get(variable.id).source,
      modes: Object.keys(variable.valuesByMode || {}),
    }));
}

function buildMakeGuidelinesModel(input) {
  input = input || {};
  const figmaData = input.figmaData || {};
  const ds = input.ds || {};
  const normalized = normalizeProfile(input.profile);
  if (normalized.errors.length) throw new Error(normalized.errors.join(" "));
  const profile = normalized.profile;
  const designSystemName = _cleanString(ds.project && ds.project.name)
    || _cleanString(figmaData.fileName)
    || "Design system";
  const librarySlug = slugify(designSystemName, "design-system");
  const stylesheet = serializeStylesheet(figmaData, librarySlug);
  const variables = _variableFacts(figmaData, stylesheet.nameMap);
  const components = _components(figmaData, input.componentSpecs);
  const modes = _modeNames(figmaData);
  const colorVariables = variables.filter(item => item.type === "COLOR");
  const typographyVariables = variables.filter(item => /(^|\/)(type|font|typography)(\/|$)/i.test(item.name));
  const spacingVariables = variables.filter(item => /(^|\/)(space|spacing|radius|border)(\/|$)/i.test(item.name));
  const elevationVariables = variables.filter(item => /(^|\/)(shadow|elevation)(\/|$)/i.test(item.name));
  const semanticColors = colorVariables.filter(item => /(^|\/)(bg|background|surface|text|icon|border|outline|semantic)(\/|$)/i.test(item.name));
  const rules = [];
  const provenance = [];
  const addRule = (rule, kind, evidence) => {
    rules.push(rule);
    provenance.push({ target: `rule:${rules.length - 1}`, kind, evidence });
  };
  if (semanticColors.length) addRule(
    "Prefer semantic color variables over primitive palette variables whenever a semantic role fits.",
    "observed",
    semanticColors.map(item => item.name)
  );
  if (spacingVariables.length) addRule(
    "Use the available spacing, radius, and border variables instead of hardcoded numeric values.",
    "observed",
    spacingVariables.map(item => item.name)
  );
  if (typographyVariables.length || (figmaData.textStyles || []).length) addRule(
    "Use complete typography roles or styles instead of independently improvising font properties.",
    "observed",
    typographyVariables.map(item => item.name).concat((figmaData.textStyles || []).map(item => item.name))
  );
  for (const rule of profile.mustDo || []) addRule(rule, "designer-confirmed", ["make-guidelines.config.json:mustDo"]);
  const prohibitions = (profile.mustNot || []).slice();
  prohibitions.forEach((rule, index) => provenance.push({
    target: `prohibition:${index}`,
    kind: "designer-confirmed",
    evidence: ["make-guidelines.config.json:mustNot"],
  }));
  for (const component of components.filter(item => item.spec)) {
    provenance.push({
      target: `component:${component.name}`,
      kind: "config-confirmed",
      evidence: [component.spec.path],
    });
  }
  const suggestions = [];
  const skippedSuggestions = new Set(profile.skippedSuggestions || []);
  const canSuggest = id => !skippedSuggestions.has("all") && !skippedSuggestions.has(id);
  if (!profile.productCharacter && canSuggest("product-character")) suggestions.push({
    id: "product-character",
    field: "productCharacter",
    message: "Optional: add a short product-character rule so Make can choose between otherwise valid visual directions.",
    proposedValue: spacingVariables.length > 20
      ? "Use the established token scale consistently and avoid introducing a second visual language."
      : "Keep new work visually consistent with the existing colors, typography, spacing, and corner treatment.",
    evidence: [`${variables.length} exported variables`, `${components.length} cataloged components`],
  });
  if (!(profile.compositionRules || []).length && canSuggest("composition")) suggestions.push({
    id: "composition",
    field: "compositionRules",
    message: "Optional: add page-composition rules if this design system has a preferred shell, surface hierarchy, or content grouping pattern.",
    proposedValue: "Group related content consistently and use existing surface roles to express hierarchy.",
    evidence: [`${semanticColors.length} semantic color variables`],
  });
  const componentsWithoutSpecs = components.filter(component => !component.spec);
  if (componentsWithoutSpecs.length && !Object.keys(profile.componentPolicies || {}).length && canSuggest("component-usage")) suggestions.push({
    id: "component-usage",
    field: "componentPolicies",
    message: "Optional: enrich exact components with usage guidance when existing documentation is available.",
    proposedValue: "Catalog components from Figma now; add prescriptive usage only from confirmed component documentation.",
    evidence: [`${componentsWithoutSpecs.length} Figma components or component sets without component specs`],
  });
  if (modes.length > 1 && !Object.keys(profile.breakpointWidths || {}).length && canSuggest("mode-widths")) suggestions.push({
    id: "mode-widths",
    field: "breakpointWidths",
    message: "Optional: add pixel widths only if these named modes represent responsive breakpoints.",
    proposedValue: `Observed modes: ${modes.join(", ")}.`,
    evidence: modes.slice(),
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    docsReviewedAt: FIGMA_DOCS_REVIEWED_AT,
    source: Object.assign({}, input.source || {}),
    designSystem: { name: designSystemName, librarySlug },
    profile,
    foundations: {
      variables,
      colorVariables,
      semanticColors,
      typographyVariables,
      spacingVariables,
      elevationVariables,
      textStyles: Array.isArray(figmaData.textStyles) ? figmaData.textStyles : [],
      effectStyles: Array.isArray(figmaData.effectStyles) ? figmaData.effectStyles : [],
      paintStyles: Array.isArray(figmaData.paintStyles) ? figmaData.paintStyles : [],
      modes,
    },
    components,
    composition: { rules: profile.compositionRules || [] },
    styleContext: {
      status: stylesheet.declarationCount ? "figlets-generated" : "unavailable",
      generator: "figlets",
      librarySlug,
      stylesheetPath: `src/${librarySlug}/styles.css`,
      nameSourcePriority: ["codeSyntax.WEB", "figlets-path-fallback"],
      nameMap: stylesheet.nameMap,
      omitted: stylesheet.omitted,
      modes: stylesheet.modes,
      css: stylesheet.css,
      variableCount: stylesheet.variableCount,
      declarationCount: stylesheet.declarationCount,
    },
    rules,
    prohibitions,
    provenance,
    blockingGaps: [],
    suggestions,
    warnings: stylesheet.omitted.length
      ? [`${stylesheet.omitted.length} variable mode values could not be serialized to CSS.`]
      : [],
  };
}

function _mdTable(headers, rows) {
  if (!rows.length) return "";
  const escape = value => String(value == null ? "" : value).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(row => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

function _lines(title, body) {
  return ["<!-- Generated by Figlets. Refresh through Figlets. -->", "", `# ${title}`, "", ...body.filter(value => value !== null && value !== undefined && value !== ""), ""].join("\n");
}

function renderMakeGuidelinesBundle(model) {
  const manifest = [];
  const add = (filePath, content) => manifest.push({ path: filePath, content });
  const name = model.designSystem.name;
  const slug = model.designSystem.librarySlug;
  const profile = model.profile;
  const f = model.foundations;
  const routing = [
    "Read `setup.md` before generating code so the Figlets stylesheet is loaded.",
    "Read `styles.md` before using CSS variables.",
    "Read `tokens.md` and the relevant file under `foundations/` before choosing visual values.",
  ];
  if (model.components.length) {
    routing.push("Read [components.md](./components.md) before choosing a Figma component. It routes to the catalog and every available component-specific guideline.");
  }
  if (model.composition.rules.length) routing.push("Read `composition/overview.md` before composing page-level layouts.");
  const intro = [
    `These files translate the confirmed ${name} design-system information exported by Figlets into guidance for Figma Make.`,
    profile.productPurpose ? `Product purpose: ${profile.productPurpose}` : null,
    profile.productCharacter ? `Product character: ${profile.productCharacter}` : null,
    profile.density ? `Density: ${profile.density}` : null,
    profile.surfaceStrategy ? `Surface strategy: ${profile.surfaceStrategy}` : null,
    "## Reading workflow",
    ...routing.map(item => `- ${item}`),
    "## Confirmed rules",
    ...(model.rules.length ? model.rules.map(rule => `- ${rule}`) : ["- Use only the documented design-system facts and stylesheet variables."]),
    ...(model.prohibitions.length ? ["## Prohibitions", ...model.prohibitions.map(rule => `- ${rule}`)] : []),
    "## Known gaps",
    "- Component names and properties are cataloged from Figma, but component usage policy is included only when confirmed documentation exists.",
    "- Named Figma modes do not imply pixel breakpoints unless widths are explicitly recorded.",
  ];
  add("guidelines/Guidelines.md", _lines(`${name} — Figma Make Guidelines`, intro));

  if (model.styleContext.status === "figlets-generated") {
    add("guidelines/setup.md", _lines("Style setup", [
      `Load \`../src/${slug}/styles.css\` globally before applying ${name} variables.`,
      "Do not replace the generated stylesheet with guessed token values.",
      "Apply alternate Figma modes by setting `data-figma-mode` to the documented mode slug on an ancestor element.",
      "This is a local Figlets stylesheet; no npm package or provider is required.",
    ]));
    const fallbackRows = model.styleContext.nameMap.filter(row => row.source !== "codeSyntax.WEB");
    add("guidelines/styles.md", _lines("Stylesheet usage", [
      `The global stylesheet is \`../src/${slug}/styles.css\`.`,
      "Numeric Figma variables are emitted as raw numbers. For CSS dimensions, use `calc(var(--token) * 1px)` unless the consuming property is unitless.",
      "Color values are emitted as valid hex or rgba values. String values are quoted. Boolean values are `true` or `false`.",
      "Prefer the exact CSS custom-property names in the stylesheet. Figlets uses valid Figma Web code syntax first and a deterministic path-based fallback otherwise.",
      fallbackRows.length ? "## Fallback CSS names" : null,
      fallbackRows.length ? _mdTable(["Figma variable", "CSS property"], fallbackRows.map(row => [row.variableName, row.cssName])) : null,
    ]));
    add(`src/${slug}/guidelines/Guidelines.md`, _lines(`${name} library styles`, [
      `Use the sibling \`../styles.css\` file as the source of ${name} CSS variables.`,
      "Read the root `guidelines/Guidelines.md`, `guidelines/styles.md`, and `guidelines/tokens.md` files for selection and usage rules.",
      model.components.length
        ? "Read the root [`guidelines/components.md`](../../../guidelines/components.md) before using a Figma component."
        : null,
      "Do not invent CSS variable names that are not present in `styles.css`.",
    ]));
    add(`src/${slug}/styles.css`, model.styleContext.css);
  }

  add("guidelines/tokens.md", _lines("Token selection", [
    "Choose tokens by design intent. Prefer semantic roles when available, then use primitive values only when no semantic role fits.",
    `The stylesheet contains ${f.variables.length} exported variables. This file does not repeat the full catalog; use the focused foundation files for decisions and the generated stylesheet for the exact complete custom-property inventory.`,
    f.semanticColors.length ? "## Semantic color entrypoints" : null,
    f.semanticColors.length ? _mdTable(["Figma variable", "CSS property", "Description"], f.semanticColors.map(item => [item.name, item.cssName, item.description])) : null,
    "## Decision routes",
    f.colorVariables.length ? "- Read `foundations/color.md` for surfaces, foregrounds, borders, icons, and status color roles." : null,
    (f.typographyVariables.length || f.textStyles.length) ? "- Read `foundations/typography.md` before choosing type values." : null,
    f.spacingVariables.length ? "- Read `foundations/spacing-and-layout.md` before choosing spacing, radius, or border values." : null,
    f.elevationVariables.length ? "- Read `foundations/elevation.md` before choosing elevation." : null,
  ]));
  add("guidelines/foundations/overview.md", _lines("Foundations", [
    `Available facts: ${f.colorVariables.length} color variables, ${f.typographyVariables.length} typography variables, ${f.spacingVariables.length} spacing/layout variables, ${f.elevationVariables.length} elevation variables.`,
    "Read the focused file for the decision you are making instead of scanning the stylesheet alphabetically.",
  ]));
  if (f.colorVariables.length) add("guidelines/foundations/color.md", _lines("Color", [
    f.semanticColors.length ? "Prefer semantic colors for surfaces, text, icons, borders, and status meanings." : "Only confirmed color variables are listed; no semantic usage is inferred from raw values.",
    _mdTable(["Figma variable", "CSS property", "Description"], f.colorVariables.map(item => [item.name, item.cssName, item.description])),
  ]));
  if (f.typographyVariables.length || f.textStyles.length) add("guidelines/foundations/typography.md", _lines("Typography", [
    "Use complete typography roles or styles. Do not improvise one font property when a documented role covers the text.",
    f.typographyVariables.length ? _mdTable(["Variable", "CSS property", "Description"], f.typographyVariables.map(item => [item.name, item.cssName, item.description])) : null,
    f.textStyles.length ? "## Figma text styles" : null,
    f.textStyles.length ? _mdTable(["Style", "Description"], f.textStyles.map(style => [style.name, style.description || ""])) : null,
  ]));
  if (f.spacingVariables.length) add("guidelines/foundations/spacing-and-layout.md", _lines("Spacing and layout", [
    "Use confirmed spacing, radius, and border variables instead of hardcoded values.",
    "Numeric variables are unitless in the generated stylesheet; multiply dimensions by `1px` with `calc()`.",
    _mdTable(["Figma variable", "CSS property", "Description"], f.spacingVariables.map(item => [item.name, item.cssName, item.description])),
  ]));
  if (f.modes.length) add("guidelines/foundations/modes.md", _lines("Modes", [
    `Observed Figma mode names: ${f.modes.join(", ")}.`,
    "Use the default values from `:root`. Apply an alternate stylesheet mode with the corresponding `data-figma-mode` slug.",
    Object.keys(profile.breakpointWidths || {}).length
      ? _mdTable(["Mode", "Minimum width"], Object.entries(profile.breakpointWidths).map(([mode, width]) => [mode, `${width}px`]))
      : "Do not infer responsive pixel thresholds from mode names.",
  ]));
  if (f.elevationVariables.length || f.effectStyles.length) add("guidelines/foundations/elevation.md", _lines("Elevation", [
    "Use complete documented shadow/effect compositions. Do not combine partial shadow values without a confirmed composition.",
    f.elevationVariables.length ? _mdTable(["Variable", "CSS property"], f.elevationVariables.map(item => [item.name, item.cssName])) : null,
    f.effectStyles.length ? _mdTable(["Figma effect style", "Description"], f.effectStyles.map(style => [style.name, style.description || ""])) : null,
  ]));
  if (model.components.length) {
    const documentedComponents = model.components.filter(component => component.spec);
    const factsOnlyComponents = model.components.filter(component => !component.spec);
    add("guidelines/components.md", _lines("Components", [
      "Use this file as the entrypoint for component guidance.",
      "Read the [complete component catalog](./components/overview.md) to inspect exact Figma names, types, properties, and descriptions.",
      documentedComponents.length
        ? "Before using a documented component, read its specific guideline below. These files contain the available component rules and specs; do not rely on the catalog alone."
        : "No component-specific usage specs are available. Use the catalog only for exact Figma facts and do not invent component policy.",
      documentedComponents.length ? "## Component-specific guidelines" : null,
      documentedComponents.length
        ? _mdTable(["Component", "Guideline"], documentedComponents.map(component => [
          component.name,
          `[Read ${component.name} guideline](./components/${slugify(component.name, "component")}.md)`,
        ]))
        : null,
      factsOnlyComponents.length ? "## Components without usage specs" : null,
      factsOnlyComponents.length
        ? `${factsOnlyComponents.map(component => `\`${component.name}\``).join(", ")} are cataloged from Figma, but they have no confirmed component-specific usage guideline.`
        : null,
    ]));
    add("guidelines/components/overview.md", _lines("Component catalog", [
      "The following combines exact Figma component facts with confirmed project component specs. A Figma name or property alone does not establish usage policy.",
      "Return to the [component guidance entrypoint](../components.md) before using a documented component.",
      _mdTable(["Component", "Source", "Type", "Properties", "Documentation", "Description"], model.components.map(component => [
        component.name,
        component.source === "figma+component-spec"
          ? "Figma + component spec"
          : (component.source === "component-spec" ? "Component spec" : "Figma"),
        component.type,
        component.properties.join(", "),
        component.spec ? `[Read guideline](./${slugify(component.name, "component")}.md)` : "Figma facts only",
        (profile.componentPolicies || {})[component.name] || component.description,
      ])),
    ]));
  }
  for (const component of model.components.filter(item => item.spec)) {
    const policy = (profile.componentPolicies || {})[component.name];
    const body = [
      `This file is derived from the exact Figlets component spec at \`${component.spec.path}\`.`,
      component.description ? `> ${component.description}` : null,
      policy ? "## Designer-confirmed policy" : null,
      policy || null,
    ];
    for (const section of component.spec.sections) {
      body.push(`## ${section.heading}`, section.body);
    }
    add(`guidelines/components/${slugify(component.name, "component")}.md`, _lines(component.name, body));
  }
  if (model.composition.rules.length) add("guidelines/composition/overview.md", _lines("Composition", model.composition.rules.map(rule => `- ${rule}`)));

  return manifest.sort((a, b) => a.path.localeCompare(b.path));
}

function lintMakeGuidelinesBundle(manifest) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  for (const file of Array.isArray(manifest) ? manifest : []) {
    if (!file || typeof file.path !== "string" || !file.path.trim()) {
      errors.push("Every manifest item must have a relative path.");
      continue;
    }
    if (file.path.startsWith("/") || file.path.split("/").includes("..")) errors.push(`Unsafe manifest path: ${file.path}`);
    if (/^(package\.json|vite\.config\.|postcss\.config\.)/.test(file.path) || /node_modules/.test(file.path)) {
      errors.push(`Package or build scaffolding is outside the Make guidelines bundle: ${file.path}`);
    }
    if (seen.has(file.path)) errors.push(`Duplicate manifest path: ${file.path}`);
    seen.add(file.path);
    if (typeof file.content !== "string" || !file.content.trim()) errors.push(`Empty generated file: ${file.path}`);
    if (typeof file.content === "string" && /\b(undefined|null)\b/.test(file.content)) warnings.push(`Review literal placeholder-like text in ${file.path}.`);
  }
  if (!seen.has("guidelines/Guidelines.md")) errors.push("Missing top-level guidelines/Guidelines.md.");
  const rootGuidelines = (manifest || []).find(file => file.path === "guidelines/Guidelines.md");
  const componentIndex = (manifest || []).find(file => file.path === "guidelines/components.md");
  const componentOverview = (manifest || []).find(file => file.path === "guidelines/components/overview.md");
  const componentGuidelines = (manifest || []).filter(file => (
    /^guidelines\/components\/[^/]+\.md$/.test(file.path)
    && file.path !== "guidelines/components/overview.md"
  ));
  if ((componentOverview || componentGuidelines.length) && !componentIndex) {
    errors.push("Missing guidelines/components.md component entrypoint.");
  }
  if (componentIndex && !componentOverview) {
    errors.push("guidelines/components.md exists without guidelines/components/overview.md.");
  }
  if (
    componentIndex
    && (!rootGuidelines || !rootGuidelines.content.includes("(./components.md)"))
  ) {
    errors.push("Top-level guidelines/Guidelines.md does not route to guidelines/components.md.");
  }
  if (componentIndex) {
    for (const componentGuideline of componentGuidelines) {
      const route = `./components/${path.posix.basename(componentGuideline.path)}`;
      if (!componentIndex.content.includes(`(${route})`)) {
        errors.push(`guidelines/components.md does not route to ${componentGuideline.path}.`);
      }
    }
  }
  for (const file of manifest || []) {
    if (!file.path.endsWith(".md") || typeof file.content !== "string") continue;
    const links = [...file.content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
    for (const link of links) {
      if (/^[a-z]+:|^#/.test(link)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), link));
      if (resolved.startsWith("../") || !seen.has(resolved)) errors.push(`Broken internal link in ${file.path}: ${link}`);
    }
  }
  const setup = (manifest || []).find(file => file.path === "guidelines/setup.md");
  const stylesheet = (manifest || []).find(file => /\/styles\.css$/.test(file.path));
  if (setup && !stylesheet) errors.push("guidelines/setup.md exists without a generated styles.css.");
  if (stylesheet) {
    let balance = 0;
    for (const char of stylesheet.content) {
      if (char === "{") balance += 1;
      if (char === "}") balance -= 1;
      if (balance < 0) break;
    }
    if (balance !== 0) errors.push("Generated styles.css has unbalanced braces.");
    if (!/:root\s*\{/.test(stylesheet.content)) errors.push("Generated styles.css is missing a :root block.");
    const blocks = stylesheet.content.match(/[^{}]+\{[^{}]*\}/g) || [];
    for (const block of blocks) {
      const declarations = [...block.matchAll(/(^|\n)\s*(--[A-Za-z_][A-Za-z0-9_-]*)\s*:/g)].map(match => match[2]);
      const duplicates = declarations.filter((name, index) => declarations.indexOf(name) !== index);
      if (duplicates.length) errors.push(`Generated styles.css repeats custom properties in one selector: ${[...new Set(duplicates)].join(", ")}.`);
    }
  } else {
    warnings.push("No styles.css was generated; the Markdown guidelines remain usable.");
  }
  return { valid: errors.length === 0, errors, warnings };
}

function prepareMakeGuidelinesCore(input) {
  const model = buildMakeGuidelinesModel(input);
  const manifest = renderMakeGuidelinesBundle(model);
  const lint = lintMakeGuidelinesBundle(manifest);
  return { model, manifest, lint };
}

module.exports = {
  SCHEMA_VERSION,
  FIGMA_DOCS_REVIEWED_AT,
  normalizeProfile,
  snapshotFromDsConfig,
  serializeStylesheet,
  buildMakeGuidelinesModel,
  renderMakeGuidelinesBundle,
  lintMakeGuidelinesBundle,
  prepareMakeGuidelinesCore,
  stableStringify,
  fingerprint,
  slugify,
};
