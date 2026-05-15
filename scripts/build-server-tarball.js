#!/usr/bin/env node
// Builds the @figlets/mcp-server npm tarball and prints how to attach it to a GitHub release.
// The Claude Code plugin manifest (plugins/claude-code/figlets/.claude-plugin/plugin.json) points
// at that release asset via `npx -y <tarball-url>`, so no npm publish / npm account is needed.
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(REPO_ROOT, "packages", "figlets-mcp-server");
const DIST_DIR = path.join(REPO_ROOT, "dist");

const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, "package.json"), "utf-8"));
const version = pkg.version;
const tarballName = `figlets-mcp-server-${version}.tgz`;
const tag = `v${version}`;

fs.mkdirSync(DIST_DIR, { recursive: true });

const result = childProcess.spawnSync(
  "npm",
  ["pack", "--pack-destination", DIST_DIR],
  { cwd: SERVER_DIR, encoding: "utf-8" }
);

if (result.status !== 0) {
  process.stderr.write((result.stderr || result.stdout || "npm pack failed") + "\n");
  process.exit(result.status || 1);
}

const tarballPath = path.join(DIST_DIR, tarballName);
if (!fs.existsSync(tarballPath)) {
  process.stderr.write(`Expected tarball not found at ${tarballPath}. npm pack output:\n${result.stdout}\n`);
  process.exit(1);
}

const manifestPath = path.join(REPO_ROOT, "plugins", "claude-code", "figlets", ".claude-plugin", "plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const manifestUrl = manifest.mcpServers && manifest.mcpServers.figlets && manifest.mcpServers.figlets.args
  ? manifest.mcpServers.figlets.args[manifest.mcpServers.figlets.args.length - 1]
  : "(unset)";
const expectedUrl = `https://github.com/arashr/figlets-mcp/releases/download/${tag}/${tarballName}`;

process.stdout.write([
  "",
  `Built: dist/${tarballName}`,
  "",
  "Next steps to publish this tarball (no npm account needed):",
  "",
  `  1. Push this repo public to github.com/arashr/figlets-mcp (default branch).`,
  `  2. Tag and create a release with the tarball asset:`,
  "",
  `       gh release create ${tag} dist/${tarballName} --title "${tag}" --notes "Figlets MCP server ${version}"`,
  "",
  `     (or upload dist/${tarballName} via the GitHub Releases web UI for tag ${tag}.)`,
  "",
  "Manifest check:",
  `  plugin.json server URL: ${manifestUrl}`,
  `  expected for ${tag}:       ${expectedUrl}`,
  manifestUrl === expectedUrl
    ? "  OK - manifest URL matches this version."
    : "  WARNING - manifest URL does not match. Update plugin.json before releasing.",
  "",
].join("\n"));
