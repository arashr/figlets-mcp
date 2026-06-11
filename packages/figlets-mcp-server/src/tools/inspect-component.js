const fs = require("fs");
const { inspectComponentData } = require("../figlets-core.js");
const { requestBridgePost } = require("../bridges/bridge-request.js");

const inspectComponentTool = {
  name: "inspect_component",
  description: "Inspects the user's currently selected component or frame in Figma. Returns structural data, auto-layout settings, and variant properties. Requires the Figma bridge plugin to be running.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

function _attemptInspect() {
  return requestBridgePost("/request-selection", {}, { timeoutMs: 16000 }).then((response) => {
    if (response.connectionError) {
      throw new Error(response.connectionError);
    }
    if (response.statusCode !== 200) {
      const err = new Error(`Selection sync failed with status ${response.statusCode}: ${response.raw}`);
      err.statusCode = response.statusCode;
      throw err;
    }

    try {
      const responseData = response.data || {};
      const selectionPath = responseData.path;
      if (!fs.existsSync(selectionPath)) throw new Error("Selection data file was not created.");
      const parsedData = JSON.parse(fs.readFileSync(selectionPath, "utf-8"));
      const result = inspectComponentData({ target: "figma-selection", selection: parsedData.selection || [] });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      throw new Error(`Failed to parse selection data: ${err.message}`);
    }
  });
}

function handleInspectComponent() {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;

  function attempt(n) {
    return _attemptInspect().catch((err) => {
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
