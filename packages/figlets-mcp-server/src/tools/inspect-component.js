const fs = require("fs");
const { inspectComponentData } = require("../figlets-core.js");
const { requestBridgePost } = require("../bridges/bridge-request.js");
const { discoverComponentSpecs } = require("../utils/component-specs.js");

const inspectComponentTool = {
  name: "inspect_component",
  description: "Inspects the user's currently selected component or frame in Figma, or a discovered component targeted by component_id without changing selection. Returns structural data, auto-layout settings, variant properties, and a bounded nested-component dependency summary when nested instances exist. Existing Figlets component specs are recognized under project_path when provided, otherwise under the MCP server working directory. Requires the Figma bridge plugin to be running.",
  inputSchema: {
    type: "object",
    properties: {
      project_path: {
        type: "string",
        description: "Optional absolute path to the active code workspace/project root. Used only to recognize existing component-specs documentation during read-only inspection."
      },
      component_id: {
        type: "string",
        description: "Optional component ID returned by a previous nested-component inspection. Inspects that component in the current Figma file without changing the user's selection."
      }
    },
    required: []
  }
};

function _attemptInspect(args = {}) {
  return requestBridgePost("/request-selection", {
    componentId: args.component_id || ""
  }, {
    timeoutMs: 16000,
    bridgeRetryAttempts: 3
  }).then((response) => {
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
      const inspectInput = {
        target: "figma-selection",
        selection: parsedData.selection || []
      };
      let result = inspectComponentData(inspectInput);
      if (Array.isArray(result.nestedComponents) && result.nestedComponents.length > 0) {
        result = inspectComponentData(Object.assign({}, inspectInput, {
          componentSpecs: discoverComponentSpecs(args.project_path).specs
        }));
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      throw new Error(`Failed to parse selection data: ${err.message}`);
    }
  });
}

function handleInspectComponent(args = {}) {
  return _attemptInspect(args);
}

module.exports = {
  inspectComponentTool,
  handleInspectComponent
};
