const http = require("http");
const path = require("path");
const fs   = require("fs");

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
  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || "http://localhost:1337";

  let dsCollections = null;
  let dsContrastAlgorithm = null;
  try {
    const vm = require("vm");
    const configPath = path.resolve(process.cwd(), ".local/design-system.config.js");
    if (fs.existsSync(configPath)) {
      const src = fs.readFileSync(configPath, "utf8")
        .replace(/^\s*(const|let|var)\s+DS\s*=/m, "DS =");
      const ctx = {};
      vm.runInNewContext(src, ctx);
      if (ctx.DS && ctx.DS.collections) dsCollections = ctx.DS.collections;
      if (ctx.DS && ctx.DS.color && ctx.DS.color.contrastAlgorithm) dsContrastAlgorithm = ctx.DS.color.contrastAlgorithm;
    }
  } catch (_) {}

  const dsPayload = {};
  if (dsCollections) dsPayload.collections = dsCollections;
  if (dsContrastAlgorithm) dsPayload.color = { contrastAlgorithm: dsContrastAlgorithm };

  const payload = JSON.stringify({
    numericFallback: args.numericFallback || null,
    DS: Object.keys(dsPayload).length ? dsPayload : undefined
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
