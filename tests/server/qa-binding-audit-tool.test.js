const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createBridgeHookFile,
  installBridgeHook,
  readBridgeHookCapture,
  setBridgeHookRoute,
} = require("../helpers/bridge-hook.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-qa-audit-hook-"));
const hookPath = createBridgeHookFile(tmp);
const toolPath = "../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js";

function loadTool() {
  delete require.cache[require.resolve(toolPath)];
  return require(toolPath).handleQaBindingAudit;
}

async function runTests() {
  const uninstallHook = installBridgeHook(hookPath);
  try {
    {
      const capturePath = path.join(tmp, "qa-audit-capture.json");
      setBridgeHookRoute(hookPath, "/request-qa-audit", {
        capturePath,
        json: {
          success: true,
          result: {
            scope: "selection",
            fileName: "Portfolio DS",
            pageName: "Components",
            selectedCount: 1,
            checkedRootCount: 1,
            auditedNodeCount: 8,
            truncated: false,
            maxNodes: 2500,
            deadlineMs: 45000,
            violationCount: 2,
            byType: { color: 1, spacing: 1 },
            byFixability: { fixableNow: 1, needsExistingToken: 0, needsDesignerDecision: 0, unsupported: 0 },
            repairPlan: {
              tool: "qa_binding_audit",
              approvalRequired: true,
              applyInput: { fix: true },
              counts: { fixableNow: 1, needsExistingToken: 0, needsDesignerDecision: 0, unsupported: 0 },
              agentInstruction: "Ask before applying fixable bindings"
            },
            violations: [
              {
                nodeId: "1:2",
                nodeName: "Button",
                property: "Fill color",
                rawValue: "rgb(255,255,255)",
                type: "color",
                fixability: "fixableNow",
                suggestion: { kind: "variable", name: "color/surface/default", confidence: "high", id: "var-1" }
              }
            ]
          }
        }
      });
      const handleQaBindingAudit = loadTool();
      const result = await handleQaBindingAudit();
      assert.deepStrictEqual(readBridgeHookCapture(capturePath), { fix: false });
      assert.ok(!result.isError, "should succeed");
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.scope, "selection");
      assert.strictEqual(data.auditedNodeCount, 8);
      assert.strictEqual(data.truncated, false);
      assert.strictEqual(data.maxNodes, 2500);
      assert.strictEqual(data.violationCount, 2);
      assert.deepStrictEqual(data.byType, { color: 1, spacing: 1 });
      assert.strictEqual(data.violations[0].suggestion.name, "color/surface/default");
      assert.strictEqual(data.violations[0].fixability, "fixableNow");
      assert.strictEqual(data.repairPlan.tool, "qa_binding_audit");
      assert.strictEqual(data.byFixability.fixableNow, 1);
      assert.ok(data.message.includes("2 violation(s)"));
    }

    {
      const capturePath = path.join(tmp, "qa-audit-fix-capture.json");
      setBridgeHookRoute(hookPath, "/request-qa-audit", {
        capturePath,
        json: {
          success: true,
          result: {
            scope: "selection",
            violationCount: 1,
            fixApplied: true,
            fixedCount: 1,
            failedCount: 1,
            fixed: [{ nodeId: "1:2", property: "paddingTop", boundTo: "space/component/md" }],
            byFixability: { fixableNow: 0, needsExistingToken: 0, needsDesignerDecision: 1, unsupported: 0 },
            repairPlan: {
              tool: "qa_binding_audit",
              approvalRequired: true,
              applyInput: { fix: true },
              counts: { fixableNow: 0, needsExistingToken: 0, needsDesignerDecision: 1, unsupported: 0 }
            },
            violations: [
              {
                nodeId: "1:3",
                property: "Fill color",
                type: "color",
                fixability: "needsDesignerDecision",
                suggestion: { kind: "variable", name: "color/surface/default", confidence: "medium" }
              }
            ],
            failed: [{ nodeId: "1:3", property: "Fill color", reason: "LOW_CONFIDENCE" }]
          }
        }
      });
      const handleQaBindingAudit = loadTool();
      const result = await handleQaBindingAudit({ fix: true });
      assert.deepStrictEqual(readBridgeHookCapture(capturePath), { fix: true });
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.fixApplied, true);
      assert.strictEqual(data.fixedCount, 1);
      assert.strictEqual(data.failedCount, 1);
      assert.strictEqual(data.fixed[0].boundTo, "space/component/md");
      assert.strictEqual(data.failed[0].reason, "LOW_CONFIDENCE");
    }

    {
      const capturePath = path.join(tmp, "qa-audit-limits-capture.json");
      setBridgeHookRoute(hookPath, "/request-qa-audit", {
        capturePath,
        json: {
          success: true,
          result: {
            scope: "page",
            checkedRootCount: 3,
            auditedNodeCount: 25,
            truncated: true,
            truncateReason: "MAX_NODES",
            maxNodes: 25,
            deadlineMs: 500,
            violationCount: 0,
            byType: {}
          }
        }
      });
      const handleQaBindingAudit = loadTool();
      const result = await handleQaBindingAudit({ max_nodes: 25, deadline_ms: 500 });
      assert.deepStrictEqual(readBridgeHookCapture(capturePath), { fix: false, maxNodes: 25, deadlineMs: 500 });
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.truncated, true);
      assert.strictEqual(data.truncateReason, "MAX_NODES");
      assert.strictEqual(data.auditedNodeCount, 25);
    }

    {
      setBridgeHookRoute(hookPath, "/request-qa-audit", {
        statusCode: 503,
        json: { error: "Figma plugin is not connected or listening.", activeSessionId: "figlets-test" }
      });
      const handleQaBindingAudit = loadTool();
      const result = await handleQaBindingAudit();
      assert.ok(result.isError, "should error");
      assert.ok(result.content[0].text.includes("figlets-test"), "should surface active session id");
    }

    {
      const previous = process.env.FIGLETS_BRIDGE_HOOK_FILE;
      process.env.FIGLETS_BRIDGE_HOOK_FILE = path.join(tmp, "missing-hook.json");
      const handleQaBindingAudit = loadTool();
      const result = await handleQaBindingAudit();
      assert.ok(result.isError, "missing hook should error");
      assert.ok(result.content[0].text.includes("hook file does not exist"), "missing hook should fail closed");
      if (previous !== undefined) process.env.FIGLETS_BRIDGE_HOOK_FILE = previous;
      else delete process.env.FIGLETS_BRIDGE_HOOK_FILE;
    }
  } finally {
    uninstallHook();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = runTests();
