function toHexComponent(value) {
  return Math.round(value * 255).toString(16).padStart(2, "0");
}

function toObjectByName(items, keyName) {
  const output = {};

  for (const item of items) {
    output[item[keyName]] = item;
  }

  return output;
}

function toHex(color) {
  if (!color || typeof color !== "object") {
    return null;
  }

  if (!("r" in color) || !("g" in color) || !("b" in color)) {
    return null;
  }

  return `#${toHexComponent(color.r)}${toHexComponent(color.g)}${toHexComponent(color.b)}`;
}

function groupByPath(variables, depth) {
  const groups = {};

  for (const variable of variables) {
    const parts = String(variable.name !== undefined ? variable.name : "").split("/");
    const key = depth === undefined
      ? (parts.length > 1 ? parts.slice(0, -1).join("/") : "")
      : parts.slice(0, depth).join("/");

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(variable);
  }

  return groups;
}

function resolveVariableValue(variable, varsById, depth = 0) {
  if (!variable || depth > 8) {
    return null;
  }

  const modeIds = Object.keys(variable.valuesByMode || {});
  const modeId = modeIds[0];
  const value = modeId ? variable.valuesByMode[modeId] : null;

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object" && value.type === "VARIABLE_ALIAS") {
    return resolveVariableValue(varsById.get(value.id), varsById, depth + 1);
  }

  return value;
}

function analyzeCollections(variables = [], collections = []) {
  const varsById = new Map(variables.map(variable => [variable.id, variable]));
  const collectionIdSets = new Map(
    collections.map(collection => [collection.id, new Set(collection.variableIds || [])])
  );

  return [...collections]
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    .map(collection => {
      const collectionVariables = variables
        .filter(variable => (collection.variableIds || []).includes(variable.id))
        .sort((left, right) => String(left.name).localeCompare(String(right.name)));

      const colorVariables = collectionVariables.filter(variable => variable.resolvedType === "COLOR");
      const floatVariables = collectionVariables.filter(variable => variable.resolvedType === "FLOAT");
      const modeNames = (collection.modes || []).map(mode => mode.name);
      const idsInCollection = collectionIdSets.get(collection.id) || new Set();

      let selfAliasCount = 0;
      let crossAliasCount = 0;

      for (const variable of collectionVariables) {
        const modeId = Object.keys(variable.valuesByMode || {})[0];
        const rawValue = modeId ? variable.valuesByMode[modeId] : null;

        if (!rawValue || typeof rawValue !== "object" || rawValue.type !== "VARIABLE_ALIAS") {
          continue;
        }

        if (idsInCollection.has(rawValue.id)) {
          selfAliasCount += 1;
        } else {
          crossAliasCount += 1;
        }
      }

      const aliasCount = selfAliasCount + crossAliasCount;
      const hasLightMode = modeNames.some(name => /light|day|bright/i.test(name));
      const hasDarkMode = modeNames.some(name => /dark|night|dim/i.test(name));
      const hasLightDark = hasLightMode && hasDarkMode;
      const numericLeafCount = colorVariables.filter(variable => /^\d+$/.test(String(variable.name).split("/").pop())).length;
      const hasNumericSteps = colorVariables.length > 0 && numericLeafCount >= colorVariables.length * 0.3;
      const crossAliasRatio = collectionVariables.length > 0 ? crossAliasCount / collectionVariables.length : 0;
      const totalAliasRatio = collectionVariables.length > 0 ? aliasCount / collectionVariables.length : 0;
      const isPrimitive = collectionVariables.length > 0 && !hasLightDark && (
        hasNumericSteps
          ? crossAliasRatio < 0.3
          : totalAliasRatio < 0.2 && crossAliasRatio < 0.1
      );
      const isAlias = collectionVariables.length > 0 && (
        hasLightDark || crossAliasRatio > 0.4 || (!hasNumericSteps && totalAliasRatio > 0.7)
      );

      const rawColorGroups = groupByPath(colorVariables);
      const colorGroups = {};
      const colorGroupKeys = Object.keys(rawColorGroups).sort((left, right) => left.localeCompare(right));

      for (const key of colorGroupKeys) {
        colorGroups[key] = rawColorGroups[key].map(variable => variable.name);
      }

      return {
        id: collection.id,
        name: collection.name,
        modeNames,
        varCount: collectionVariables.length,
        colorVarCount: colorVariables.length,
        floatVarCount: floatVariables.length,
        aliasCount,
        selfAliasCount,
        crossAliasCount,
        isPrimitive,
        isAlias,
        hasLightDark,
        hasNumericSteps,
        hasMultipleModes: modeNames.length > 1,
        colorGroups,
        topLevelGroups: Object.keys(groupByPath(collectionVariables, 1)).sort(),
        variableNames: collectionVariables.map(variable => variable.name),
        resolvedValues: collectionVariables.map(variable => ({
          name: variable.name,
          resolvedType: variable.resolvedType,
          value: resolveVariableValue(variable, varsById)
        }))
      };
    });
}

