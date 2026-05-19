"use strict";

const requiredMajor = parseInt(process.argv[2] || "22", 10);
const version = process.versions && process.versions.node ? process.versions.node : "0.0.0";
const major = parseInt(version.split(".")[0], 10);

if (!Number.isFinite(major) || major < requiredMajor) {
  process.stderr.write(
    "Figlets requires Node.js >= " + requiredMajor + " for this command. "
    + "Current node is " + version + " at " + process.execPath + ".\n"
    + "Switch to a modern Node runtime, then rerun the command.\n"
  );
  process.exit(1);
}
