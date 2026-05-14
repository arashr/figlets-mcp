const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-agent-interface-test-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const toClear = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/agent-interface/workflows.js",
  "../../packages/figlets-mcp-server/src/tools/agent-interface.js"
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });

const {
  WORKFLOWS,
  MUTATING_TOOLS,
  getStartGuide,
  getWorkflowGuide,
  routeIntent,
} = require("../../packages/figlets-mcp-server/src/agent-interface/workflows.js");

const {
  handleFigletsStart,
  handleFigletsRouteIntent,
  handleFigletsWorkflowGuide,
} = require("../../packages/figlets-mcp-server/src/tools/agent-interface.js");

function allSteps() {
  return WORKFLOWS.flatMap(workflow => (workflow.steps || []).map(step => ({ workflow, step })));
}

try {
  {
    const start = getStartGuide();
    assert.strictEqual(start.environment.command, "figlets-mcp");
    assert.strictEqual(start.environment.localDir, TEMP_DIR);
    assert.strictEqual(start.environment.activeFileKnown, false);
    assert.strictEqual(start.responseContract.openingFormat, "capability-menu");
    assert.strictEqual(start.responseContract.useVerbatimWhenPossible, "designerResponse");
    assert.strictEqual(start.responseContract.mode, "designer-facing");
    assert.ok(start.designerResponse.includes("| What you can ask for | What I'll do |"));
    assert.ok(start.designerResponse.includes("Check my design system"));
    assert.ok(start.designerResponse.includes("Fix setup gaps"));
    assert.ok(!start.designerResponse.includes("Plugin / MCP server code"));
    assert.ok(!start.designerResponse.includes("Edit repo files"));
    assert.ok(start.designerResponse.includes("I'll inspect first"));
    assert.ok(start.designerResponse.includes("What would you like to do first?"));
    assert.ok(start.capabilityMenu.every(item => item.workflowId && item.label && item.description));
    assert.ok(start.forbiddenDesignerMenuItems.includes("Plugin / MCP server code"));
    assert.ok(start.forbiddenDesignerMenuItems.includes("Edit repo files"));
    assert.ok(start.scope.figletsDoesNotMean.some(item => item.includes("generic Figma create")));
    assert.ok(start.scope.figletsDoesNotMean.some(item => item.includes("plugin code")));
    assert.ok(start.scope.figletsDoesNotMean.some(item => item.includes("figma-console")));
    assert.ok(start.capabilities.some(item => item.id === "setup-gap-qa"));
  }

  {
    const route = routeIntent("Can you fix contrast issues in my semantic colors?");
    assert.strictEqual(route.workflow.id, "setup-gap-qa");
    assert.ok(route.message.includes("Start read-only"));
  }

  {
    const route = routeIntent("Please generate docs for this Button component.");
    assert.strictEqual(route.workflow.id, "component-docs");
  }

  {
    const guide = getWorkflowGuide("build-showcase");
    assert.strictEqual(guide.id, "build-showcase");
    assert.ok(guide.steps.some(step => step.tool === "build_ds_showcase" && step.requiresApproval === true));
    assert.ok(guide.next.includes("export-design-md"));
  }

  {
    for (const { workflow, step } of allSteps()) {
      if (step.kind === "write" || MUTATING_TOOLS.has(step.tool)) {
        assert.strictEqual(
          step.requiresApproval,
          true,
          `${workflow.id}.${step.id} mutates Figma and must require approval`
        );
      }
    }
  }

  {
    for (const workflow of WORKFLOWS) {
      const steps = workflow.steps || [];
      assert.ok(steps.length > 0, `${workflow.id} should have steps`);
      const first = steps[0];
      assert.ok(
        first.kind === "read" || first.kind === "confirmation",
        `${workflow.id} should start with read-only work or designer confirmation`
      );
    }
  }

  {
    const publicPayload = JSON.stringify({
      start: handleFigletsStart(),
      route: handleFigletsRouteIntent({ intent: "export design.md" }),
      guide: handleFigletsWorkflowGuide({ workflow_id: "export-design-md" }),
    });
    assert.ok(!/\/Users\/[^"\\]+/.test(publicPayload), "Agent Interface should not hardcode developer-local /Users paths");
    assert.ok(!publicPayload.includes("/Users/arash"), "Agent Interface should not leak the development repo path");
  }

} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  delete process.env.FIGLETS_LOCAL_DIR;
  toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
}
