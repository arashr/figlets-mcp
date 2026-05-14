#!/usr/bin/env node
const args = process.argv.slice(2);

if (args[0] === "doctor") {
  require("../src/cli/doctor.js").runDoctor().catch((err) => {
    process.stderr.write(`Doctor failed: ${err.message}\n`);
    process.exit(1);
  });
} else if (args[0] === "setup") {
  require("../src/cli/setup.js").runSetup(args.slice(1)).catch((err) => {
    process.stderr.write(`Setup failed: ${err.message}\n`);
    process.exit(1);
  });
} else if (args[0] === "launch") {
  require("../src/cli/launch.js").runLaunch(args.slice(1)).catch((err) => {
    process.stderr.write(`Launch failed: ${err.message}\n`);
    process.exit(1);
  });
} else {
  require("../src/index.js");
}
