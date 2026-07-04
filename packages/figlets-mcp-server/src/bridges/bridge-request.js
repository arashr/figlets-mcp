"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { getReceiverUrl } = require("../utils/receiver-url.js");
const { ensureReceiverRunning } = require("../utils/ensure-receiver.js");

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
        const customReceiverUrl = process.env.FIGLETS_RECEIVER_URL || (options && options.receiverUrl);
        if (!customReceiverUrl && !(options && options.receiverRetryAttempted)) {
          ensureReceiverRunning()
            .then(() => requestBridgeViaHttp(receiverUrl, method, routePath, body, Object.assign({}, options || {}, {
              receiverRetryAttempted: true,
            })))
            .then(resolve)
            .catch((retryErr) => {
              resolve({
                statusCode: 0,
                data: {},
                raw: "",
                connectionError: `Bridge receiver was not reachable and Figlets could not restart it automatically: ${retryErr.message}`,
              });
            });
        } else {
          resolve({
            statusCode: 0,
            data: {},
            raw: "",
            connectionError: customReceiverUrl
              ? "Bridge receiver is not running at the configured receiver URL."
              : "Bridge receiver is not running. Figlets already tried to restart it automatically.",
          });
        }
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

function _requestBridgePostOnce(routePath, body, options) {
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
  if (hookPath) {
    if (!fs.existsSync(hookPath)) {
      return Promise.resolve({
        statusCode: 0,
        data: {},
        raw: "",
        connectionError: `FIGLETS_BRIDGE_HOOK_FILE is set but the hook file does not exist: ${hookPath}. Fix the path or unset the variable instead of falling back to the live bridge receiver.`,
      });
    }
    return requestBridgeViaHook(hookPath, "POST", routePath, body);
  }

  const receiverUrl = (options && options.receiverUrl) || getReceiverUrl();
  return requestBridgeViaHttp(receiverUrl, "POST", routePath, body, options);
}

function _isRetryablePluginListeningGap(response) {
  if (!response || response.statusCode !== 503) return false;
  const parsed = response.data || {};
  return Boolean(parsed.pluginRecentlySeen);
}

function bridgeActiveSessionText(parsed) {
  return parsed && parsed.activeSessionId ? ` Active plugin session: ${parsed.activeSessionId}.` : "";
}

function bridgePluginRetryHint(parsed, fallback) {
  if (parsed && parsed.pluginRecentlySeen) {
    return "Figlets retried automatically because the plugin was seen recently, but it did not return to listening before the retry window ended.";
  }
  return fallback || "Open the Figlets Bridge plugin in Figma Desktop and try again.";
}

function formatPluginNotListening(action, parsed, options) {
  const actionText = action ? ` for ${action}` : "";
  const fallback = options && options.fallbackHint;
  return `Figma plugin is not connected or not listening${actionText}. ${bridgePluginRetryHint(parsed, fallback)}${bridgeActiveSessionText(parsed)}`;
}

function formatReceiverConnectionError(connectionError) {
  if (String(connectionError || "").includes("Bridge receiver")) {
    return String(connectionError);
  }
  return `Bridge receiver is not running. The MCP server should start it automatically — try restarting the MCP server. ${connectionError}`;
}

function bridgeStatusError(response, options) {
  const opts = options || {};
  if (response.connectionError) {
    return { error: opts.formatConnectionError ? formatReceiverConnectionError(response.connectionError) : response.connectionError };
  }

  const statusCode = response.statusCode;
  const parsed = response.data || {};
  if (statusCode === 200) return null;
  if (statusCode === 503) {
    const payload = {
      error: formatPluginNotListening(opts.action, parsed, { fallbackHint: opts.fallbackHint }),
    };
    if (opts.includeActiveSession !== false) payload.activeSessionId = parsed.activeSessionId || null;
    return payload;
  }
  if (statusCode === 504) {
    return { error: opts.timeoutError || parsed.error || "Bridge request timed out." };
  }
  if (statusCode === 409) {
    const payload = {
      error: parsed.error || opts.conflictError || "The connected plugin does not advertise the required command. Reload the Figlets Bridge plugin.",
      activeSessionId: parsed.activeSessionId || null,
      pluginCapabilities: parsed.pluginCapabilities || [],
    };
    return payload;
  }
  return { error: opts.unexpectedStatusError || `Unexpected status ${statusCode}` };
}

function requestBridgePost(routePath, body, options) {
  const maxAttempts = options && typeof options.bridgeRetryAttempts === "number" && options.bridgeRetryAttempts > 0
    ? Math.floor(options.bridgeRetryAttempts)
    : 8;
  const retryDelayMs = options && typeof options.bridgeRetryDelayMs === "number" && options.bridgeRetryDelayMs >= 0
    ? Math.floor(options.bridgeRetryDelayMs)
    : 750;
  const disablePluginRetry = options && options.disablePluginRetry;

  function attempt(attemptNumber) {
    return _requestBridgePostOnce(routePath, body, options).then((response) => {
      if (!disablePluginRetry && _isRetryablePluginListeningGap(response) && attemptNumber < maxAttempts) {
        return new Promise((resolve) => setTimeout(resolve, retryDelayMs))
          .then(() => attempt(attemptNumber + 1));
      }
      return response;
    });
  }

  return attempt(1);
}

module.exports = {
  requestBridgePost,
  requestBridgeViaHook,
  requestBridgeViaHttp,
  _hookRouteKey,
  _isRetryablePluginListeningGap,
  bridgeActiveSessionText,
  bridgePluginRetryHint,
  bridgeStatusError,
  formatPluginNotListening,
  formatReceiverConnectionError,
};
