"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { getReceiverUrl } = require("../utils/receiver-url.js");

function _hookRouteKey(method, routePath) {
  return `${String(method || "POST").toUpperCase()} ${routePath}`;
}

function _loadBridgeHook(hookPath) {
  return JSON.parse(fs.readFileSync(hookPath, "utf8"));
}

function _resolveHookEntry(hook, method, routePath) {
  const key = _hookRouteKey(method, routePath);
  if (hook[key]) return hook[key];
  if (hook[routePath]) return hook[routePath];
  return null;
}

function requestBridgeViaHook(hookPath, method, routePath, body) {
  const hook = _loadBridgeHook(hookPath);
  const entry = _resolveHookEntry(hook, method, routePath);
  if (!entry) {
    return Promise.resolve({ statusCode: 404, data: {}, raw: "" });
  }
  if (entry.capturePath) {
    fs.mkdirSync(path.dirname(entry.capturePath), { recursive: true });
    fs.writeFileSync(entry.capturePath, JSON.stringify(body, null, 2));
  }
  const data = entry.json != null ? entry.json : (entry.body || {});
  return Promise.resolve({
    statusCode: entry.statusCode == null ? 200 : entry.statusCode,
    data,
    raw: JSON.stringify(data),
  });
}

function requestBridgeViaHttp(receiverUrl, method, routePath, body, options) {
  const payload = JSON.stringify(body);
  const timeoutMs = options && options.timeoutMs != null ? options.timeoutMs : 65000;

  return new Promise((resolve) => {
    const req = http.request(`${receiverUrl}${routePath}`, {
      method: method || "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = "";
      res.on("data", chunk => { raw += chunk; });
      res.on("end", () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (err) {}
        resolve({ statusCode: res.statusCode || 0, data, raw });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ statusCode: 504, data: {}, raw: "" });
    });

    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        resolve({
          statusCode: 0,
          data: {},
          raw: "",
          connectionError: "Bridge receiver is not running. The MCP server should start it automatically — try restarting the MCP host.",
        });
      } else {
        resolve({
          statusCode: 0,
          data: {},
          raw: "",
          connectionError: err.message,
        });
      }
    });

    req.write(payload);
    req.end();
  });
}

function requestBridgePost(routePath, body, options) {
  if (options && typeof options.transport === "function") {
    return Promise.resolve(options.transport({
      method: "POST",
      path: routePath,
      body,
      receiverUrl: options.receiverUrl || getReceiverUrl(),
    }));
  }

  const hookPath = (options && options.bridgeHookFile)
    || process.env.FIGLETS_BRIDGE_HOOK_FILE;
  if (hookPath && fs.existsSync(hookPath)) {
    return requestBridgeViaHook(hookPath, "POST", routePath, body);
  }

  const receiverUrl = (options && options.receiverUrl) || getReceiverUrl();
  return requestBridgeViaHttp(receiverUrl, "POST", routePath, body, options);
}

module.exports = {
  requestBridgePost,
  requestBridgeViaHook,
  requestBridgeViaHttp,
  _hookRouteKey,
};
