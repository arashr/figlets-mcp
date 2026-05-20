const http = require("http");
const { getReceiverUrl } = require("../utils/receiver-url.js");

const qaBindingAuditTool = {
  name: "qa_binding_audit",
  description:
    "Audits the current Figma selection, or the current page if nothing is selected, for unbound design-system properties. Checks raw fills, strokes, stroke weights, corner radius, auto-layout spacing, and typography. Suggestions use the shared semantic binding policy: color, spacing, radius, and border bind to variables first; typography prefers text styles when available because they can bundle variable-backed type decisions; otherwise warn and keep raw values. Requires the Figlets Bridge plugin open in Figma Desktop.",
  inputSchema: {
    type: "object",
    properties: {
      fix: {
        type: "boolean",
        description: "When true, apply all high-confidence variable/style suggestions in Figma. Defaults to false for report-only QA."
      },
      max_nodes: {
        type: "number",
        description: "Optional safety cap for page-scope audits. Defaults to 2500 nodes so large pages return a bounded partial report instead of timing out."
      },
      deadline_ms: {
        type: "number",
        description: "Optional audit time budget in milliseconds. Defaults to 45000."
      }
    },
    required: []
  }
};

function handleQaBindingAudit(args = {}) {
  const receiverUrl = getReceiverUrl();
  const payload = { fix: !!args.fix };
  if (typeof args.max_nodes === "number") payload.maxNodes = args.max_nodes;
  if (typeof args.deadline_ms === "number") payload.deadlineMs = args.deadline_ms;
  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = http.request(
      `${receiverUrl}/request-qa-audit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode === 200) {
            let parsed;
            try { parsed = JSON.parse(data); } catch { parsed = {}; }
            const result = parsed.result || parsed;
            if (result.error) {
              resolve({
                content: [{ type: "text", text: `Plugin error: ${result.error}` }],
                isError: true
              });
              return;
            }
            resolve({
              content: [{
                type: "text",
                text: JSON.stringify({
                  scope: result.scope || "selection",
                  fileName: result.fileName || "",
                  pageName: result.pageName || "",
                  selectedCount: result.selectedCount || 0,
                  checkedRootCount: result.checkedRootCount || 0,
                  auditedNodeCount: result.auditedNodeCount || 0,
                  truncated: !!result.truncated,
                  truncateReason: result.truncateReason || "",
                  maxNodes: result.maxNodes || 0,
                  deadlineMs: result.deadlineMs || 0,
                  violationCount: result.violationCount || 0,
                  byType: result.byType || {},
                  fixApplied: !!result.fixApplied,
                  fixedCount: result.fixedCount || 0,
                  failedCount: result.failedCount || 0,
                  fixed: Array.isArray(result.fixed) ? result.fixed : [],
                  failed: Array.isArray(result.failed) ? result.failed : [],
                  violations: Array.isArray(result.violations) ? result.violations : [],
                  message: `QA audit complete on ${result.fileName || "current file"} / ${result.pageName || "current page"}: ${result.violationCount || 0} violation(s).`
                }, null, 2)
              }]
            });
          } else if (res.statusCode === 503) {
            let parsed;
            try { parsed = JSON.parse(data); } catch { parsed = {}; }
            const activeSessionText = parsed && parsed.activeSessionId
              ? ` Active plugin session: ${parsed.activeSessionId}.`
              : "";
            const retryText = parsed && parsed.pluginRecentlySeen
              ? " The plugin was connected recently and may be finishing another action; wait a moment, then retry."
              : " Open the Figlets Bridge plugin in Figma Desktop, then retry.";
            resolve({
              content: [{ type: "text", text: `Error: Figma plugin is not listening for QA commands.${retryText}${activeSessionText}` }],
              isError: true
            });
          } else if (res.statusCode === 504) {
            resolve({
              content: [{ type: "text", text: "Error: QA audit timed out. The selection may be very large or the plugin may have crashed." }],
              isError: true
            });
          } else {
            resolve({
              content: [{ type: "text", text: `Error: Unexpected status ${res.statusCode}: ${data}` }],
              isError: true
            });
          }
        });
      }
    );

    req.setTimeout(125000, () => {
      req.destroy();
      resolve({
        content: [{ type: "text", text: "Error: Request to bridge receiver timed out." }],
        isError: true
      });
    });

    req.on("error", (err) => {
      resolve({
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      });
    });

    req.write(body);
    req.end();
  });
}

module.exports = { qaBindingAuditTool, handleQaBindingAudit };
