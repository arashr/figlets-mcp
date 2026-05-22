#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  REPO_ROOT,
  assertPluginReleaseAlignment,
  smokeAgentInterfaceTools,
} = require("./lib/agent-interface-smoke.js");
const { withMcpStdioSession, parseToolCallPayload } = require("../tests/helpers/mcp-stdio-client.js");

const args = new Set(process.argv.slice(2));
const useWorkspace = args.has("--workspace");
const skipBuild = args.has("--skip-build");

function run(command, commandArgs, options = {}) {
  const result = childProcess.spawnSync(command, commandArgs, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: options.stdio || "pipe",
    env: options.env || process.env,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${commandArgs.join(" ")} failed with ${result.status}\n${output}`);
  }
  return result;
}

function extractTarball(tarballPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-plugin-smoke-"));
  run("tar", ["-xzf", tarballPath, "-C", tmp]);
  return { tmp, packageDir: path.join(tmp, "package") };
}

function buildMcpSmokeEnv() {
  return Object.assign({}, process.env, {
    NODE_PATH: [path.join(REPO_ROOT, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
    FIGLETS_SKIP_RECEIVER: "1",
  });
}

async function smokePackedServer(packageDir) {
  const env = buildMcpSmokeEnv();
  await withMcpStdioSession(
    {
      serverEntry: path.join(packageDir, "bin", "figlets-mcp.js"),
      cwd: packageDir,
      env,
    },
    session => smokeAgentInterfaceTools(session, parseToolCallPayload)
  );
}

async function smokeWorkspaceServer() {
  const packageDir = path.join(REPO_ROOT, "packages", "figlets-mcp-server");
  await withMcpStdioSession(
    {
      serverEntry: path.join(packageDir, "bin", "figlets-mcp.js"),
      cwd: REPO_ROOT,
      env: Object.assign({}, process.env, { FIGLETS_SKIP_RECEIVER: "1" }),
    },
    session => smokeAgentInterfaceTools(session, parseToolCallPayload)
  );
}

async function main() {
  const alignment = assertPluginReleaseAlignment();
  const lines = [
    "",
    "Plugin host smoke: OK",
    `  Server version: ${alignment.version}`,
    "  Claude/Codex tarball URLs: aligned",
  ];

  if (useWorkspace) {
    await smokeWorkspaceServer();
    lines.push("  Agent Interface MCP smoke (workspace server): OK");
  } else {
    if (!skipBuild) {
      run(process.execPath, [path.join(REPO_ROOT, "scripts", "build-server-tarball.js")], { stdio: "inherit" });
    }
    const tarballPath = path.join(REPO_ROOT, "dist", `figlets-mcp-server-${alignment.version}.tgz`);
    assert.ok(fs.existsSync(tarballPath), `expected release tarball at dist/figlets-mcp-server-${alignment.version}.tgz`);
    const extracted = extractTarball(tarballPath);
    try {
      await smokePackedServer(extracted.packageDir);
      lines.push("  Agent Interface MCP smoke (packed server): OK");
    } finally {
      fs.rmSync(extracted.tmp, { recursive: true, force: true });
    }
  }

  lines.push(
    "",
    "Manual host checks (not automated here):",
    "  Claude Code: restart after plugin/setup changes, run /figlets:start or a designer phrase, confirm figlets MCP tools appear.",
    "  Codex: restart after plugin install, confirm the Figlets plugin MCP server connects from the local marketplace.",
    ""
  );
  process.stdout.write(lines.join("\n"));
}

main().catch(err => {
  process.stderr.write(`Plugin host smoke FAILED\n${err.stack || err.message}\n`);
  process.exit(1);
});
