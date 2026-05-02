#!/usr/bin/env node
const args = process.argv.slice(2);

if (args[0] === "doctor") {
  require("../src/cli/doctor.js").runDoctor().catch((err) => {
    process.stderr.write(`Doctor failed: ${err.message}\n`);
    process.exit(1);
  });
} else {
  require("../src/index.js");
}
