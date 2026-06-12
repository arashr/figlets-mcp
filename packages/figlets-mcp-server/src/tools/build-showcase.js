const fs = require("fs");
const { getActiveFileConfigPath } = require("../utils/paths.js");
const { ensureActiveDsConfig } = require("../utils/ensure-ds-config.js");
const { requestBridgePost } = require("../bridges/bridge-request.js");

const buildShowcaseTool = {
  name: "build_ds_showcase",
  description:
    "Renders a full design-system token showcase directly in Figma — color ramps, semantic color pairs with WCAG contrast, typography table, spacing scale, elevation, and scrims. All rendering happens inside the Figma plugin. Requires sync_figma_data to have been run first (plugin must be open).",
  inputSchema: {
    type: "object",
    properties: {
      numericFallback: {
        type: "object",
        description: "Optional numeric fallback policy for generated showcase chrome when no exact variable exists. Colors never use nearest-neighbor matching.",
        properties: {
          radius: { type: "string", enum: ["exact", "nearest", "floor", "ceil"] },
          border: { type: "string", enum: ["exact", "nearest", "floor", "ceil"] },
          spacing: { type: "string", enum: ["exact", "nearest", "floor", "ceil"] },
          maxDistance: { type: "number", minimum: 0 }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  }
};

function handleBuildShowcase(args = {}) {
  let dsPayload = null;
  const configStatus = ensureActiveDsConfig({ reason: "build-showcase", refreshGenerated: true });
  try {
    const vm = require("vm");
    const configPath = configStatus.configPath || getActiveFileConfigPath();
    if (configPath && fs.existsSync(configPath)) {
      const src = fs.readFileSync(configPath, "utf8")
        .replace(/^\s*(const|let|var)\s+DS\s*=/m, "DS =");
      const ctx = {};
      vm.runInNewContext(src, ctx);
      if (ctx.DS) {
        dsPayload = {};
        if (ctx.DS.collections) dsPayload.collections = ctx.DS.collections;
        if (ctx.DS.color) {
          dsPayload.color = {};
          if (ctx.DS.color.contrastAlgorithm) dsPayload.color.contrastAlgorithm = ctx.DS.color.contrastAlgorithm;
          if (ctx.DS.color.semantics) dsPayload.color.semantics = ctx.DS.color.semantics;
        }
      }
    }
  } catch (_) {}

  const payload = {
    numericFallback: args.numericFallback || null,
    DS: dsPayload || undefined
  };

  return requestBridgePost("/request-showcase", payload, { timeoutMs: 115000 }).then((response) => {
    if (response.connectionError) {
      throw new Error(response.connectionError);
    }
    if (response.statusCode === 200) {
      const parsed = response.data || {};
      const result = parsed.result || parsed;
      if (result.error) {
        return {
          content: [{ type: "text", text: `Plugin error: ${result.error}` }],
          isError: true
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sections: result.sections || [],
            layout: result.layout || "horizontal",
            bindingWarnings: Array.isArray(result.bindingWarnings) ? result.bindingWarnings : [],
            config: {
              path: configStatus.configPath || null,
              created: Boolean(configStatus.created),
              refreshed: Boolean(configStatus.refreshed),
              sourceMode: dsPayload ? "config-backed" : "inferred-from-figma",
              message: configStatus.message || null,
            },
            message: `Showcase built — ${(result.sections || []).length} section(s) rendered on page '00 · Tokens'.`,
          }, null, 2)
        }]
      };
    }
    if (response.statusCode === 503) {
      return {
        content: [{ type: "text", text: "Error: Figma plugin is not connected. Open the Figlets Bridge plugin in Figma Desktop, then retry." }],
        isError: true
      };
    }
    if (response.statusCode === 504) {
      return {
        content: [{ type: "text", text: "Error: Showcase build timed out. The Figma file may be too large or the plugin may have crashed." }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: `Error: Unexpected status ${response.statusCode}: ${response.raw}` }],
      isError: true
    };
  });
}

module.exports = { buildShowcaseTool, handleBuildShowcase };
