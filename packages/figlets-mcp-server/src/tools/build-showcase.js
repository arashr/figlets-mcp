const http = require("http");

const buildShowcaseTool = {
  name: "build_ds_showcase",
  description:
    "Renders a full design-system token showcase directly in Figma — color ramps, semantic color pairs with WCAG contrast, typography table, spacing scale, elevation, and scrims. All rendering happens inside the Figma plugin. Requires sync_figma_data to have been run first (plugin must be open).",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};

function handleBuildShowcase() {
  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || "http://localhost:1337";

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${receiverUrl}/request-showcase`,
      { method: "POST" },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode === 200) {
            let parsed;
            try { parsed = JSON.parse(body); } catch { parsed = {}; }
            const result = parsed.result || parsed;
            resolve({
              content: [{
                type: "text",
                text: JSON.stringify({
                  sections: result.sections || [],
                  layout: result.layout || "horizontal",
                  message: `Showcase built — ${(result.sections || []).length} section(s) rendered on page '00 · Tokens'.`
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

    req.setTimeout(130000, () => {
      req.destroy();
      reject(new Error("Request to bridge receiver timed out"));
    });

    req.end();
  });
}

module.exports = { buildShowcaseTool, handleBuildShowcase };
