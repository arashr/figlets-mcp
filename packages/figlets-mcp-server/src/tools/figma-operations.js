const { bridgeStatusError, requestBridgePost } = require("../bridges/bridge-request.js");
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");

const VARIABLE_TYPES = new Set(["COLOR", "FLOAT", "STRING", "BOOLEAN"]);
const OP_KINDS = new Set([
  "create_collection",
  "rename_collection",
  "delete_collection",
  "create_mode",
  "rename_mode",
  "delete_mode",
  "create_variable",
  "update_variable",
  "rename_variable",
  "delete_variable",
  "update_variable_metadata",
  "create_text_style",
  "update_text_style",
  "rename_text_style",
  "delete_text_style",
  "create_effect_style",
  "update_effect_style",
  "rename_effect_style",
  "delete_effect_style",
  "bind_node_variable",
  "unbind_node_variable",
  "bind_node_paint_variable",
  "unbind_node_paint_variable",
  "bind_node_text_style",
  "unbind_node_text_style",
  "bind_node_effect_style",
  "unbind_node_effect_style",
  "update_collection_metadata",
  "duplicate_variable",
  "move_variable",
  "deprecate_variable",
  "retarget_variable_aliases",
]);

const planDsFigmaOperationsTool = {
  name: "plan_ds_figma_operations",
  description:
    "Read-only planner for exact high-level Figma design-system operations: create/update/rename/delete variables, collections, modes, local styles, exact node bindings, metadata, and token lifecycle helpers. Validates against the synced snapshot and returns an exact approved-apply payload. Never mutates Figma.",
  inputSchema: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        description: "Exact operations requested by the designer. Each operation has a kind and the names/values needed for that kind.",
        items: { type: "object" }
      },
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      }
    },
    required: ["operations"],
    additionalProperties: false
  }
};

const applyDsFigmaOperationsTool = {
  name: "apply_ds_figma_operations",
  description:
    "Apply designer-approved high-level Figma design-system operations copied from plan_ds_figma_operations.repairPlan.applyInput. Rejects stale or invented payloads before the bridge. Requires explicit planned operations; never accepts arbitrary scripts.",
  inputSchema: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        items: { type: "object" }
      },
      figmaDataPath: {
        type: "string",
        description: "Optional snapshot path used for stale approval validation before apply."
      }
    },
    required: ["operations"],
    additionalProperties: false
  }
};

function _loadDataSource(input = {}) {
  return input.figmaDataPath
    ? loadFigmaDataSource({ figmaDataPath: input.figmaDataPath })
    : (loadActiveFigmaDataSource(input) || loadFigmaDataSource(input));
}

function _norm(value) {
  return String(value == null ? "" : value).toLowerCase();
}

function _modeName(mode) {
  return mode ? (mode.name || mode.modeId) : "";
}

function _valueSignature(value) {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (value.type === "VARIABLE_ALIAS") return `alias:${value.id}`;
  const keys = Object.keys(value).sort();
  const out = {};
  for (const key of keys) out[key] = value[key];
  return JSON.stringify(out);
}

function _stableJson(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map(_stableJson).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${_stableJson(value[key])}`).join(",")}}`;
}

function _parseHexColor(value) {
  const raw = String(value || "").trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!match) return null;
  const hex = match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}

function _normalizeLiteral(type, value) {
  if (type === "FLOAT") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "BOOLEAN") {
    if (value === true || value === false) return value;
    if (_norm(value) === "true") return true;
    if (_norm(value) === "false") return false;
    return null;
  }
  if (type === "STRING") {
    if (value == null || typeof value === "object") return null;
    return String(value);
  }
  if (type === "COLOR") {
    if (value && typeof value === "object" && ["r", "g", "b"].every(k => Number.isFinite(Number(value[k])))) {
      const out = { r: Number(value.r), g: Number(value.g), b: Number(value.b) };
      if (Number.isFinite(Number(value.a))) out.a = Number(value.a);
      return out;
    }
    return _parseHexColor(value);
  }
  return null;
}

function _context(figmaData = {}) {
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const textStyles = Array.isArray(figmaData.textStyles) ? figmaData.textStyles : [];
  const effectStyles = Array.isArray(figmaData.effectStyles) ? figmaData.effectStyles : [];
  const varsByName = new Map(variables.filter(v => v && v.name).map(v => [v.name, v]));
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));
  const collectionsByName = new Map(collections.filter(c => c && c.name).map(c => [c.name, c]));
  const collectionsById = new Map(collections.filter(c => c && c.id).map(c => [c.id, c]));
  const textStylesByName = new Map(textStyles.filter(s => s && s.name).map(s => [s.name, s]));
  const textStylesById = new Map(textStyles.filter(s => s && s.id).map(s => [s.id, s]));
  const effectStylesByName = new Map(effectStyles.filter(s => s && s.name).map(s => [s.name, s]));
  const effectStylesById = new Map(effectStyles.filter(s => s && s.id).map(s => [s.id, s]));
  const collectionByVarId = new Map();
  for (const collection of collections) {
    for (const id of collection.variableIds || []) collectionByVarId.set(id, collection);
  }
  return {
    variables,
    collections,
    textStyles,
    effectStyles,
    varsByName,
    varsById,
    collectionsByName,
    collectionsById,
    textStylesByName,
    textStylesById,
    effectStylesByName,
    effectStylesById,
    collectionByVarId,
  };
}

function _collectionForVariable(variable, ctx) {
  if (!variable) return null;
  return ctx.collectionByVarId.get(variable.id) || ctx.collectionsById.get(variable.variableCollectionId) || null;
}

function _modeForName(collection, name) {
  return (collection && collection.modes || []).find(mode => _norm(_modeName(mode)) === _norm(name)) || null;
}

function _styleSignature(style) {
  if (!style) return "missing";
  const copy = {};
  for (const key of ["id", "name", "fontName", "fontSize", "lineHeight", "letterSpacing", "effects", "description"]) {
    if (Object.prototype.hasOwnProperty.call(style, key)) copy[key] = style[key];
  }
  return _stableJson(copy);
}

