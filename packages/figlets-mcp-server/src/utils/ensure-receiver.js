const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { getReceiverPort } = require("./receiver-url.js");

const RECEIVER_PORT = getReceiverPort();
const RECEIVER_PATH = path.resolve(__dirname, "../../../figma-bridge-plugin/src/receiver.js");

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

function waitForPort(port, timeout = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      checkPort(port).then((up) => {
        if (up) return resolve();
        if (Date.now() - start >= timeout) return reject(new Error(`Receiver did not start within ${timeout}ms`));
        setTimeout(attempt, 100);
      });
    }
    attempt();
  });
}

async function ensureReceiverRunning() {
  const already = await checkPort(RECEIVER_PORT);
  if (already) {
    process.stderr.write(`[figlets] Bridge receiver already running on :${RECEIVER_PORT}\n`);
    return;
  }

  process.stderr.write(`[figlets] Starting bridge receiver on :${RECEIVER_PORT}...\n`);

  const child = spawn(process.execPath, [RECEIVER_PATH], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: Object.assign({}, process.env, { FIGLETS_RECEIVER_PORT: String(RECEIVER_PORT) }),
  });

  child.stdout.on("data", (d) => process.stderr.write(`[receiver] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[receiver] ${d}`));
  child.on("error", (err) => process.stderr.write(`[receiver] Failed to start: ${err.message}\n`));

  await waitForPort(RECEIVER_PORT);
  process.stderr.write("[figlets] Bridge receiver ready\n");
}

module.exports = { checkPort, waitForPort, ensureReceiverRunning, RECEIVER_PORT, RECEIVER_PATH };
