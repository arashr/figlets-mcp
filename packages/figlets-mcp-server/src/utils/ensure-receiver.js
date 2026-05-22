const net = require("net");
const http = require("http");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { getReceiverPort, getReceiverUrl } = require("./receiver-url.js");

const RECEIVER_PORT = getReceiverPort();
const RECEIVER_PATHS = [
  path.resolve(__dirname, "../figma-bridge-plugin/receiver.js"),
  path.resolve(__dirname, "../../../figma-bridge-plugin/src/receiver.js"),
];
const RECEIVER_PATH = RECEIVER_PATHS.find((candidate) => {
  try {
    return require("fs").existsSync(candidate);
  } catch (err) {
    return false;
  }
}) || RECEIVER_PATHS[0];

function isDevBridgeRequested() {
  const raw = String(process.env.FIGLETS_DEV_BRIDGE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isReceiverStartupSkipped() {
  const raw = String(process.env.FIGLETS_SKIP_RECEIVER || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

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

function waitForPortDown(port, timeout = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      checkPort(port).then((up) => {
        if (!up) return resolve();
        if (Date.now() - start >= timeout) return reject(new Error(`Receiver did not stop within ${timeout}ms`));
        setTimeout(attempt, 100);
      });
    }
    attempt();
  });
}

function fetchReceiverHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${getReceiverUrl()}/health`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch (err) {
          resolve(null);
        }
      });
    });
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

async function stopReceiverOnPort(port) {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
    if (!out) return;
    for (const pid of out.split("\n").filter(Boolean)) {
      process.kill(Number(pid), "SIGTERM");
    }
    await waitForPortDown(port, 5000);
  } catch (err) {
    if (err && err.status !== 1) throw err;
  }
}

function spawnReceiver() {
  const env = Object.assign({}, process.env, {
    FIGLETS_RECEIVER_PORT: String(RECEIVER_PORT),
  });
  if (isDevBridgeRequested()) {
    env.FIGLETS_DEV_BRIDGE = "1";
  }

  const child = spawn(process.execPath, [RECEIVER_PATH], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  child.stdout.on("data", (d) => process.stderr.write(`[receiver] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[receiver] ${d}`));
  child.on("error", (err) => process.stderr.write(`[receiver] Failed to start: ${err.message}\n`));
  return child;
}

async function ensureReceiverRunning() {
  if (isReceiverStartupSkipped()) {
    process.stderr.write("[figlets] Bridge receiver startup skipped by FIGLETS_SKIP_RECEIVER\n");
    return;
  }

  const needsDevBridge = isDevBridgeRequested();
  const already = await checkPort(RECEIVER_PORT);

  if (already) {
    if (needsDevBridge) {
      const health = await fetchReceiverHealth();
      if (!health || health.devBridgeEnabled !== true) {
        process.stderr.write(
          `[figlets] Bridge receiver on :${RECEIVER_PORT} is running without developer commands; restarting with FIGLETS_DEV_BRIDGE=1...\n`
        );
        await stopReceiverOnPort(RECEIVER_PORT);
      } else {
        process.stderr.write(`[figlets] Bridge receiver already running on :${RECEIVER_PORT}\n`);
        return;
      }
    } else {
      process.stderr.write(`[figlets] Bridge receiver already running on :${RECEIVER_PORT}\n`);
      return;
    }
  }

  process.stderr.write(`[figlets] Starting bridge receiver on :${RECEIVER_PORT}...\n`);
  spawnReceiver();
  await waitForPort(RECEIVER_PORT);
  process.stderr.write("[figlets] Bridge receiver ready\n");
}

async function waitForPluginConnection(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const health = await fetchReceiverHealth();
    if (health && (health.pluginConnected || health.pluginRecentlySeen)) {
      return health;
    }
    process.stderr.write("[figlets] Waiting for Figma Bridge plugin connection...\n");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    "Figma Bridge plugin is not connected. Open Figlets Bridge in Figma Desktop on the target file and reload the plugin if the receiver was restarted."
  );
}

module.exports = {
  checkPort,
  waitForPort,
  waitForPortDown,
  ensureReceiverRunning,
  fetchReceiverHealth,
  waitForPluginConnection,
  isDevBridgeRequested,
  isReceiverStartupSkipped,
  RECEIVER_PORT,
  RECEIVER_PATH,
};
