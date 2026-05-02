const fs = require("fs");
const http = require("http");
const path = require("path");
const { checkPort, RECEIVER_PORT } = require("../utils/ensure-receiver.js");

const LOCAL_DIR = process.env.FIGLETS_LOCAL_DIR || path.resolve(__dirname, "../../../.local");
const DATA_PATH = path.join(LOCAL_DIR, "figma-data.json");
const SELECTION_PATH = path.join(LOCAL_DIR, "figma-selection.json");

function _getJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json: JSON.parse(body) });
        } catch (err) {
          resolve({ ok: false, statusCode: res.statusCode, error: "Invalid JSON response" });
        }
      });
    });

    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(timeoutMs || 1000, () => {
      req.destroy();
      resolve({ ok: false, error: "Timed out" });
    });
  });
}

function _fileInfo(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, path: filePath };
  const stat = fs.statSync(filePath);
  return { exists: true, path: filePath, modifiedAt: stat.mtime.toISOString(), size: stat.size };
}

async function getDoctorReport() {
  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || `http://127.0.0.1:${RECEIVER_PORT}`;
  let receiverPort = RECEIVER_PORT;
  try {
    receiverPort = Number(new URL(receiverUrl).port || RECEIVER_PORT);
  } catch (err) {}

  const receiverRunning = await checkPort(receiverPort);
  let health = null;

  if (receiverRunning) {
    const result = await _getJson(`${receiverUrl}/health`, 1000);
    health = result.ok ? result.json : { error: result.error || `HTTP ${result.statusCode}` };
  }

  return {
    receiverUrl,
    receiverRunning,
    receiverHealth: health,
    pluginConnected: Boolean(health && health.pluginConnected),
    activeSessionId: health && health.activeSessionId ? health.activeSessionId : null,
    snapshot: _fileInfo(DATA_PATH),
    selection: _fileInfo(SELECTION_PATH)
  };
}

function formatDoctorReport(report) {
  const lines = [];
  lines.push("Figlets MCP Doctor");
  lines.push("");
  lines.push(`Bridge receiver: ${report.receiverRunning ? "running" : "not running"} (${report.receiverUrl})`);

  if (report.receiverRunning && report.receiverHealth && report.receiverHealth.error) {
    lines.push(`Receiver health: unavailable (${report.receiverHealth.error})`);
  }

  if (report.receiverRunning && report.receiverHealth && !report.receiverHealth.error) {
    lines.push(`Figma plugin: ${report.pluginConnected ? "connected" : "not connected"}`);
    if (report.activeSessionId) lines.push(`Plugin session: ${report.activeSessionId}`);
  } else {
    lines.push("Figma plugin: unknown");
  }

  lines.push(`Snapshot: ${report.snapshot.exists ? `found (${report.snapshot.modifiedAt})` : "missing"}`);
  lines.push(`Selection cache: ${report.selection.exists ? `found (${report.selection.modifiedAt})` : "missing"}`);
  lines.push("");

  if (!report.receiverRunning) {
    lines.push("Next step: connect or restart the MCP server. For local debugging, run the bridge receiver manually.");
  } else if (!report.pluginConnected) {
    lines.push("Next step: open the Figlets Bridge plugin in Figma Desktop and keep it open.");
  } else {
    lines.push("Ready for live Figma tools.");
  }

  return lines.join("\n");
}

async function runDoctor() {
  const report = await getDoctorReport();
  process.stdout.write(formatDoctorReport(report) + "\n");
  return report;
}

if (require.main === module) {
  runDoctor().catch((err) => {
    process.stderr.write(`Doctor failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { getDoctorReport, formatDoctorReport, runDoctor };