function _metadataPatch(input) {
  const metadata = input && input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const allowed = {};
  for (const key of ["description", "scopes", "codeSyntax", "hiddenFromPublishing"]) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) allowed[key] = metadata[key];
  }
  return allowed;
}

function _hasPatch(patch) {
  return patch && typeof patch === "object" && Object.keys(patch).length > 0;
}

function _styleProps(input) {
  return input && input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)
    ? Object.assign({}, input.properties)
    : {};
}

function _styleByKind(ctx, kind, name) {
  return kind === "text"
    ? ctx.textStylesByName.get(name)
    : ctx.effectStylesByName.get(name);
}

function _styleMapsByKind(ctx, kind) {
  return kind === "text"
    ? { byName: ctx.textStylesByName, byId: ctx.textStylesById }
    : { byName: ctx.effectStylesByName, byId: ctx.effectStylesById };
}

function _parseStoredModeValues(sourceVariable, sourceCollection, targetCollection, ctx) {
  const errors = [];
  const modeValues = [];
  const sourceValues = sourceVariable.valuesByMode || {};
  for (const sourceMode of sourceCollection.modes || []) {
    const targetMode = sourceCollection.id === targetCollection.id
      ? sourceMode
      : _modeForName(targetCollection, _modeName(sourceMode));
    if (!targetMode) {
      errors.push(`Target collection ${targetCollection.name} is missing mode ${_modeName(sourceMode)}.`);
      continue;
    }
    const rawValue = sourceValues[sourceMode.modeId];
    if (rawValue && typeof rawValue === "object" && rawValue.type === "VARIABLE_ALIAS") {
      const target = ctx.varsById.get(rawValue.id);
      if (!target) {
        errors.push(`Alias target ${rawValue.id} for ${sourceVariable.name} was not found.`);
        continue;
      }
      if (target.resolvedType !== sourceVariable.resolvedType) {
        errors.push(`Alias target ${target.name} is ${target.resolvedType}, not ${sourceVariable.resolvedType}.`);
        continue;
      }
      modeValues.push({
        mode: _modeName(targetMode),
        modeId: targetMode.modeId,
        sourceMode: _modeName(sourceMode),
        sourceModeId: sourceMode.modeId,
        kind: "alias",
        targetName: target.name,
        targetId: target.id,
      });
      continue;
    }
    modeValues.push({
      mode: _modeName(targetMode),
      modeId: targetMode.modeId,
      sourceMode: _modeName(sourceMode),
      sourceModeId: sourceMode.modeId,
      kind: "literal",
      value: rawValue == null ? null : rawValue,
    });
  }
  if (!modeValues.length) errors.push(`No mode values were usable for ${sourceVariable.name}.`);
  return { errors, modeValues };
}

function _findAliasRefs(ctx, sourceId) {
  const refs = [];
  for (const variable of ctx.variables) {
    for (const [modeId, value] of Object.entries(variable.valuesByMode || {})) {
      if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS" && value.id === sourceId) {
        refs.push({
          variableId: variable.id,
          variableName: variable.name,
          modeId,
          expectedCurrentSignature: _valueSignature(value),
        });
      }
    }
  }
  return refs;
}

function _parseModeValues(values, type, collection, ctx, variable) {
  const errors = [];
  const modeValues = [];
  values = _coerceModeValuesInput(values);
  if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length) {
    return { errors: ["Mode values are required."], modeValues: [] };
  }
  for (const modeName of Object.keys(values)) {
    const mode = _modeForName(collection, modeName);
    if (!mode) {
      errors.push(`Mode ${modeName} was not found in ${collection.name}.`);
      continue;
    }
    const rawValue = values[modeName];
    const aliasName = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue.alias || rawValue.targetName || rawValue.variable)
      : (typeof rawValue === "string" && ctx.varsByName.has(rawValue) ? rawValue : null);
    if (aliasName) {
      const target = ctx.varsByName.get(aliasName);
      if (!target) {
        errors.push(`Alias target ${aliasName} was not found.`);
        continue;
      }
      if (target.resolvedType !== type) {
        errors.push(`Alias target ${aliasName} is ${target.resolvedType}, not ${type}.`);
        continue;
      }
      const modeValue = {
        mode: _modeName(mode),
        modeId: mode.modeId,
        kind: "alias",
        targetName: target.name,
        targetId: target.id,
      };
      if (variable) modeValue.expectedCurrentSignature = _valueSignature((variable.valuesByMode || {})[mode.modeId]);
      modeValues.push(modeValue);
      continue;
    }
    const literalSource = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, "value")
      ? rawValue.value
      : rawValue;
    const literal = _normalizeLiteral(type, literalSource);
    if (literal == null) {
      errors.push(`Value for ${modeName} is not a valid ${type} literal or alias.`);
      continue;
    }
    const modeValue = {
      mode: _modeName(mode),
      modeId: mode.modeId,
      kind: "literal",
      value: literal,
    };
    if (variable) modeValue.expectedCurrentSignature = _valueSignature((variable.valuesByMode || {})[mode.modeId]);
    modeValues.push(modeValue);
  }
  if (!modeValues.length) errors.push("No mode values were usable.");
  return { errors, modeValues };
}

function _coerceModeValuesInput(values) {
  if (!Array.isArray(values)) return values;
  const out = {};
  for (const entry of values) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const modeName = entry.mode || entry.modeName || entry.name;
    if (!modeName) continue;
    if (Object.prototype.hasOwnProperty.call(entry, "value")) {
      out[String(modeName)] = entry.value;
      continue;
    }
    if (entry.alias || entry.targetName || entry.variable) {
      out[String(modeName)] = {
        alias: entry.alias || entry.targetName || entry.variable,
      };
    }
  }
  return out;
}

function _modeValueInput(input) {
  if (input && Object.prototype.hasOwnProperty.call(input, "values")) return input.values;
  if (input && Object.prototype.hasOwnProperty.call(input, "modeValues")) return input.modeValues;
  if (input && Object.prototype.hasOwnProperty.call(input, "mode_values")) return input.mode_values;
  return undefined;
}

function _blocked(input, errors) {
  return {
    status: "blocked",
    requested: input,
    errors,
  };
}