function buildDesignSystemContext(variables = [], collections = [], textStyles = [], effectStyles = [], paintStyles = []) {
  const varsById = new Map(variables.map(variable => [variable.id, variable]));
  const varByName = toObjectByName(variables, "name");
  const colorVarByHex = {};
  const floatVarByValue = {};
  const typographyVarByValue = {};
  const spacingVarByValue = {};
  const typographyPattern = /font|size|line|tracking|letter|weight/i;
  const spacingPattern = /space|spacing|gap|padding|margin|radius|width|height|border/i;

  for (const variable of variables) {
    const resolvedValue = resolveVariableValue(variable, varsById);

    if (variable.resolvedType === "COLOR") {
      const hex = toHex(resolvedValue);
      if (!hex) {
        continue;
      }

      const existing = colorVarByHex[hex];
      if (!existing || String(variable.name).split("/").length < String(existing.name).split("/").length) {
        colorVarByHex[hex] = { name: variable.name, id: variable.id };
      }
    }

    if (variable.resolvedType === "FLOAT" && typeof resolvedValue === "number") {
      const existing = floatVarByValue[resolvedValue];
      if (!existing || String(variable.name).split("/").length > String(existing.name).split("/").length) {
        floatVarByValue[resolvedValue] = { name: variable.name, id: variable.id };
      }

      if (typographyPattern.test(variable.name)) {
        const typographyExisting = typographyVarByValue[resolvedValue];
        if (!typographyExisting || String(variable.name).split("/").length > String(typographyExisting.name).split("/").length) {
          typographyVarByValue[resolvedValue] = { name: variable.name, id: variable.id };
        }
      }

      if (spacingPattern.test(variable.name)) {
        const spacingExisting = spacingVarByValue[resolvedValue];
        if (!spacingExisting || String(variable.name).split("/").length > String(spacingExisting.name).split("/").length) {
          spacingVarByValue[resolvedValue] = { name: variable.name, id: variable.id };
        }
      }
    }
  }

  const collectionByName = toObjectByName(collections, "name");
  const textStyleByName = toObjectByName(textStyles, "name");
  const effectStyleByName = toObjectByName(effectStyles, "name");
  const paintStyleByName = toObjectByName(paintStyles, "name");
  const typographyStrategy = textStyles.length > 0
    ? "text-styles"
    : Object.keys(typographyVarByValue).length > 0
      ? "variables"
      : "none";

  return {
    counts: {
      variables: variables.length,
      collections: collections.length,
      textStyles: textStyles.length,
      effectStyles: effectStyles.length,
      paintStyles: paintStyles.length
    },
    typographyStrategy,
    keys: {
      variables: Object.keys(varByName).sort(),
      collections: Object.keys(collectionByName).sort(),
      textStyles: Object.keys(textStyleByName).sort(),
      effectStyles: Object.keys(effectStyleByName).sort(),
      paintStyles: Object.keys(paintStyleByName).sort()
    },
    indexes: {
      colorVarByHex,
      floatVarByValue,
      typographyVarByValue,
      spacingVarByValue
    }
  };
}

function analyzeDesignSystemData(input = {}) {
  const variables = Array.isArray(input.variables) ? input.variables : [];
  const collections = Array.isArray(input.collections) ? input.collections : [];
  const textStyles = Array.isArray(input.textStyles) ? input.textStyles : [];
  const effectStyles = Array.isArray(input.effectStyles) ? input.effectStyles : [];
  const paintStyles = Array.isArray(input.paintStyles) ? input.paintStyles : [];
  const analyzedCollections = analyzeCollections(variables, collections);
  const context = buildDesignSystemContext(variables, collections, textStyles, effectStyles, paintStyles);

  return {
    target: input.target !== undefined ? input.target : "unknown",
    collections: analyzedCollections,
    textStyles,
    effectStyles,
    paintStyles,
    context
  };
}

module.exports = {
  analyzeCollections,
  analyzeDesignSystemData,
  buildDesignSystemContext,
  groupByPath,
  resolveVariableValue,
  toHex
};
