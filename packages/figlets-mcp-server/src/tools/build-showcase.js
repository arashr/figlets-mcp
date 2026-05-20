const http = require("http");
const fs = require("fs");
const { getActiveFileConfigPath } = require("../utils/paths.js");
const { ensureActiveDsConfig } = require("../utils/ensure-ds-config.js");
const { getReceiverUrl } = require("../utils/receiver-url.js");

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
  const receiverUrl = getReceiverUrl();
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

  const payload = JSON.stringify({
    numericFallback: args.numericFallback || null,
    DS: dsPayload || undefined
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${receiverUrl}/request-showcase`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode === 200) {
            let parsed;
            try { parsed = JSON.parse(body); } catch { parsed = {}; }
            const result = parsed.result || parsed;
            if (result.error) {
              resolve({
                content: [{ type: "text", text: `Plugin error: ${result.error}` }],
                isError: true
              });
              return;
            }
            resolve({
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
            });
          } else if (res.statusCode === 503) {
            resolve({
              content: [{ type: "text", text: "Error: Figma plugin is not connected. Open the Figlets Bridge plugin in Figma Desktop, then retry." }],
              isError: true
            });
          } else if (res.statusCode === 504) {
            resolve({
              content: [{ type: "text", text: "Error: Showcase build timed out. The Figma file may be too large or the plugin may have crashed." }],
              isError: true
            });
          } else {
            resolve({
              content: [{ type: "text", text: `Error: Unexpected status ${res.statusCode}: ${body}` }],
              isError: true
            });
          }
        });
      }
    );

    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        reject(new Error("Bridge receiver is not running. MCP server should start it automatically — try restarting the MCP server."));
      } else {
        reject(err);
      }
    });

    req.setTimeout(115000, () => {
      req.destroy();
      reject(new Error("Request to bridge receiver timed out"));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { buildShowcaseTool, handleBuildShowcase };
