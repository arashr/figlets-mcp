#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_PKG_PATH = path.join(REPO_ROOT, "packages", "figlets-mcp-server", "package.json");
const DIST_DIR = path.join(REPO_ROOT, "dist");
const {
  assertPluginReleaseAlignment,
  smokeAgentInterfaceTools,
} = require("./lib/agent-interface-smoke.js");
const { withMcpStdioSession, parseToolCallPayload } = require("../tests/helpers/mcp-stdio-client.js");

const REQUIRED_TOOLS = [
  "figlets_start",
  "figlets_route_intent",
  "figlets_workflow_guide",
  "inspect_ds_token_gaps",
  "update_ds_tokens",
  "apply_ds_foundation_repairs",
];

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const skipSmoke = args.has("--skip-smoke");

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

function listTarball(tarballPath) {
  const result = run("tar", ["-tzf", tarballPath]);
  return result.stdout.split("\n").filter(Boolean);
}

function assertTarballContents(entries) {
  const required = [
    "package/package.json",
    "package/bin/figlets-mcp.js",
    "package/src/index.js",
    "package/src/figlets-core.js",
    "package/src/figma-bridge-plugin/receiver.js",
    "package/node_modules/@figlets/core/package.json",
    "package/node_modules/@figlets/core/src/index.js",
  ];
  for (const entry of required) {
    assert.ok(entries.includes(entry), `release tarball must include ${entry}`);
  }
  assert.ok(
    entries.some(entry => entry.startsWith("package/node_modules/@figlets/core/src/")),
    "release tarball must bundle @figlets/core source files"
  );
}

function extractTarball(tarballPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-release-verify-"));
  run("tar", ["-xzf", tarballPath, "-C", tmp]);
  return tmp;
}

function assertExtractedPackage(packageDir, expectedVersion) {
  const pkgPath = path.join(packageDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  assert.strictEqual(pkg.name, "@figlets/mcp-server", "packed package name should stay stable");
  assert.strictEqual(pkg.version, expectedVersion, "packed package version should match server package");
  assert.strictEqual(pkg.bin && pkg.bin["figlets-mcp"], "bin/figlets-mcp.js", "packed package must expose figlets-mcp bin");
  assert.ok(pkg.dependencies && pkg.dependencies["@figlets/core"], "packed package must depend on bundled @figlets/core");
  assert.ok(pkg.dependencies && pkg.dependencies["@modelcontextprotocol/sdk"], "packed package must declare MCP SDK dependency");
  assert.ok(pkg.dependencies && pkg.dependencies.zod, "packed package must declare zod dependency");
  assert.ok(
    Array.isArray(pkg.bundleDependencies) && pkg.bundleDependencies.includes("@figlets/core"),
    "packed package must bundle @figlets/core"
  );
}

async function smokeMcpServer(packageDir) {
  const env = Object.assign({}, process.env, {
    NODE_PATH: [path.join(REPO_ROOT, "node_modules"), process.env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter),
    FIGLETS_SKIP_RECEIVER: "1",
  });

  await withMcpStdioSession(
    {
      serverEntry: path.join(packageDir, "bin", "figlets-mcp.js"),
      cwd: packageDir,
      env,
    },
    async session => {
      session.send(2, "tools/list", {});
      const listResponse = await session.waitForResponse(2);
      assert.ok(!listResponse.error, `tools/list should not error: ${JSON.stringify(listResponse.error)}`);
      const toolNames = listResponse.result.tools.map(tool => tool.name);
      for (const tool of REQUIRED_TOOLS) {
        assert.ok(toolNames.includes(tool), `packed tools/list should expose ${tool}`);
      }
      await smokeAgentInterfaceTools(session, parseToolCallPayload);
    }
  );
}

async function main() {
  assertPluginReleaseAlignment();
  const serverPkg = JSON.parse(fs.readFileSync(SERVER_PKG_PATH, "utf-8"));
  const tarballName = `figlets-mcp-server-${serverPkg.version}.tgz`;
  const tarballPath = path.join(DIST_DIR, tarballName);

  if (!skipBuild) {
    run(process.execPath, [path.join(REPO_ROOT, "scripts", "build-server-tarball.js")], { stdio: "inherit" });
  }

  assert.ok(fs.existsSync(tarballPath), `expected release tarball at ${path.relative(REPO_ROOT, tarballPath)}`);
  const entries = listTarball(tarballPath);
  assertTarballContents(entries);

  const tmp = extractTarball(tarballPath);
  try {
    const packageDir = path.join(tmp, "package");
    assertExtractedPackage(packageDir, serverPkg.version);
    if (!skipSmoke) {
      await smokeMcpServer(packageDir);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  process.stdout.write([
    "",
    "Release package verification: OK",
    `  Tarball: dist/${tarballName}`,
    `  Required tools: ${REQUIRED_TOOLS.join(", ")}`,
    skipSmoke ? "  Packed MCP smoke: skipped" : "  Packed MCP smoke (tools/list + Agent Interface): OK",
    "",
  ].join("\n"));
}

main().catch(err => {
  process.stderr.write(`Release package verification FAILED\n${err.stack || err.message}\n`);
  process.exit(1);
});
