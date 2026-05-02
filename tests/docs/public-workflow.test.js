const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mcpDocs = fs.readFileSync(path.resolve(__dirname, "../../docs/mcp-config-examples.md"), "utf-8");

assert.ok(
  mcpDocs.includes("The MCP server starts the local bridge receiver automatically"),
  "Public setup docs should not require designers to manage the receiver manually"
);
assert.ok(
  mcpDocs.includes("figlets-mcp doctor"),
  "Public setup docs should point agents/developers to the doctor command"
);
assert.ok(
  !mcpDocs.includes("All tools that interact with Figma require the local bridge receiver to be running:"),
  "Public setup docs should not preserve the old manual receiver prerequisite"
);
