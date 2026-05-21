const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const originalLocalDir = process.env.FIGLETS_LOCAL_DIR;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-config-guard-"));
process.env.FIGLETS_LOCAL_DIR = tmp;

const modules = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js",
  "../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js",
  "../../packages/figlets-mcp-server/src/tools/update-ds-primitives.js",
  "../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js",
  "../../packages/figlets-mcp-server/src/tools/update-ds-tokens.js",
  "../../packages/figlets-mcp-server/src/tools/apply-ds-foundation-repairs.js",
];

for (const mod of modules) delete require.cache[require.resolve(mod)];

const flatConfigPath = path.join(tmp, "design-system.config.js");
fs.writeFileSync(path.join(tmp, "active-file.json"), JSON.stringify({ fileKey: "", updatedAt: "now" }));
fs.writeFileSync(flatConfigPath, "const DS = {};\n");

const { getConfigPathGuardError } = require("../../packages/figlets-mcp-server/src/utils/paths.js");
const { handlePrepareDsConfig } = require("../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js");
const { handleApplyDsSetup } = require("../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js");
const { handleUpdateDsPrimitives } = require("../../packages/figlets-mcp-server/src/tools/update-ds-primitives.js");
const { handleInspectDsTokenGaps } = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");
const { handleUpdateDsTokens } = require("../../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");
const { handleApplyDsFoundationRepairs } = require("../../packages/figlets-mcp-server/src/tools/apply-ds-foundation-repairs.js");

function assertGuard(result, label) {
  assert.ok(result && result.error, label + " should refuse the flat config");
  assert.ok(/no fileKey/.test(result.error), label + " should explain missing fileKey");
  assert.ok(/\.local\/<fileKey>\/design-system\.config\.js/.test(result.hint), label + " should point to the per-file config path");
}

assertGuard(getConfigPathGuardError(flatConfigPath), "paths guard");
assertGuard(handlePrepareDsConfig({ config_path: flatConfigPath }), "prepare_ds_config");

module.exports = Promise.all([
  handleApplyDsSetup({ config_path: flatConfigPath }).then(result => assertGuard(result, "apply_ds_setup")),
  handleUpdateDsPrimitives({ config_path: flatConfigPath }).then(result => assertGuard(result, "update_ds_primitives")),
  Promise.resolve(handleInspectDsTokenGaps({ config_path: flatConfigPath, figmaData: { variables: [] } })).then(result => assertGuard(result, "inspect_ds_token_gaps")),
  Promise.resolve(handleUpdateDsTokens({ config_path: flatConfigPath, figmaData: { variables: [] }, dry_run: true })).then(result => assertGuard(result, "update_ds_tokens")),
  handleApplyDsFoundationRepairs({ config_path: flatConfigPath, collections: [{ kind: "spacing", name: "4. Spacing" }] }).then(result => assertGuard(result, "apply_ds_foundation_repairs")),
]).then(() => {
  fs.writeFileSync(path.join(tmp, "active-file.json"), JSON.stringify({ fileKey: "local_abc123", updatedAt: "now" }));
  const namespacedConfigPath = path.join(tmp, "local_abc123", "design-system.config.js");
  assert.ok(getConfigPathGuardError(flatConfigPath).error, "flat config should be refused even with an active file key");
  assert.strictEqual(getConfigPathGuardError(namespacedConfigPath), null, "active per-file config should be allowed");
}).finally(() => {
  if (originalLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
  else process.env.FIGLETS_LOCAL_DIR = originalLocalDir;
  for (const mod of modules) delete require.cache[require.resolve(mod)];
  try { fs.unlinkSync(path.join(tmp, "active-file.json")); } catch (err) {}
  try { fs.unlinkSync(flatConfigPath); } catch (err) {}
  try { fs.rmdirSync(path.join(tmp, "local_abc123")); } catch (err) {}
  try { fs.rmdirSync(tmp); } catch (err) {}
});
