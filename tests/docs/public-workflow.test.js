const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mcpDocs = fs.readFileSync(path.resolve(__dirname, "../../docs/mcp-config-examples.md"), "utf-8");
const readme = fs.readFileSync(path.resolve(__dirname, "../../README.md"), "utf-8");
const developerGuide = fs.readFileSync(path.resolve(__dirname, "../../docs/developer-guide.md"), "utf-8");
const adapterReadme = fs.readFileSync(path.resolve(__dirname, "../../packages/figlets-adapter/README.md"), "utf-8");

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

assert.ok(
  readme.includes("**Generate Figma Make guidelines:** create guidance files that help new Make projects follow your design system"),
  "Public README should list the Make workflow in the same concise designer-facing capability style"
);
assert.ok(
  !readme.includes("### Generate Figma Make guidelines") &&
    !readme.includes("<project>/specs/figma-make/") &&
    !readme.includes("prepare_make_guidelines"),
  "Public README should not give the Make feature separate technical treatment"
);
assert.ok(
  developerGuide.includes("## Figma Make guidelines export") &&
    developerGuide.includes("prepare_make_guidelines") &&
    developerGuide.includes("save_make_guidelines_profile") &&
    developerGuide.includes("export_make_guidelines") &&
    developerGuide.includes("figma-make-guidelines-feature-plan.md"),
  "Developer guide should document the implemented Make architecture and approval surfaces"
);
assert.ok(
  adapterReadme.includes("Generate Figma Make guidelines") &&
    adapterReadme.includes("optional guidance review first"),
  "Adapter README should advertise Make routing and preserve its interaction order"
);
