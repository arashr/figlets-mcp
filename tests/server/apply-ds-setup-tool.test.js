const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const originalLocalDir = process.env.FIGLETS_LOCAL_DIR;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-apply-setup-"));
process.env.FIGLETS_LOCAL_DIR = tmp;

delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js")];

fs.writeFileSync(path.join(tmp, "active-file.json"), JSON.stringify({ fileKey: "", updatedAt: "now" }));
const flatConfigPath = path.join(tmp, "design-system.config.js");
fs.writeFileSync(flatConfigPath, "const DS = {};\nmodule.exports = DS;\n");

const { handleApplyDsSetup } = require("../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js");

module.exports = handleApplyDsSetup({ config_path: flatConfigPath }).then((result) => {
  assert.ok(result.error, "keyless active files must reject the legacy flat config");
  assert.ok(/no fileKey/.test(result.error), "error should explain the missing fileKey");
  assert.ok(/\.local\/<fileKey>\/design-system\.config\.js/.test(result.hint), "hint should point to per-file config");

  if (originalLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
  else process.env.FIGLETS_LOCAL_DIR = originalLocalDir;
  delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
  delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js")];
});
