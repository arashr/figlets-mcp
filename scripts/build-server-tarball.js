#!/usr/bin/env node
// Builds a SELF-CONTAINED @figlets/mcp-server tarball and prints how to attach
// it to a GitHub release. Host plugins point at that release asset via
// `npx -y <tarball-url>`, so no npm publish / npm account is needed.
//
// The server depends on the private workspace package @figlets/core, which is
// not published. We stage a copy of the server plus a vendored node_modules/
// @figlets/core and mark it as a bundleDependency so `npm pack` ships it inside
// the tarball. That makes `require("@figlets/core")` (via src/figlets-core.js)
// resolve when `npx` runs the tarball outside the monorepo.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(REPO_ROOT, "packages", "figlets-mcp-server");
const CORE_DIR = path.join(REPO_ROOT, "packages", "figlets-core");
const BRIDGE_RECEIVER_PATH = path.join(REPO_ROOT, "packages", "figma-bridge-plugin", "src", "receiver.js");
const DIST_DIR = path.join(REPO_ROOT, "dist");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === "node_modules") continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.copyFileSync(src, dest);
}

const serverPkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, "package.json"), "utf-8"));
const corePkg = JSON.parse(fs.readFileSync(path.join(CORE_DIR, "package.json"), "utf-8"));
const version = serverPkg.version;
const tarballName = `figlets-mcp-server-${version}.tgz`;
const tag = `v${version}`;

fs.mkdirSync(DIST_DIR, { recursive: true });

// Stage a self-contained copy: server files + vendored @figlets/core.
const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-tarball-"));
const stagingPkgDir = path.join(stagingRoot, "package");
try {
  fs.mkdirSync(stagingPkgDir, { recursive: true });
  for (const entry of ["bin", "src", "README.md"]) {
    const from = path.join(SERVER_DIR, entry);
    if (fs.existsSync(from)) copyRecursive(from, path.join(stagingPkgDir, entry));
  }
  fs.mkdirSync(path.join(stagingPkgDir, "src", "figma-bridge-plugin"), { recursive: true });
  fs.copyFileSync(BRIDGE_RECEIVER_PATH, path.join(stagingPkgDir, "src", "figma-bridge-plugin", "receiver.js"));

  // Vendor @figlets/core into the staged package's node_modules and mark it as
  // a bundleDependency so npm pack ships it inside the tarball.
  const vendoredCore = path.join(stagingPkgDir, "node_modules", "@figlets", "core");
  fs.mkdirSync(vendoredCore, { recursive: true });
  copyRecursive(path.join(CORE_DIR, "src"), path.join(vendoredCore, "src"));
  fs.copyFileSync(path.join(CORE_DIR, "package.json"), path.join(vendoredCore, "package.json"));

  const stagedPkg = Object.assign({}, serverPkg);
  stagedPkg.dependencies = Object.assign({}, serverPkg.dependencies, {
    "@figlets/core": corePkg.version,
  });
  stagedPkg.bundleDependencies = ["@figlets/core"];
  fs.writeFileSync(
    path.join(stagingPkgDir, "package.json"),
    JSON.stringify(stagedPkg, null, 2) + "\n"
  );

  const result = childProcess.spawnSync(
    "npm",
    ["pack"],
    { cwd: stagingPkgDir, encoding: "utf-8" }
  );
  if (result.status !== 0) {
    process.stderr.write((result.stderr || result.stdout || "npm pack failed") + "\n");
    process.exit(result.status || 1);
  }
  const packedName = (result.stdout || "").trim().split(/\s+/).pop();
  const packedPath = path.join(stagingPkgDir, packedName || "");
  if (!packedName || !fs.existsSync(packedPath)) {
    process.stderr.write(`npm pack did not produce the expected tarball (stdout: ${result.stdout || ""}).\n`);
    process.exit(1);
  }
  fs.copyFileSync(packedPath, path.join(DIST_DIR, tarballName));
} finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}

const tarballPath = path.join(DIST_DIR, tarballName);
if (!fs.existsSync(tarballPath)) {
  process.stderr.write(`Expected tarball not found at ${tarballPath}.\n`);
  process.exit(1);
}

