const path = require("path");

const {
  assertPluginReleaseAlignment,
  smokeAgentInterfaceTools,
} = require("../../scripts/lib/agent-interface-smoke.js");
const { withMcpStdioSession, parseToolCallPayload } = require("../helpers/mcp-stdio-client.js");

const ROOT = path.resolve(__dirname, "../..");

module.exports = (async () => {
  assertPluginReleaseAlignment();

  await withMcpStdioSession(
    {
      serverEntry: path.join(ROOT, "packages", "figlets-mcp-server", "bin", "figlets-mcp.js"),
      cwd: ROOT,
      env: Object.assign({}, process.env, { FIGLETS_SKIP_RECEIVER: "1" }),
    },
    session => smokeAgentInterfaceTools(session, parseToolCallPayload)
  );
})();