function _duplicateSemanticSegmentWarning(fromName, toName) {
  const toParts = String(toName || "").split("/").filter(Boolean);
  if (toParts.length < 3) return null;
  const leaf = _norm(toParts[toParts.length - 1]);
  const previous = _norm(toParts[toParts.length - 2]);
  if (!previous || !leaf.startsWith(previous + "-")) return null;
  const fromParts = String(fromName || "").split("/").filter(Boolean);
  const fromPrevious = _norm(fromParts[fromParts.length - 2]);
  const fromLeaf = _norm(fromParts[fromParts.length - 1]);
  if (fromPrevious === previous && fromLeaf && leaf === `${previous}-${fromLeaf}`) {
    return `Target name ${toName} repeats the ${previous} segment in the leaf. If this came from semantic naming cleanup, stop and use plan_ds_semantic_naming_consolidation instead of an invented rename batch.`;
  }
  return `Target name ${toName} repeats the ${previous} segment in the leaf. Confirm this is the designer's exact requested token name before applying.`;
}

function _operationWarnings(operation) {
  const warnings = [];
  if (!operation || typeof operation !== "object") return warnings;
  if (operation.kind === "rename_variable" || operation.kind === "duplicate_variable" || operation.kind === "move_variable") {
    const duplicateSegment = _duplicateSemanticSegmentWarning(operation.expectedName, operation.newName);
    if (duplicateSegment) warnings.push(duplicateSegment);
  }
  return warnings;
}

function _ready(input, operation, summaryLine) {
  const warnings = _operationWarnings(operation);
  return {
    status: "ready",
    requested: input,
    operation,
    summaryLine,
    warnings,
  };
}

