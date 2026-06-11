const { loadActiveFigmaDataSource, loadFigmaDataSource } = require("../bridges/figma-data-source.js");
const { handleApplyDsFigmaOperations } = require("./figma-operations.js");

const VARIABLE_TYPES = new Set(["COLOR", "FLOAT", "STRING", "BOOLEAN"]);

const planDsVariableCreationsTool = {
  name: "plan_ds_variable_creations",
  description:
    "Read-only planner for exact designer-requested Figma variable creation. Use when the designer asks to add specific variables that are not already covered by setup/token-gap planners. Validates collection, type, modes, literal values, and alias targets, then returns a structured apply payload. Never mutates Figma.",
  inputSchema: {
    type: "object",
    properties: {
      variables: {
        type: "array",
        description: "Exact variables requested by the designer.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            collection: { type: "string" },
            type: { type: "string", enum: ["COLOR", "FLOAT", "STRING", "BOOLEAN"] },
            values: {
              type: "object",
              description: "Mode-name map. Each value may be { alias: variableName }, { value: literal }, a number, boolean, string, or color hex string for COLOR."
            }
          },
          required: ["name", "collection", "type", "values"]
        }
      },
      figmaDataPath: {
        type: "string",
        description: "Optional path to a figma-data.json snapshot. Defaults to the active file-scoped snapshot from sync_figma_data."
      }
    },
    required: ["variables"],
    additionalProperties: false
  }
};

const applyDsVariableCreationsTool = {
  name: "apply_ds_variable_creations",
  description:
    "Apply designer-approved variable creations copied from plan_ds_variable_creations.repairPlan.applyInput. Creates only the exact variables, in exact collections and modes, with exact approved aliases/literal values. Rejects stale or invented payloads before the bridge.",
  inputSchema: {
    type: "object",
    properties: {
      variableCreations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            collectionId: { type: "string" },
            collection: { type: "string" },
            type: { type: "string", enum: ["COLOR", "FLOAT", "STRING", "BOOLEAN"] },
            modeValues: { type: "array" }
          },
          required: ["name", "collectionId", "collection", "type", "modeValues"]
        }
      },
      figmaDataPath: {
        type: "string",
        description: "Optional snapshot path used for stale approval validation before apply."
      }
    },
    required: ["variableCreations"],
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
      return { r: Number(value.r), g: Number(value.g), b: Number(value.b), a: Number.isFinite(Number(value.a)) ? Number(value.a) : undefined };
    }
    return _parseHexColor(value);
  }
  return null;
}

function _stableJson(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map(_stableJson).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${_stableJson(value[key])}`).join(",")}}`;
}

function _planOneVariable(input, context) {
  const name = input && input.name ? String(input.name) : "";
  const collectionName = input && input.collection ? String(input.collection) : "";
  const type = input && input.type ? String(input.type).toUpperCase() : "";
  const values = input && input.values && typeof input.values === "object" && !Array.isArray(input.values)
    ? input.values
    : null;
  const errors = [];
  if (!name) errors.push("Missing variable name.");
  if (!collectionName) errors.push(`Missing collection for ${name || "requested variable"}.`);
  if (!VARIABLE_TYPES.has(type)) errors.push(`${name || "requested variable"} has unsupported type ${type || "(missing)"}.`);
  if (!values || !Object.keys(values).length) errors.push(`${name || "requested variable"} must include at least one mode value.`);
  if (context.varsByName.has(name)) errors.push(`${name} already exists.`);
  const collection = context.collections.find(item => item && item.name === collectionName);
  if (!collection) errors.push(`Collection ${collectionName || "(missing)"} was not found.`);
  if (errors.length) return { status: "blocked", name, collection: collectionName, type, errors };

  const modeValues = [];
  for (const modeName of Object.keys(values)) {
    const mode = (collection.modes || []).find(item => _norm(item.name) === _norm(modeName));
    if (!mode) {
      errors.push(`${name}: mode ${modeName} was not found in ${collection.name}.`);
      continue;
    }
    const rawValue = values[modeName];
    const aliasName = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue.alias || rawValue.targetName || rawValue.variable)
      : (typeof rawValue === "string" && context.varsByName.has(rawValue) ? rawValue : null);
    if (aliasName) {
      const target = context.varsByName.get(aliasName);
      if (!target) {
        errors.push(`${name}: alias target ${aliasName} was not found.`);
        continue;
      }
      if (target.resolvedType !== type) {
        errors.push(`${name}: alias target ${aliasName} is ${target.resolvedType}, not ${type}.`);
        continue;
      }
      modeValues.push({
        mode: mode.name || modeName,
        modeId: mode.modeId,
        kind: "alias",
        targetName: target.name,
        targetId: target.id,
      });
      continue;
    }
    const literalSource = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, "value")
      ? rawValue.value
      : rawValue;
    const literal = _normalizeLiteral(type, literalSource);
    if (literal == null) {
      errors.push(`${name}: value for ${modeName} is not a valid ${type} literal or alias.`);
      continue;
    }
    modeValues.push({
      mode: mode.name || modeName,
      modeId: mode.modeId,
      kind: "literal",
      value: literal,
    });
  }
  if (!modeValues.length) errors.push(`${name}: no mode values were usable.`);
  if (errors.length) return { status: "blocked", name, collection: collectionName, collectionId: collection.id, type, errors };
  return {
    status: "ready",
    name,
    collection: collection.name,
    collectionId: collection.id,
    type,
    modeValues,
  };
}