// Sanity check: the tarball must contain the bundled core, or the plugin's MCP
// server will fail to boot outside the monorepo.
const list = childProcess.spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf-8" });
const entries = (list.stdout || "").split("\n");
const hasCore = entries.some(e => e.indexOf("node_modules/@figlets/core/src/index.js") !== -1);
const hasServer = entries.some(e => e.indexOf("package/src/index.js") !== -1);
const hasReceiver = entries.some(e => e.indexOf("package/src/figma-bridge-plugin/receiver.js") !== -1);
if (!hasCore || !hasServer || !hasReceiver) {
  process.stderr.write(
    `Tarball is not self-contained (server=${hasServer}, bundled core=${hasCore}, receiver=${hasReceiver}). Aborting.\n`
  );
  process.exit(1);
}

const expectedUrl = `https://github.com/arashr/figlets-mcp/releases/download/${tag}/${tarballName}`;
const hostManifests = [
  {
    label: "Claude Code plugin",
    path: path.join(REPO_ROOT, "plugins", "claude-code", "figlets", ".claude-plugin", "plugin.json"),
    getUrl: manifest => manifest.mcpServers && manifest.mcpServers.figlets && manifest.mcpServers.figlets.args
      ? manifest.mcpServers.figlets.args[manifest.mcpServers.figlets.args.length - 1]
      : "(unset)",
  },
  {
    label: "Codex plugin",
    path: path.join(REPO_ROOT, "plugins", "codex", "figlets", ".codex-plugin", "plugin.json"),
    getUrl: () => {
      const mcpPath = path.join(REPO_ROOT, "plugins", "codex", "figlets", ".mcp.json");
      const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      return mcp.mcpServers && mcp.mcpServers.figlets && mcp.mcpServers.figlets.args
        ? mcp.mcpServers.figlets.args[mcp.mcpServers.figlets.args.length - 1]
        : "(unset)";
    },
  },
];

// Host plugins cache/update by plugin manifest version. Keep every host wrapper
// in lockstep with the server release and tarball URL.
const manifestChecks = hostManifests.map(item => {
  const manifest = JSON.parse(fs.readFileSync(item.path, "utf-8"));
  const manifestUrl = item.getUrl(manifest);
  return {
    label: item.label,
    path: path.relative(REPO_ROOT, item.path),
    version: manifest.version,
    url: manifestUrl,
    versionMatches: manifest.version === version,
    urlMatches: manifestUrl === expectedUrl,
  };
});
const failedChecks = manifestChecks.filter(item => !item.versionMatches || !item.urlMatches);
if (failedChecks.length) {
  const details = failedChecks.map(item => {
    return [
      `  - ${item.label} (${item.path})`,
      item.versionMatches ? null : `    "version" is ${JSON.stringify(item.version)}, expected ${JSON.stringify(version)} (plugin cache key; unchanged = installed users get no update)`,
      item.urlMatches ? null : `    MCP server URL is ${item.url}, expected ${expectedUrl}`,
    ].filter(Boolean).join("\n");
  }).join("\n");
  process.stderr.write(
    "\nRelease pre-flight FAILED — update host plugin manifests:\n" +
    details + "\n" +
    "The tarball was still built at dist/, but do NOT cut the release until plugin.json matches.\n"
  );
  process.exit(2);
}

process.stdout.write([
  "",
  `Built: dist/${tarballName} (self-contained: bundles @figlets/core)`,
  "",
  "Next steps to publish this tarball (no npm account needed):",
  "",
  "  1. Push this repo public to github.com/arashr/figlets-mcp (default branch).",
  "  2. Tag and create a release with the tarball asset:",
  "",
  `       gh release create ${tag} dist/${tarballName} --title "${tag}" --notes "Figlets MCP server ${version}"`,
  "",
  `     (or upload dist/${tarballName} via the GitHub Releases web UI for tag ${tag}.)`,
  "",
  "Manifest pre-flight: OK",
].concat(manifestChecks.map(item => {
  return `  ${item.label}: ${item.version} -> ${item.url}`;
})).concat([
  "",
]).join("\n"));
