const https = require("https");

function parseFigmaFileKey(input) {
  if (!input || typeof input !== "string") {
    throw new Error("A Figma file URL or key is required.");
  }

  const trimmed = input.trim();

  if (/^[A-Za-z0-9]+$/.test(trimmed) && trimmed.indexOf("/") === -1) {
    return trimmed;
  }

  const branchMatch = trimmed.match(/figma\.com\/(?:design|file)\/[^/]+\/branch\/([^/]+)/i);
  if (branchMatch) {
    return branchMatch[1];
  }

  const fileMatch = trimmed.match(/figma\.com\/(?:design|file)\/([^/?#]+)/i);
  if (fileMatch) {
    return fileMatch[1];
  }

  throw new Error("Could not parse a Figma file key from the provided input.");
}

function readToken() {
  return process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN || "";
}

function createHeaders(token) {
  return {
    "X-Figma-Token": token,
    "Content-Type": "application/json",
    "User-Agent": "figlets-mcp/0.1.0"
  };
}

function requestJson(pathname, token) {
  const options = {
    hostname: "api.figma.com",
    path: pathname,
    method: "GET",
    headers: createHeaders(token)
  };

  return new Promise(function(resolve, reject) {
    const req = https.request(options, function(res) {
      let body = "";

      res.on("data", function(chunk) {
        body += chunk;
      });

      res.on("end", function() {
        let parsed;

        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (error) {
          reject(new Error("Failed to parse Figma API response JSON."));
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
          return;
        }

        const message = parsed.message || parsed.err || ("Request failed with status " + res.statusCode + ".");
        const error = new Error(message);
        error.statusCode = res.statusCode;
        error.payload = parsed;
        reject(error);
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function collectStyles(fileResponse) {
  const stylesMap = fileResponse.styles || {};
  const textStyles = [];
  const effectStyles = [];

  Object.keys(stylesMap).forEach(function(styleId) {
    const style = stylesMap[styleId];
    const normalized = {
      id: styleId,
      key: style.key || null,
      name: style.name || styleId,
      styleType: style.style_type || style.styleType || null
    };

    if (normalized.styleType === "TEXT") {
      textStyles.push(normalized);
    }

    if (normalized.styleType === "EFFECT") {
      effectStyles.push(normalized);
    }
  });

  textStyles.sort(function(left, right) {
    return left.name.localeCompare(right.name);
  });

  effectStyles.sort(function(left, right) {
    return left.name.localeCompare(right.name);
  });

  return {
    textStyles: textStyles,
    effectStyles: effectStyles
  };
}

function normalizeVariablesResponse(variablesResponse) {
  const meta = variablesResponse.meta || {};
  const variablesMap = meta.variables || {};
  const collectionsMap = meta.variableCollections || {};
  const variables = [];
  const collections = [];

  Object.keys(variablesMap).forEach(function(variableId) {
    const variable = variablesMap[variableId];
    variables.push({
      id: variable.id,
      name: variable.name,
      key: variable.key || null,
      variableCollectionId: variable.variableCollectionId,
      resolvedType: variable.resolvedType,
      valuesByMode: variable.valuesByMode || {},
      remote: Boolean(variable.remote),
      description: variable.description || "",
      hiddenFromPublishing: Boolean(variable.hiddenFromPublishing),
      scopes: Array.isArray(variable.scopes) ? variable.scopes : [],
      codeSyntax: variable.codeSyntax || {}
    });
  });

  Object.keys(collectionsMap).forEach(function(collectionId) {
    const collection = collectionsMap[collectionId];
    collections.push({
      id: collection.id,
      name: collection.name,
      key: collection.key || null,
      modes: Array.isArray(collection.modes) ? collection.modes : [],
      defaultModeId: collection.defaultModeId || null,
      remote: Boolean(collection.remote),
      hiddenFromPublishing: Boolean(collection.hiddenFromPublishing),
      variableIds: Array.isArray(collection.variableIds) ? collection.variableIds : [],
      isExtension: Boolean(collection.isExtension),
      deletedButReferenced: Boolean(collection.deletedButReferenced)
    });
  });

  variables.sort(function(left, right) {
    return left.name.localeCompare(right.name);
  });

  collections.sort(function(left, right) {
    return left.name.localeCompare(right.name);
  });

  return {
    variables: variables,
    collections: collections
  };
}

async function exportFigmaFile(input) {
  const token = readToken();

  if (!token) {
    throw new Error("Missing Figma access token. Set FIGMA_ACCESS_TOKEN or FIGMA_TOKEN.");
  }

  const fileKey = parseFigmaFileKey(input.file);
  const fileResponse = await requestJson("/v1/files/" + fileKey + "?branch_data=true", token);
  const styles = collectStyles(fileResponse);
  const warnings = [];
  let variables = [];
  let collections = [];

  try {
    const variablesResponse = await requestJson("/v1/files/" + fileKey + "/variables/local", token);
    const normalized = normalizeVariablesResponse(variablesResponse);
    variables = normalized.variables;
    collections = normalized.collections;
  } catch (error) {
    if (error.statusCode === 403) {
      warnings.push(
        "Variables API was unavailable for this token or plan. Continuing with file content only."
      );
    } else {
      warnings.push("Variables export failed: " + error.message);
    }
  }

  return {
    target: input.file,
    source: "figma-rest",
    file: {
      key: fileKey,
      name: fileResponse.name || null,
      lastModified: fileResponse.lastModified || null,
      version: fileResponse.version || null,
      editorType: fileResponse.editorType || null
    },
    variables: variables,
    collections: collections,
    textStyles: styles.textStyles,
    effectStyles: styles.effectStyles,
    warnings: warnings
  };
}

module.exports = {
  collectStyles: collectStyles,
  exportFigmaFile: exportFigmaFile,
  normalizeVariablesResponse: normalizeVariablesResponse,
  parseFigmaFileKey: parseFigmaFileKey
};
