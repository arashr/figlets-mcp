"use strict";

const childProcess = require("child_process");
const path = require("path");

const SERVER_PACKAGE = require("../../package.json");

let cachedUpdateCheck = null;

function redactHome(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;
  if (home && (resolved === home || resolved.startsWith(home + path.sep))) {
    return "~" + resolved.slice(home.length);
  }
  return resolved;
}

function compareSemver(a, b) {
  const parse = (value) => String(value || "")
    .split(".")
    .map(part => parseInt(part, 10))
    .map(num => (Number.isFinite(num) ? num : 0));
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length, 3); i++) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function getRuntimeVersionInfo() {
  return {
    name: SERVER_PACKAGE.name || "@figlets/mcp-server",
    version: SERVER_PACKAGE.version || "0.0.0",
    packagePath: redactHome(path.resolve(__dirname, "../../package.json")),
    entrypoint: process.argv && process.argv[1] ? redactHome(process.argv[1]) : null,
    node: redactHome(process.execPath),
  };
}

function normalizeNpmVersion(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch (_) {
    return raw.replace(/^"|"$/g, "");
  }
}

function checkForUpdate(options = {}) {
  if (cachedUpdateCheck && !options.force) return cachedUpdateCheck;

  const runtime = getRuntimeVersionInfo();
  const disabled = process.env.FIGLETS_DISABLE_UPDATE_CHECK === "1"
    || process.env.FIGLETS_UPDATE_CHECK === "0";
  if (disabled) {
    cachedUpdateCheck = {
      checked: false,
      status: "disabled",
      currentVersion: runtime.version,
      latestVersion: null,
      updateAvailable: false,
      message: "Update check is disabled.",
    };
    return cachedUpdateCheck;
  }

  const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
  const npmArgs = process.env.npm_execpath
    ? [process.env.npm_execpath, "view", runtime.name, "version", "--json", "--silent"]
    : ["view", runtime.name, "version", "--json", "--silent"];
  const timeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1200;

  try {
    const result = childProcess.spawnSync(npmCommand, npmArgs, {
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || "npm view failed").trim());
    }
    const latestVersion = normalizeNpmVersion(result.stdout);
    if (!latestVersion) throw new Error("npm did not return a version.");
    const updateAvailable = compareSemver(latestVersion, runtime.version) > 0;
    cachedUpdateCheck = {
      checked: true,
      status: updateAvailable ? "update-available" : "current",
      currentVersion: runtime.version,
      latestVersion,
      updateAvailable,
      updateCommand: updateAvailable ? "npm install -g @figlets/mcp-server@latest" : null,
      message: updateAvailable
        ? `Figlets MCP ${latestVersion} is available. Current version is ${runtime.version}.`
        : `Figlets MCP is current at ${runtime.version}.`,
    };
    return cachedUpdateCheck;
  } catch (err) {
    cachedUpdateCheck = {
      checked: false,
      status: "unavailable",
      currentVersion: runtime.version,
      latestVersion: null,
      updateAvailable: false,
      message: "Could not check for Figlets MCP updates: " + (err && err.message ? err.message : String(err)),
    };
    return cachedUpdateCheck;
  }
}

module.exports = {
  checkForUpdate,
  compareSemver,
  getRuntimeVersionInfo,
};
