const fs = require("fs");
const path = require("path");
const http = require("http");
const { inspectComponentData } = require("../figlets-core.js");

const inspectComponentTool = {
  name: "inspect_component",
  description: "Inspects the user's currently selected component or frame in Figma. Returns structural data, auto-layout settings, and variant properties. Requires the Figma bridge plugin to be running.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

function _attemptInspect(receiverUrl) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      receiverUrl + "/request-selection",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const responseData = JSON.parse(body);
              const selectionPath = responseData.path;
              if (!fs.existsSync(selectionPath)) throw new Error("Selection data file was not created.");
              const parsedData = JSON.parse(fs.readFileSync(selectionPath, "utf-8"));
              const result = inspectComponentData({ target: "figma-selection", selection: parsedData.selection || [] });
              resolve({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
            } catch (err) {
              reject(new Error(`Failed to parse selection data: ${err.message}`));
            }
          } else {
            const err = new Error(`Selection sync failed with status ${res.statusCode}: ${body}`);
            err.statusCode = res.statusCode;
            reject(err);
          }
        });
      }
    );
    req.on("error", (err) => reject(new Error(`Failed to contact local receiver: ${err.message}`)));
    req.end();
  });
}

function handleInspectComponent() {
  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || "http://localhost:1337";
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;

  function attempt(n) {
    return _attemptInspect(receiverUrl).catch((err) => {
      const retryable = err.statusCode === 503 || err.statusCode === 504;
      if (retryable && n < MAX_RETRIES) {
        return new Promise((res) => setTimeout(res, RETRY_DELAY_MS)).then(() => attempt(n + 1));
      }
      throw err;
    });
  }

  return attempt(1);
}

module.exports = {
  inspectComponentTool,
  handleInspectComponent
};
