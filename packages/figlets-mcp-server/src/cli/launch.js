const path = require("path");
const { getDoctorReport } = require("./doctor.js");
const { getStartGuide } = require("../agent-interface/workflows.js");
const { getSetupPlan, applySetupPlan } = require("./setup.js");

function _defaultOptions(options) {
  return Object.assign({}, options || {}, { hosts: ["claude-code-project"] });
}

async function getLaunchReport(options) {
  const setupOptions = _defaultOptions(options);
  const setupPlan = getSetupPlan(setupOptions);
  const setupResult = options && options.skipSetup
    ? setupPlan
    : applySetupPlan(setupPlan, setupOptions);
  const startGuide = getStartGuide();
  const doctor = options && options.doctorReport ? options.doctorReport : await getDoctorReport();
  const projectConfig = setupResult.targets.find(target => target.id === "claude-code-project") || null;

  return {
    title: "Figlets Designer Launcher",
    setup: setupResult,
    projectConfig,
    designerResponse: startGuide.designerResponse,
    bridge: {
      receiverRunning: doctor.receiverRunning,
      pluginConnected: doctor.pluginConnected,
      receiverUrl: doctor.receiverUrl,
      activeSessionId: doctor.activeSessionId || null,
    },
    nextPrompt: "Help me with my Figma design system using Figlets.",
    nextSteps: [
      "Open a fresh Claude Code session from this repo directory.",
      "If Claude asks to approve the project MCP server, approve it.",
      "Open Figma Desktop and keep the Figlets Bridge plugin open in the target file.",
      "Send the next prompt shown below.",
    ],
  };
}

function formatLaunchReport(report) {
  const lines = [];
  lines.push(report.title);
  lines.push("");

  if (report.projectConfig) {
    lines.push(`Claude Code project config: ${report.projectConfig.status}`);
    lines.push(`Config file: ${report.projectConfig.path}`);
  } else {
    lines.push("Claude Code project config: not checked");
  }

  lines.push(`Bridge receiver: ${report.bridge.receiverRunning ? "running" : "not running"} (${report.bridge.receiverUrl})`);
  if (report.bridge.receiverRunning) {
    lines.push(`Figma plugin: ${report.bridge.pluginConnected ? "connected" : "not connected"}`);
    if (report.bridge.activeSessionId) lines.push(`Plugin session: ${report.bridge.activeSessionId}`);
  } else {
    lines.push("Figma plugin: unknown until Figlets starts the bridge receiver");
  }

  lines.push("");
  lines.push("Designer menu preview:");
  lines.push(report.designerResponse);
  lines.push("");
  lines.push("Next steps:");
  for (const step of report.nextSteps) lines.push(`- ${step}`);
  lines.push("");
  lines.push("Prompt to send in Claude Code:");
  lines.push(report.nextPrompt);

  if (!report.bridge.receiverRunning) {
    lines.push("");
    lines.push("Note: the receiver not running is normal before Claude Code starts the Figlets MCP server.");
  }

  return lines.join("\n");
}

function _parseArgs(argv) {
  const result = { skipSetup: false };
  for (const arg of argv || []) {
    if (arg === "--skip-setup") result.skipSetup = true;
  }
  return result;
}

async function runLaunch(argv, options) {
  const parsed = _parseArgs(argv);
  const report = await getLaunchReport(Object.assign({}, options || {}, parsed));
  process.stdout.write(formatLaunchReport(report) + "\n");
  return report;
}

if (require.main === module) {
  runLaunch(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`Launch failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  getLaunchReport,
  formatLaunchReport,
  runLaunch,
};