function _planOperation(input, ctx) {
  const kind = input && input.kind ? String(input.kind) : "";
  const errors = [];
  if (!OP_KINDS.has(kind)) return _blocked(input, [`Unsupported operation kind ${kind || "(missing)"}.`]);

  if (kind === "create_collection") {
    const name = input.name ? String(input.name) : "";
    const modes = Array.isArray(input.modes) ? input.modes.map(String).filter(Boolean) : [];
    if (!name) errors.push("Collection name is required.");
    if (name && ctx.collectionsByName.has(name)) errors.push(`Collection ${name} already exists.`);
    if (!modes.length) errors.push("Create collection requires at least one mode name.");
    if (new Set(modes.map(_norm)).size !== modes.length) errors.push("Create collection mode names must be unique.");
    if (errors.length) return _blocked(input, errors);
    const operation = { kind, name, modes };
    return _ready(input, operation, `Create collection ${name} with modes ${modes.join(", ")}.`);
  }

  const collectionName = input.collection ? String(input.collection) : "";
  const collection = collectionName ? ctx.collectionsByName.get(collectionName) : null;
  if (["rename_collection", "delete_collection", "create_mode", "rename_mode", "delete_mode"].includes(kind)) {
    if (!collectionName) errors.push("Collection name is required.");
    if (collectionName && !collection) errors.push(`Collection ${collectionName} was not found.`);
    if (errors.length) return _blocked(input, errors);
  }

  if (kind === "rename_collection") {
    const newName = input.newName ? String(input.newName) : "";
    if (!newName) errors.push("newName is required.");
    if (newName && ctx.collectionsByName.has(newName)) errors.push(`Collection ${newName} already exists.`);
    if (errors.length) return _blocked(input, errors);
    const operation = { kind, collectionId: collection.id, expectedName: collection.name, newName };
    return _ready(input, operation, `Rename collection ${collection.name} to ${newName}.`);
  }

  if (kind === "delete_collection") {
    const variableIds = (collection.variableIds || []).slice();
    const operation = {
      kind,
      collectionId: collection.id,
      expectedName: collection.name,
      expectedVariableIds: variableIds,
      affectedVariables: variableIds.map(id => {
        const variable = ctx.varsById.get(id);
        return variable ? variable.name : id;
      }),
      destructive: true,
    };
    return _ready(input, operation, `Delete collection ${collection.name} and ${variableIds.length} variable${variableIds.length === 1 ? "" : "s"} in it.`);
  }

  if (kind === "create_mode") {
    const modeName = input.mode ? String(input.mode) : "";
    if (!modeName) errors.push("mode is required.");
    if (modeName && _modeForName(collection, modeName)) errors.push(`Mode ${modeName} already exists in ${collection.name}.`);
    if (errors.length) return _blocked(input, errors);
    const operation = { kind, collectionId: collection.id, collection: collection.name, modeName };
    return _ready(input, operation, `Create mode ${modeName} in ${collection.name}.`);
  }

  if (kind === "rename_mode") {
    const modeName = input.mode ? String(input.mode) : "";
    const newName = input.newName ? String(input.newName) : "";
    const mode = modeName ? _modeForName(collection, modeName) : null;
    if (!modeName) errors.push("mode is required.");
    if (modeName && !mode) errors.push(`Mode ${modeName} was not found in ${collection.name}.`);
    if (!newName) errors.push("newName is required.");
    if (newName && _modeForName(collection, newName)) errors.push(`Mode ${newName} already exists in ${collection.name}.`);
    if (errors.length) return _blocked(input, errors);
    const operation = { kind, collectionId: collection.id, collection: collection.name, modeId: mode.modeId, expectedModeName: _modeName(mode), newName };
    return _ready(input, operation, `Rename mode ${_modeName(mode)} to ${newName} in ${collection.name}.`);
  }

  if (kind === "delete_mode") {
    const modeName = input.mode ? String(input.mode) : "";
    const mode = modeName ? _modeForName(collection, modeName) : null;
    if (!modeName) errors.push("mode is required.");
    if (modeName && !mode) errors.push(`Mode ${modeName} was not found in ${collection.name}.`);
    if ((collection.modes || []).length <= 1) errors.push(`Cannot delete the last mode from ${collection.name}.`);
    if (errors.length) return _blocked(input, errors);
    const operation = { kind, collectionId: collection.id, collection: collection.name, modeId: mode.modeId, expectedModeName: _modeName(mode), destructive: true };
    return _ready(input, operation, `Delete mode ${_modeName(mode)} from ${collection.name}.`);
  }

  const variableName = input.name ? String(input.name) : "";
  const variable = variableName ? ctx.varsByName.get(variableName) : null;

  if (kind === "create_variable") {
    const name = variableName;
    const type = input.type ? String(input.type).toUpperCase() : "";
    const targetCollectionName = input.collection ? String(input.collection) : "";
    const targetCollection = targetCollectionName ? ctx.collectionsByName.get(targetCollectionName) : null;
    if (!name) errors.push("Variable name is required.");
    if (name && ctx.varsByName.has(name)) errors.push(`Variable ${name} already exists.`);
    if (!targetCollectionName) errors.push("Collection name is required.");
    if (targetCollectionName && !targetCollection) errors.push(`Collection ${targetCollectionName} was not found.`);
    if (!VARIABLE_TYPES.has(type)) errors.push(`Unsupported variable type ${type || "(missing)"}.`);
    if (errors.length) return _blocked(input, errors);
    const parsed = _parseModeValues(_modeValueInput(input), type, targetCollection, ctx, null);
    if (parsed.errors.length) return _blocked(input, parsed.errors);
    const operation = { kind, name, collection: targetCollection.name, collectionId: targetCollection.id, type, modeValues: parsed.modeValues };
    return _ready(input, operation, `Create ${type} variable ${name} in ${targetCollection.name}.`);
  }

  if (["update_variable", "rename_variable", "delete_variable", "update_variable_metadata", "duplicate_variable", "move_variable", "deprecate_variable"].includes(kind)) {
    if (!variableName) errors.push("Variable name is required.");
    if (variableName && !variable) errors.push(`Variable ${variableName} was not found.`);
    if (errors.length) return _blocked(input, errors);
  }

  if (kind === "update_variable") {
    const collection = _collectionForVariable(variable, ctx);
    if (!collection) return _blocked(input, [`Collection for ${variable.name} was not found.`]);
    const parsed = _parseModeValues(_modeValueInput(input), variable.resolvedType, collection, ctx, variable);
    if (parsed.errors.length) return _blocked(input, parsed.errors);
    const operation = {
      kind,
      variableId: variable.id,
      expectedName: variable.name,
      type: variable.resolvedType,
      collectionId: collection.id,
      collection: collection.name,
      modeValues: parsed.modeValues,
    };
    return _ready(input, operation, `Update ${variable.name}: ${parsed.modeValues.map(value => value.kind === "alias" ? `${value.mode} -> ${value.targetName}` : `${value.mode} = ${JSON.stringify(value.value)}`).join("; ")}.`);
  }

  if (kind === "rename_variable") {
    const newName = input.newName ? String(input.newName) : "";
    if (!newName) errors.push("newName is required.");
    if (newName && ctx.varsByName.has(newName)) errors.push(`Variable ${newName} already exists.`);
    if (errors.length) return _blocked(input, errors);
    const operation = { kind, variableId: variable.id, expectedName: variable.name, newName, type: variable.resolvedType };
    return _ready(input, operation, `Rename variable ${variable.name} to ${newName}.`);
  }

  if (kind === "delete_variable") {
    const operation = { kind, variableId: variable.id, expectedName: variable.name, type: variable.resolvedType, destructive: true };
    return _ready(input, operation, `Delete variable ${variable.name}.`);
  }

  if (kind === "update_variable_metadata") {
    const metadata = _metadataPatch(input);
    if (!_hasPatch(metadata)) return _blocked(input, ["metadata must include at least one supported key: description, scopes, codeSyntax, hiddenFromPublishing."]);
    const operation = {
      kind,
      variableId: variable.id,
      expectedName: variable.name,
      type: variable.resolvedType,
      metadata,
    };
    return _ready(input, operation, `Update metadata for variable ${variable.name}.`);
  }

  if (kind === "duplicate_variable" || kind === "move_variable") {
    const sourceCollection = _collectionForVariable(variable, ctx);
    if (!sourceCollection) return _blocked(input, [`Collection for ${variable.name} was not found.`]);
    const targetCollectionName = input.collection ? String(input.collection) : sourceCollection.name;
    const targetCollection = ctx.collectionsByName.get(targetCollectionName);
    const newName = input.newName ? String(input.newName) : "";
    const deleteOriginal = kind === "move_variable" && input.deleteOriginal === true;
    if (!targetCollectionName) errors.push("collection is required.");
    if (targetCollectionName && !targetCollection) errors.push(`Collection ${targetCollectionName} was not found.`);
    if (!newName) errors.push("newName is required.");
    if (newName && ctx.varsByName.has(newName)) errors.push(`Variable ${newName} already exists.`);
    if (errors.length) return _blocked(input, errors);
    const parsed = _parseStoredModeValues(variable, sourceCollection, targetCollection, ctx);
    if (parsed.errors.length) return _blocked(input, parsed.errors);
    const operation = {
      kind,
      variableId: variable.id,
      expectedName: variable.name,
      type: variable.resolvedType,
      sourceCollectionId: sourceCollection.id,
      sourceCollection: sourceCollection.name,
      collectionId: targetCollection.id,
      collection: targetCollection.name,
      newName,
      modeValues: parsed.modeValues,
    };
    if (deleteOriginal) {
      operation.deleteOriginal = true;
      operation.destructive = true;
    }
    return _ready(input, operation, `${kind === "move_variable" ? "Move" : "Duplicate"} variable ${variable.name} to ${targetCollection.name} as ${newName}${deleteOriginal ? " and delete the original" : ""}.`);
  }

  if (kind === "deprecate_variable") {
    const message = input.message ? String(input.message) : "Deprecated by Figlets.";
    const operation = {
      kind,
      variableId: variable.id,
      expectedName: variable.name,
      type: variable.resolvedType,
      message,
      hideFromPublishing: input.hideFromPublishing !== false,
    };
    return _ready(input, operation, `Deprecate variable ${variable.name}.`);
  }

  if (kind === "retarget_variable_aliases") {
    const fromName = input.from ? String(input.from) : "";
    const toName = input.to ? String(input.to) : "";
    const fromVar = fromName ? ctx.varsByName.get(fromName) : null;
    const toVar = toName ? ctx.varsByName.get(toName) : null;
    if (!fromName) errors.push("from is required.");
    if (fromName && !fromVar) errors.push(`Variable ${fromName} was not found.`);
    if (!toName) errors.push("to is required.");
    if (toName && !toVar) errors.push(`Variable ${toName} was not found.`);
    if (fromVar && toVar && fromVar.resolvedType !== toVar.resolvedType) errors.push(`${fromVar.name} is ${fromVar.resolvedType}, but ${toVar.name} is ${toVar.resolvedType}.`);
    if (errors.length) return _blocked(input, errors);
    const aliasRefs = _findAliasRefs(ctx, fromVar.id);
    const operation = {
      kind,
      fromVariableId: fromVar.id,
      expectedFromName: fromVar.name,
      toVariableId: toVar.id,
      expectedToName: toVar.name,
      type: fromVar.resolvedType,
      aliasRefs,
    };
    if (input.deleteOld === true) {
      operation.deleteOld = true;
      operation.destructive = true;
    }
    return _ready(input, operation, `Retarget ${aliasRefs.length} alias reference${aliasRefs.length === 1 ? "" : "s"} from ${fromVar.name} to ${toVar.name}${operation.deleteOld ? " and delete the old variable" : ""}.`);
  }

  if (["create_text_style", "update_text_style", "rename_text_style", "delete_text_style", "create_effect_style", "update_effect_style", "rename_effect_style", "delete_effect_style"].includes(kind)) {
    const styleKind = kind.includes("_text_") ? "text" : "effect";
    const maps = _styleMapsByKind(ctx, styleKind);
    const name = input.name ? String(input.name) : "";
    const style = name ? maps.byName.get(name) : null;
    const label = styleKind === "text" ? "text style" : "effect style";

    if (kind.startsWith("create_")) {
      const props = _styleProps(input);
      if (!name) errors.push("Style name is required.");
      if (name && maps.byName.has(name)) errors.push(`${label} ${name} already exists.`);
      if (styleKind === "effect" && !Array.isArray(props.effects)) errors.push("Effect style creation requires properties.effects.");
      if (errors.length) return _blocked(input, errors);
      const operation = { kind, name, styleKind, properties: props };
      return _ready(input, operation, `Create ${label} ${name}.`);
    }

    if (!name) errors.push("Style name is required.");
    if (name && !style) errors.push(`${label} ${name} was not found.`);
    if (errors.length) return _blocked(input, errors);

    if (kind.startsWith("update_")) {
      const props = _styleProps(input);
      if (!_hasPatch(props)) return _blocked(input, ["properties must include at least one style property."]);
      const operation = { kind, styleKind, styleId: style.id, expectedName: style.name, expectedStyleSignature: _styleSignature(style), properties: props };
      return _ready(input, operation, `Update ${label} ${style.name}.`);
    }
    if (kind.startsWith("rename_")) {
      const newName = input.newName ? String(input.newName) : "";
      if (!newName) errors.push("newName is required.");
      if (newName && maps.byName.has(newName)) errors.push(`${label} ${newName} already exists.`);
      if (errors.length) return _blocked(input, errors);
      const operation = { kind, styleKind, styleId: style.id, expectedName: style.name, newName };
      return _ready(input, operation, `Rename ${label} ${style.name} to ${newName}.`);
    }
    const operation = { kind, styleKind, styleId: style.id, expectedName: style.name, expectedStyleSignature: _styleSignature(style), destructive: true };
    return _ready(input, operation, `Delete ${label} ${style.name}.`);
  }

  if (["bind_node_variable", "unbind_node_variable", "bind_node_paint_variable", "unbind_node_paint_variable", "bind_node_text_style", "unbind_node_text_style", "bind_node_effect_style", "unbind_node_effect_style"].includes(kind)) {
    const nodeId = input.nodeId ? String(input.nodeId) : "";
    const property = input.property ? String(input.property) : "";
    if (!nodeId) errors.push("nodeId is required.");
    if (kind.includes("_paint_")) {
      const paintProperty = input.paintProperty ? String(input.paintProperty) : "";
      if (!["fills", "strokes"].includes(paintProperty)) errors.push("paintProperty must be fills or strokes.");
      const paintIndex = Number.isInteger(input.paintIndex) ? input.paintIndex : 0;
      if (paintIndex < 0) errors.push("paintIndex must be 0 or greater.");
      if (kind.startsWith("bind_")) {
        const variableTarget = input.variable ? ctx.varsByName.get(String(input.variable)) : null;
        if (!input.variable) errors.push("variable is required.");
        if (input.variable && !variableTarget) errors.push(`Variable ${input.variable} was not found.`);
        if (variableTarget && variableTarget.resolvedType !== "COLOR") errors.push(`Paint variable ${variableTarget.name} must be COLOR.`);
        if (errors.length) return _blocked(input, errors);
        return _ready(input, { kind, nodeId, paintProperty, paintIndex, variableId: variableTarget.id, variableName: variableTarget.name, type: variableTarget.resolvedType }, `Bind ${paintProperty}[${paintIndex}] on node ${nodeId} to ${variableTarget.name}.`);
      }
      if (errors.length) return _blocked(input, errors);
      return _ready(input, { kind, nodeId, paintProperty, paintIndex }, `Unbind ${paintProperty}[${paintIndex}] on node ${nodeId}.`);
    }
    if (kind === "bind_node_variable") {
      const variableTarget = input.variable ? ctx.varsByName.get(String(input.variable)) : null;
      if (!property) errors.push("property is required.");
      if (!input.variable) errors.push("variable is required.");
      if (input.variable && !variableTarget) errors.push(`Variable ${input.variable} was not found.`);
      if (errors.length) return _blocked(input, errors);
      return _ready(input, { kind, nodeId, property, variableId: variableTarget.id, variableName: variableTarget.name, type: variableTarget.resolvedType }, `Bind ${property} on node ${nodeId} to ${variableTarget.name}.`);
    }
    if (kind === "unbind_node_variable") {
      if (!property) errors.push("property is required.");
      if (errors.length) return _blocked(input, errors);
      return _ready(input, { kind, nodeId, property }, `Unbind ${property} on node ${nodeId}.`);
    }
    if (kind === "bind_node_text_style") {
      const styleName = input.style ? String(input.style) : "";
      const targetStyle = styleName ? ctx.textStylesByName.get(styleName) : null;
      if (!styleName) errors.push("style is required.");
      if (styleName && !targetStyle) errors.push(`Text style ${styleName} was not found.`);
      if (errors.length) return _blocked(input, errors);
      return _ready(input, { kind, nodeId, styleId: targetStyle.id, styleName: targetStyle.name }, `Bind text style ${targetStyle.name} to node ${nodeId}.`);
    }
    if (kind === "bind_node_effect_style") {
      const styleName = input.style ? String(input.style) : "";
      const targetStyle = styleName ? ctx.effectStylesByName.get(styleName) : null;
      if (!styleName) errors.push("style is required.");
      if (styleName && !targetStyle) errors.push(`Effect style ${styleName} was not found.`);
      if (errors.length) return _blocked(input, errors);
      return _ready(input, { kind, nodeId, styleId: targetStyle.id, styleName: targetStyle.name }, `Bind effect style ${targetStyle.name} to node ${nodeId}.`);
    }
    if (errors.length) return _blocked(input, errors);
    return _ready(input, { kind, nodeId }, `${kind === "unbind_node_text_style" ? "Unbind text style" : "Unbind effect style"} on node ${nodeId}.`);
  }

  if (kind === "update_collection_metadata") {
    const targetCollectionName = input.collection ? String(input.collection) : "";
    const targetCollection = targetCollectionName ? ctx.collectionsByName.get(targetCollectionName) : null;
    const metadata = _metadataPatch(input);
    if (!targetCollectionName) errors.push("Collection name is required.");
    if (targetCollectionName && !targetCollection) errors.push(`Collection ${targetCollectionName} was not found.`);
    if (!_hasPatch(metadata)) errors.push("metadata must include at least one supported key: description, hiddenFromPublishing.");
    if (metadata.scopes || metadata.codeSyntax) errors.push("Collection metadata does not support scopes or codeSyntax.");
    if (errors.length) return _blocked(input, errors);
    return _ready(input, { kind, collectionId: targetCollection.id, expectedName: targetCollection.name, metadata }, `Update metadata for collection ${targetCollection.name}.`);
  }

  return _blocked(input, [`Unhandled operation kind ${kind}.`]);
}

