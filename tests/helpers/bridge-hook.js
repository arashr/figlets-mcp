"use strict";

const fs = require("fs");
const path = require("path");

function createBridgeHookFile(dirPath) {
  const hookPath = path.join(dirPath, "bridge-hook.json");
  fs.writeFileSync(hookPath, "{}\n", "utf8");
  return hookPath;
}

function setBridgeHookRoute(hookPath, routePath, config) {
  const hook = JSON.parse(fs.readFileSync(hookPath, "utf8"));
  const entry = {
    statusCode: config.statusCode == null ? 200 : config.statusCode,
    json: config.json != null ? config.json : { success: true, result: config.result || {} },
  };
  if (config.capturePath) entry.capturePath = config.capturePath;
  hook[`POST ${routePath}`] = entry;
  fs.writeFileSync(hookPath, JSON.stringify(hook, null, 2) + "\n", "utf8");
}

function readBridgeHookCapture(capturePath) {
  return JSON.parse(fs.readFileSync(capturePath, "utf8"));
}

function installBridgeHook(hookPath) {
  const previous = process.env.FIGLETS_BRIDGE_HOOK_FILE;
  process.env.FIGLETS_BRIDGE_HOOK_FILE = hookPath;
  return () => {
    if (previous !== undefined) process.env.FIGLETS_BRIDGE_HOOK_FILE = previous;
    else delete process.env.FIGLETS_BRIDGE_HOOK_FILE;
  };
}

async function withBridgeHook(hookPath, fn) {
  const uninstall = installBridgeHook(hookPath);
  try {
    return await fn();
  } finally {
    uninstall();
  }
}

module.exports = {
  createBridgeHookFile,
  setBridgeHookRoute,
  readBridgeHookCapture,
  installBridgeHook,
  withBridgeHook,
};