function planDsVariableCreationsFromFigmaData(figmaData = {}, input = {}) {
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const context = {
    variables,
    collections,
    varsByName: new Map(variables.filter(v => v && v.name).map(v => [v.name, v])),
  };
  const requested = Array.isArray(input.variables) ? input.variables : [];
  const planned = requested.map(item => _planOneVariable(item, context));
  const ready = planned.filter(item => item.status === "ready");
  const blocked = planned.filter(item => item.status !== "ready");
  const applyInput = {
    variableCreations: ready.map(item => ({
      name: item.name,
      collection: item.collection,
      collectionId: item.collectionId,
      type: item.type,
      modeValues: item.modeValues,
    })),
  };
  return {
    message: `Variable creation dry-run: ${ready.length} ready, ${blocked.length} blocked.`,
    dryRun: true,
    requestedCount: requested.length,
    planned,
    repairPlan: {
      tool: "apply_ds_variable_creations",
      approvalRequired: true,
      applyInput,
      counts: { ready: ready.length, blocked: blocked.length },
      designerPresentation: {
        audience: "designer",
        sayToDesigner: ready.length
          ? [`Figlets can create ${ready.length} requested variable${ready.length === 1 ? "" : "s"} after you approve the exact list.`]
          : ["Figlets cannot create any of the requested variables yet because the dry-run found blocking issues."],
        proposedChanges: ready.map(item => ({
          token: item.name,
          action: "create variable",
          collection: item.collection,
          type: item.type,
          summaryLine: `Create ${item.type} variable ${item.name} in ${item.collection}: ${item.modeValues.map(value => value.kind === "alias" ? `${value.mode} -> ${value.targetName}` : `${value.mode} = ${JSON.stringify(value.value)}`).join("; ")}.`,
        })),
        blocked: blocked.map(item => ({
          token: item.name,
          collection: item.collection,
          type: item.type,
          errors: item.errors,
        })),
        approvalPrompt: ready.length
          ? "Review the exact variables above. If approved, Figlets will create only those variables with those mode values."
          : null,
      },
      agentInstruction: ready.length
        ? "Show every proposedChanges summaryLine and blocked item before asking approval. If approved, pass repairPlan.applyInput unchanged to apply_ds_variable_creations. If the designer approves a subset, filter variableCreations entries without editing modeValues."
        : "Do not invent collection names, modes, values, or aliases. Ask the designer for the missing exact variable details, then rerun the planner.",
    },
  };
}

function handlePlanDsVariableCreations(input = {}) {
  const dataSource = _loadDataSource(input);
  if (!dataSource) {
    return {
      error: "No synced Figma snapshot found.",
      hint: "Run sync_figma_data first, then plan variable creation again.",
    };
  }
  const result = planDsVariableCreationsFromFigmaData(dataSource.figmaData, input);
  result.source = {
    kind: dataSource.kind,
    target: dataSource.target,
    path: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
  };
  return result;
}

function _normalizeVariableCreations(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    name: item && item.name ? String(item.name) : "",
    collection: item && item.collection ? String(item.collection) : "",
    collectionId: item && item.collectionId ? String(item.collectionId) : "",
    type: item && item.type ? String(item.type).toUpperCase() : "",
    modeValues: Array.isArray(item && item.modeValues) ? item.modeValues.map(value => ({
      mode: value && value.mode ? String(value.mode) : "",
      modeId: value && value.modeId ? String(value.modeId) : "",
      kind: value && value.kind ? String(value.kind) : "",
      targetName: value && value.targetName ? String(value.targetName) : undefined,
      targetId: value && value.targetId ? String(value.targetId) : undefined,
      value: value && Object.prototype.hasOwnProperty.call(value, "value") ? value.value : undefined,
    })) : [],
  })).filter(item => item.name && item.collection && item.collectionId && VARIABLE_TYPES.has(item.type) && item.modeValues.length);
}

