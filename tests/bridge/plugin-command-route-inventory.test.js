const assert = require("assert");
const fs = require("fs");
const path = require("path");

const receiverPath = path.resolve(__dirname, "../../packages/figma-bridge-plugin/src/receiver.js");
const pluginPath = path.resolve(__dirname, "../../packages/figma-bridge-plugin/code.js");

const receiver = fs.readFileSync(receiverPath, "utf8");
const plugin = fs.readFileSync(pluginPath, "utf8");
const routeTableMatch = /const BRIDGE_COMMAND_ROUTES = \[([\s\S]*?)\];/.exec(receiver);
assert.ok(routeTableMatch, "receiver must define BRIDGE_COMMAND_ROUTES");
const routeTable = routeTableMatch[1];

const expectedRoutes = [
  ["/request-showcase", "/sync-showcase", "build-showcase"],
  ["/request-doc-build", "/sync-doc-build", "build-doc"],
  ["/request-qa-audit", "/sync-qa-audit", "qa-audit"],
  ["/request-ds-setup", "/sync-ds-setup", "apply-ds-setup"],
  ["/request-update-primitives", "/sync-update-primitives", "update-primitives"],
  ["/request-update-tokens", "/sync-update-tokens", "update-tokens"],
  ["/request-foundation-repairs", "/sync-foundation-repairs", "apply-foundation-repairs"],
  ["/request-setup-repairs", "/sync-setup-repairs", "apply-setup-repairs"],
  ["/request-semantic-naming-consolidation", "/sync-semantic-naming-consolidation", "apply-semantic-naming-consolidation"],
  ["/request-figma-operations", "/sync-figma-operations", "apply-figma-operations"],
  ["/request-reset-figlets-file", "/sync-reset-figlets-file", "reset-figlets-file"],
  ["/request-remove-text-styles", "/sync-remove-text-styles", "remove-text-styles"],
  ["/request-trim-collection-modes", "/sync-trim-collection-modes", "trim-collection-modes"],
  ["/request-prepare-broken-ds-fixture", "/sync-prepare-broken-ds-fixture", "prepare-broken-ds-fixture"],
];

function literalRegex(name, value) {
  return new RegExp(name + ":\\s*'" + value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "'");
}

for (const [requestPath, syncPath, command] of expectedRoutes) {
  assert.ok(literalRegex("requestPath", requestPath).test(routeTable), `receiver must expose ${requestPath}`);
  assert.ok(literalRegex("syncPath", syncPath).test(routeTable), `receiver must expose ${syncPath}`);
  assert.ok(literalRegex("command", command).test(routeTable), `receiver route ${requestPath} must dispatch ${command}`);
  assert.ok(
    plugin.includes("msg.type === '" + command + "'"),
    `plugin must handle receiver command ${command}`
  );
}

const requestPaths = Array.from(routeTable.matchAll(/requestPath:\s*'([^']+)'/g)).map(match => match[1]);
const syncPaths = Array.from(routeTable.matchAll(/syncPath:\s*'([^']+)'/g)).map(match => match[1]);
const commands = Array.from(routeTable.matchAll(/command:\s*'([^']+)'/g)).map(match => match[1]);

assert.deepStrictEqual(
  requestPaths,
  expectedRoutes.map(route => route[0]),
  "receiver request route inventory changed; update route matrix tests before pruning"
);
assert.deepStrictEqual(
  syncPaths,
  expectedRoutes.map(route => route[1]),
  "receiver sync route inventory changed; update route matrix tests before pruning"
);
assert.deepStrictEqual(
  commands,
  expectedRoutes.map(route => route[2]),
  "receiver command inventory changed; update plugin command tests before pruning"
);

assert.ok(plugin.includes("msg.type === 'extract-all'"), "plugin must handle global sync command");
assert.ok(plugin.includes("msg.type === 'extract-selection'"), "plugin must handle selection sync command");
