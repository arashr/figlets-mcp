"use strict";

const childProcess = require("child_process");

/**
 * Run a short JSON-RPC session against a Figlets MCP stdio server.
 * @param {{ serverEntry: string, cwd: string, env?: NodeJS.ProcessEnv, readyDelayMs?: number }} options
 * @param {(session: {
 *   send: (id: number, method: string, params?: object) => void,
 *   waitForResponse: (id: number, timeoutMs?: number) => Promise<object>,
 * }) => Promise<void>} fn
 */
async function withMcpStdioSession(options, fn) {
  const child = childProcess.spawn(process.execPath, [options.serverEntry], {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: options.env || process.env,
  });

  let stdout = "";
  let stderr = "";
  let settled = false;
  const pending = new Map();

  function finish(err) {
    if (settled) return;
    settled = true;
    child.kill();
    if (err) throw err;
  }

  child.stdout.on("data", chunk => {
    stdout += String(chunk);
    const lines = stdout.split("\n");
    stdout = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message && Object.prototype.hasOwnProperty.call(message, "id") && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message);
      }
    }
  });

  child.stderr.on("data", chunk => {
    stderr += String(chunk);
  });

  child.on("error", err => {
    if (!settled) finish(err);
  });

  child.on("exit", code => {
    if (!settled && code !== null && code !== 0) {
      finish(new Error(`MCP server exited with ${code}: ${stderr}`));
    }
  });

  function send(id, method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  }

  function waitForResponse(id, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for response id=${id}\nSTDOUT tail:\n${stdout}\nSTDERR:\n${stderr}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  const readyDelayMs = options.readyDelayMs ?? 25;

  try {
    await new Promise(resolve => setTimeout(resolve, readyDelayMs));
    send(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "figlets-mcp-smoke", version: "0.0.0" },
    });
    await waitForResponse(1);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    await fn({ send, waitForResponse });
    finish();
  } catch (err) {
    err.message += `\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
    try {
      finish(err);
    } catch (thrown) {
      throw thrown;
    }
  }
}

function parseToolCallPayload(response) {
  const text = response?.result?.content?.[0]?.text;
  if (!text) {
    throw new Error(`tools/call response missing text content: ${JSON.stringify(response)}`);
  }
  const payload = JSON.parse(text);
  if (payload && payload.then) {
    throw new Error("tools/call returned an unresolved Promise payload");
  }
  return payload;
}

module.exports = {
  withMcpStdioSession,
  parseToolCallPayload,
};