function _validateVariableCreationsAgainstSnapshot(variableCreations, figmaData = {}) {
  const variables = Array.isArray(figmaData.variables) ? figmaData.variables : [];
  const collections = Array.isArray(figmaData.collections) ? figmaData.collections : [];
  const varsByName = new Map(variables.filter(v => v && v.name).map(v => [v.name, v]));
  const varsById = new Map(variables.filter(v => v && v.id).map(v => [v.id, v]));
  const collectionsById = new Map(collections.filter(c => c && c.id).map(c => [c.id, c]));
  const seenNames = new Set();
  for (const item of variableCreations) {
    if (seenNames.has(item.name)) return `${item.name} is duplicated in the approved variable creation payload.`;
    seenNames.add(item.name);
    if (varsByName.has(item.name)) return `${item.name} already exists. Rerun plan_ds_variable_creations.`;
    const collection = collectionsById.get(item.collectionId);
    if (!collection || collection.name !== item.collection) return `${item.name} collection ${item.collection} is stale or missing. Rerun plan_ds_variable_creations.`;
    for (const modeValue of item.modeValues) {
      const mode = (collection.modes || []).find(mode => mode.modeId === modeValue.modeId && (mode.name || mode.modeId) === modeValue.mode);
      if (!mode) return `${item.name} mode ${modeValue.mode} is stale or missing. Rerun plan_ds_variable_creations.`;
      if (modeValue.kind === "alias") {
        const target = varsById.get(modeValue.targetId);
        if (!target || target.name !== modeValue.targetName || target.resolvedType !== item.type) {
          return `${item.name} alias target ${modeValue.targetName || modeValue.targetId} is stale, missing, or the wrong type. Rerun plan_ds_variable_creations.`;
        }
      } else if (modeValue.kind !== "literal") {
        return `${item.name} mode ${modeValue.mode} has invalid value kind ${modeValue.kind}.`;
      }
    }
  }
  return null;
}

function _applyKey(item) {
  return _stableJson(item);
}

function handleApplyDsVariableCreations(args = {}) {
  const variableCreations = _normalizeVariableCreations(args.variableCreations);
  if (!variableCreations.length) {
    return Promise.resolve({ error: "Provide variableCreations copied from plan_ds_variable_creations.repairPlan.applyInput." });
  }
  const dataSource = _loadDataSource(args);
  if (!dataSource) {
    return Promise.resolve({ error: "No synced Figma snapshot found. Run sync_figma_data, then rerun plan_ds_variable_creations and apply the fresh repairPlan.applyInput." });
  }
  const validationError = _validateVariableCreationsAgainstSnapshot(variableCreations, dataSource.figmaData);
  if (validationError) {
    return Promise.resolve({ error: `Invalid variable creation payload: ${validationError}` });
  }
  const keys = new Set(variableCreations.map(_applyKey));
  if (keys.size !== variableCreations.length) {
    return Promise.resolve({ error: "Invalid variable creation payload: duplicate entries are not allowed." });
  }
  const operations = variableCreations.map(item => ({
    kind: "create_variable",
    name: item.name,
    collection: item.collection,
    collectionId: item.collectionId,
    type: item.type,
    modeValues: item.modeValues,
  }));
  return handleApplyDsFigmaOperations({
    figmaDataPath: args.figmaDataPath,
    bridgeHookFile: args.bridgeHookFile,
    bridgeTransport: args.bridgeTransport,
    operations,
  }).then((result) => {
    if (result.error) return result;
    return {
      created: (result.applied || []).filter(item => item.kind === "create_variable").map(item => ({
        name: item.name,
        id: item.id,
        collection: item.collection,
        type: item.type,
        modeValues: item.modeValues,
      })),
      skipped: result.skipped || [],
      unresolved: result.unresolved || [],
      message: `${result.message || "Variable creation complete."}`,
      verificationInstruction: result.verificationInstruction,
    };
  });
}

module.exports = {
  planDsVariableCreationsTool,
  applyDsVariableCreationsTool,
  planDsVariableCreationsFromFigmaData,
  handlePlanDsVariableCreations,
  handleApplyDsVariableCreations,
  _normalizeVariableCreations,
  _validateVariableCreationsAgainstSnapshot,
};
