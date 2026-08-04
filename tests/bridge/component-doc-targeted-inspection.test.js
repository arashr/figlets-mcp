const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pluginCode = fs.readFileSync(
  path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"),
  "utf8",
);
const pluginUi = fs.readFileSync(
  path.join(__dirname, "../../packages/figma-bridge-plugin/ui.html"),
  "utf8",
);

assert.ok(pluginCode.includes("msg.data && msg.data.componentId"));
assert.ok(pluginCode.includes("figma.getNodeById(String(componentId))"));
assert.ok(pluginCode.includes("_comp = _findComponentNodeById(compId)"));
assert.ok(pluginCode.includes('source: "component-id"'));
assert.ok(pluginCode.includes("targetedComponentId: requestedComponentId || null"));
assert.ok(pluginUi.includes("type: 'extract-selection', data: data.data || {}"));