function planDsFigmaOperationsFromFigmaData(figmaData = {}, input = {}) {
  const operations = Array.isArray(input.operations) ? input.operations : [];
  const ctx = _context(figmaData);
  const planned = operations.map(operation => _planOperation(operation, ctx));
  const ready = planned.filter(item => item.status === "ready");
  const blocked = planned.filter(item => item.status !== "ready");
  const destructiveCount = ready.filter(item => item.operation && item.operation.destructive).length;
  const warningCount = ready.reduce((sum, item) => sum + (Array.isArray(item.warnings) ? item.warnings.length : 0), 0);
  return {
    message: `Figma operations dry-run: ${ready.length} ready, ${blocked.length} blocked${destructiveCount ? `, ${destructiveCount} destructive` : ""}${warningCount ? `, ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}.`,
    dryRun: true,
    requestedCount: operations.length,
    planned,
    repairPlan: {
      tool: "apply_ds_figma_operations",
      approvalRequired: true,
      applyInput: { operations: ready.map(item => item.operation) },
      counts: { ready: ready.length, blocked: blocked.length, destructive: destructiveCount, warnings: warningCount },
      designerPresentation: {
        audience: "designer",
        sayToDesigner: ready.length
          ? [`Figlets can apply ${ready.length} exact Figma operation${ready.length === 1 ? "" : "s"} after you approve the list.`]
          : ["Figlets could not prepare any Figma operations because the dry-run found blocking issues."],
        proposedChanges: ready.map(item => ({
          action: item.operation.kind,
          destructive: Boolean(item.operation.destructive),
          summaryLine: `${item.operation.destructive ? "[destructive] " : ""}${item.summaryLine}`,
          warnings: item.warnings || [],
        })),
        blocked: blocked.map(item => ({ requested: item.requested, errors: item.errors })),
        approvalPrompt: ready.length
          ? "Review the exact operations above, including any warnings. If approved, Figlets will apply only those operations."
          : null,
      },
      agentInstruction: ready.length
        ? "Show every proposedChanges summaryLine, warnings entry, and blocked item before asking approval. Destructive entries must be named explicitly. plan_ds_figma_operations is for exact designer-requested edits or payloads produced by a narrower Figlets planner; do not use it to invent semantic naming migrations from health-check conflicts. If semanticNamingConflicts are the source of the request, use plan_ds_semantic_naming_consolidation. If approved, pass repairPlan.applyInput unchanged to apply_ds_figma_operations; for a subset, filter operations without editing entries."
        : "Do not invent missing operation details. Ask for exact collection, mode, variable, type, value, or alias details, then rerun the planner.",
    },
  };
}

function handlePlanDsFigmaOperations(input = {}) {
  const dataSource = _loadDataSource(input);
  if (!dataSource) {
    return { error: "No synced Figma snapshot found.", hint: "Run sync_figma_data first, then plan Figma operations again." };
  }
  const result = planDsFigmaOperationsFromFigmaData(dataSource.figmaData, input);
  result.source = {
    kind: dataSource.kind,
    target: dataSource.target,
    path: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
  };
  return result;
}

function _normalizeOperations(items) {
  return (Array.isArray(items) ? items : []).filter(item => item && typeof item === "object" && OP_KINDS.has(item.kind));
}

function _validateApprovedOperations(operations, figmaData = {}) {
  const ctx = _context(figmaData);
  const keys = new Set();
  for (const operation of operations) {
    const key = _stableJson(operation);
    if (keys.has(key)) return "Duplicate operations are not allowed.";
    keys.add(key);
    const kind = operation.kind;
    if (!OP_KINDS.has(kind)) return `Unsupported operation kind ${kind}.`;
    if (kind === "create_collection") {
      if (!operation.name || ctx.collectionsByName.has(operation.name)) return `Collection ${operation.name || "(missing)"} already exists or is invalid.`;
      if (!Array.isArray(operation.modes) || !operation.modes.length) return `Collection ${operation.name} must include modes.`;
      continue;
    }
    if (["rename_collection", "delete_collection", "create_mode", "rename_mode", "delete_mode"].includes(kind)) {
      const collection = ctx.collectionsById.get(operation.collectionId);
      const expectedName = operation.expectedName || operation.collection;
      if (!collection || (expectedName && collection.name !== expectedName)) return `Collection for ${kind} is stale or missing.`;
      if (kind === "rename_collection" && (!operation.newName || ctx.collectionsByName.has(operation.newName))) return `Target collection name ${operation.newName || "(missing)"} is invalid or already exists.`;
      if (kind === "delete_collection") {
        const expectedIds = Array.isArray(operation.expectedVariableIds) ? operation.expectedVariableIds : [];
        const currentIds = (collection.variableIds || []).slice().sort();
        if (_stableJson(currentIds) !== _stableJson(expectedIds.slice().sort())) return `Collection ${collection.name} variables changed since approval.`;
      }
      if (kind === "create_mode" && (!operation.modeName || _modeForName(collection, operation.modeName))) return `Mode ${operation.modeName || "(missing)"} is invalid or already exists.`;
      if (kind === "rename_mode" || kind === "delete_mode") {
        const mode = (collection.modes || []).find(item => item.modeId === operation.modeId);
        if (!mode || _modeName(mode) !== operation.expectedModeName) return `Mode ${operation.expectedModeName || operation.modeId} is stale or missing.`;
        if (kind === "rename_mode" && (!operation.newName || _modeForName(collection, operation.newName))) return `Target mode name ${operation.newName || "(missing)"} is invalid or already exists.`;
        if (kind === "delete_mode" && (collection.modes || []).length <= 1) return `Cannot delete the last mode from ${collection.name}.`;
      }
      continue;
    }
    if (kind === "create_variable") {
      if (!operation.name || ctx.varsByName.has(operation.name)) return `Variable ${operation.name || "(missing)"} already exists or is invalid.`;
      const collection = ctx.collectionsById.get(operation.collectionId);
      if (!collection || collection.name !== operation.collection) return `Collection for ${operation.name} is stale or missing.`;
      const error = _validateModeValues(operation, collection, ctx, null);
      if (error) return error;
      continue;
    }
    if (kind === "update_collection_metadata") {
      const collection = ctx.collectionsById.get(operation.collectionId);
      if (!collection || collection.name !== operation.expectedName) return `Collection ${operation.expectedName || operation.collectionId} is stale or missing.`;
      if (!_hasPatch(operation.metadata)) return `Collection ${operation.expectedName} metadata payload is empty.`;
      continue;
    }
    if (["create_text_style", "create_effect_style"].includes(kind)) {
      const styleKind = operation.styleKind || (kind.includes("_text_") ? "text" : "effect");
      const maps = _styleMapsByKind(ctx, styleKind);
      if (!operation.name || maps.byName.has(operation.name)) return `${styleKind} style ${operation.name || "(missing)"} already exists or is invalid.`;
      if (styleKind === "effect" && (!operation.properties || !Array.isArray(operation.properties.effects))) return `Effect style ${operation.name} must include effects.`;
      continue;
    }
    if (["update_text_style", "rename_text_style", "delete_text_style", "update_effect_style", "rename_effect_style", "delete_effect_style"].includes(kind)) {
      const styleKind = operation.styleKind || (kind.includes("_text_") ? "text" : "effect");
      const maps = _styleMapsByKind(ctx, styleKind);
      const style = maps.byId.get(operation.styleId);
      if (!style || style.name !== operation.expectedName) return `${styleKind} style ${operation.expectedName || operation.styleId} is stale or missing.`;
      if ((kind.startsWith("update_") || kind.startsWith("delete_")) && operation.expectedStyleSignature !== _styleSignature(style)) {
        return `${styleKind} style ${operation.expectedName} changed since approval.`;
      }
      if (kind.startsWith("rename_") && (!operation.newName || maps.byName.has(operation.newName))) return `Target ${styleKind} style name ${operation.newName || "(missing)"} is invalid or already exists.`;
      if (kind.startsWith("update_") && !_hasPatch(operation.properties)) return `${styleKind} style ${operation.expectedName} properties payload is empty.`;
      continue;
    }
    if (["bind_node_variable", "unbind_node_variable", "bind_node_paint_variable", "unbind_node_paint_variable", "bind_node_text_style", "unbind_node_text_style", "bind_node_effect_style", "unbind_node_effect_style"].includes(kind)) {
      if (!operation.nodeId) return `${kind} requires nodeId.`;
      if (kind === "bind_node_variable") {
        const target = ctx.varsById.get(operation.variableId);
        if (!operation.property || !target || target.name !== operation.variableName || target.resolvedType !== operation.type) return `Node variable binding target for ${operation.nodeId} is stale or invalid.`;
      }
      if (kind === "unbind_node_variable" && !operation.property) return `Node variable unbind for ${operation.nodeId} requires property.`;
      if (kind === "bind_node_paint_variable") {
        const target = ctx.varsById.get(operation.variableId);
        if (!["fills", "strokes"].includes(operation.paintProperty) || !Number.isInteger(operation.paintIndex) || operation.paintIndex < 0 || !target || target.name !== operation.variableName || target.resolvedType !== "COLOR") {
          return `Node paint binding target for ${operation.nodeId} is stale or invalid.`;
        }
      }
      if (kind === "unbind_node_paint_variable" && (!["fills", "strokes"].includes(operation.paintProperty) || !Number.isInteger(operation.paintIndex) || operation.paintIndex < 0)) return `Node paint unbind for ${operation.nodeId} is invalid.`;
      if (kind === "bind_node_text_style") {
        const style = ctx.textStylesById.get(operation.styleId);
        if (!style || style.name !== operation.styleName) return `Text style binding target for ${operation.nodeId} is stale or missing.`;
      }
      if (kind === "bind_node_effect_style") {
        const style = ctx.effectStylesById.get(operation.styleId);
        if (!style || style.name !== operation.styleName) return `Effect style binding target for ${operation.nodeId} is stale or missing.`;
      }
      continue;
    }
    if (kind === "retarget_variable_aliases") {
      const fromVar = ctx.varsById.get(operation.fromVariableId);
      const toVar = ctx.varsById.get(operation.toVariableId);
      if (!fromVar || fromVar.name !== operation.expectedFromName || fromVar.resolvedType !== operation.type) return `Source variable ${operation.expectedFromName || operation.fromVariableId} is stale or missing.`;
      if (!toVar || toVar.name !== operation.expectedToName || toVar.resolvedType !== operation.type) return `Target variable ${operation.expectedToName || operation.toVariableId} is stale or missing.`;
      for (const ref of operation.aliasRefs || []) {
        const refVar = ctx.varsById.get(ref.variableId);
        if (!refVar || refVar.name !== ref.variableName) return `Alias user ${ref.variableName || ref.variableId} is stale or missing.`;
        if (_valueSignature((refVar.valuesByMode || {})[ref.modeId]) !== ref.expectedCurrentSignature) return `Alias user ${refVar.name} changed since approval.`;
      }
      continue;
    }
    const variable = ctx.varsById.get(operation.variableId);
    if (!variable || variable.name !== operation.expectedName || variable.resolvedType !== operation.type) return `Variable ${operation.expectedName || operation.variableId} is stale, missing, or wrong type.`;
    if (kind === "update_variable") {
      const collection = ctx.collectionsById.get(operation.collectionId);
      if (!collection || collection.name !== operation.collection) return `Collection for ${operation.expectedName} is stale or missing.`;
      const error = _validateModeValues(operation, collection, ctx, variable);
      if (error) return error;
    } else if (kind === "update_variable_metadata") {
      if (!_hasPatch(operation.metadata)) return `Variable ${operation.expectedName} metadata payload is empty.`;
    } else if (kind === "duplicate_variable" || kind === "move_variable") {
      if (ctx.varsByName.has(operation.newName)) return `Target variable name ${operation.newName || "(missing)"} is invalid or already exists.`;
      const collection = ctx.collectionsById.get(operation.collectionId);
      if (!collection || collection.name !== operation.collection) return `Collection for ${operation.newName} is stale or missing.`;
      const sourceCollection = ctx.collectionsById.get(operation.sourceCollectionId);
      if (!sourceCollection || sourceCollection.name !== operation.sourceCollection) return `Source collection for ${operation.expectedName} is stale or missing.`;
      const error = _validateModeValues(operation, collection, ctx, null);
      if (error) return error;
    } else if (kind === "deprecate_variable") {
      if (!operation.message) return `Variable ${operation.expectedName} deprecation message is missing.`;
    } else if (kind === "rename_variable") {
      if (!operation.newName || ctx.varsByName.has(operation.newName)) return `Target variable name ${operation.newName || "(missing)"} is invalid or already exists.`;
    } else if (kind !== "delete_variable") {
      return `Unhandled operation kind ${kind}.`;
    }
  }
  return null;
}

function _validateModeValues(operation, collection, ctx, variable) {
  if (!Array.isArray(operation.modeValues) || !operation.modeValues.length) return `${operation.name || operation.expectedName} has no modeValues.`;
  for (const modeValue of operation.modeValues) {
    const mode = (collection.modes || []).find(item => item.modeId === modeValue.modeId && _modeName(item) === modeValue.mode);
    if (!mode) return `${operation.name || operation.expectedName} mode ${modeValue.mode || modeValue.modeId} is stale or missing.`;
    if (variable && modeValue.expectedCurrentSignature !== _valueSignature((variable.valuesByMode || {})[mode.modeId])) {
      return `${operation.expectedName} value for ${modeValue.mode} changed since approval.`;
    }
    if (modeValue.kind === "alias") {
      const target = ctx.varsById.get(modeValue.targetId);
      if (!target || target.name !== modeValue.targetName || target.resolvedType !== operation.type) {
        return `${operation.name || operation.expectedName} alias target ${modeValue.targetName || modeValue.targetId} is stale, missing, or wrong type.`;
      }
    } else if (modeValue.kind !== "literal") {
      return `${operation.name || operation.expectedName} mode ${modeValue.mode} has invalid kind ${modeValue.kind}.`;
    }
  }
  return null;
}

function handleApplyDsFigmaOperations(args = {}) {
  const operations = _normalizeOperations(args.operations);
  if (!operations.length) return Promise.resolve({ error: "Provide operations copied from plan_ds_figma_operations.repairPlan.applyInput." });
  const dataSource = _loadDataSource(args);
  if (!dataSource) {
    return Promise.resolve({ error: "No synced Figma snapshot found. Run sync_figma_data, then rerun plan_ds_figma_operations and apply the fresh repairPlan.applyInput." });
  }
  const validationError = _validateApprovedOperations(operations, dataSource.figmaData);
  if (validationError) return Promise.resolve({ error: `Invalid Figma operations payload: ${validationError}` });
  return requestBridgePost("/request-figma-operations", { operations }, {
    bridgeHookFile: args.bridgeHookFile,
    transport: args.bridgeTransport,
  }).then(response => {
    const parsed = response.data || {};
    const statusCode = response.statusCode;
    if (statusCode === 200) {
      const result = parsed.result || {};
      return {
        applied: result.applied || [],
        skipped: result.skipped || [],
        unresolved: result.unresolved || [],
        message: `${result.message || "Figma operations complete."} Rerun sync_figma_data and the relevant read-only inspection before summarizing remaining work.`,
        verificationInstruction: "After apply, rerun sync_figma_data and the relevant Figlets read-only inspection. Report only fresh remaining findings.",
        error: result.error,
      };
    }
    return bridgeStatusError(response, {
      action: "Figma operations",
      includeActiveSession: false,
      timeoutError: "Figma operations timed out.",
      conflictError: "The connected plugin does not advertise Figma operations. Reload the Figlets Bridge plugin.",
    });
  });
}

module.exports = {
  planDsFigmaOperationsTool,
  applyDsFigmaOperationsTool,
  planDsFigmaOperationsFromFigmaData,
  handlePlanDsFigmaOperations,
  handleApplyDsFigmaOperations,
  _validateApprovedOperations,
};
