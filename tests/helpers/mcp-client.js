'use strict';
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
async function freshMcpClient(envOverrides = {}) {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../../packages/figlets-mcp-server/bin/figlets-mcp.js')], {
    env: { ...process.env, ...envOverrides, FIGLETS_SKIP_RECEIVER: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let serial = 0, buffer = '', stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer += data;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let result; try { result = JSON.parse(line); } catch (_) { continue; }
      const entry = pending.get(result.id);
      if (entry) { clearTimeout(entry.timer); pending.delete(result.id); result.error ? entry.reject(Error(JSON.stringify(result.error))) : entry.resolve(result.result); }
    }
  });
  child.on('exit', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('MCP exited: ' + stderr)); }
    pending.clear();
  });
  function call(method, params) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('MCP call timed out: ' + method + '\n' + stderr)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  return {
    call,
    async tool(name, args) {
      const result = await call('tools/call', { name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse(result.content.find(item => item.type === 'text').text);
    },
    async close() {
      if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    },
  };
}

module.exports = { freshMcpClient };
