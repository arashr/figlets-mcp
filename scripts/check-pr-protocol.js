"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(content, phrase, filePath) {
  if (!content.includes(phrase)) {
    throw new Error(`${filePath} must include ${JSON.stringify(phrase)}`);
  }
}

function checkRequiredPhrases(filePath, phrases) {
  const content = read(filePath);
  for (const phrase of phrases) {
    assertIncludes(content, phrase, filePath);
  }
}

function main() {
  checkRequiredPhrases(".github/pull_request_template.md", [
    "## Linear",
    "Issue: BNN-",
    "Status comment updated",
    "## Scope",
    "## Not In Scope",
    "## Test Plan",
    "`npm test`",
    "`git diff --check`",
    "## Manual Verification",
    "## Agent Review",
    "Verdict: pending / approve / approve with nits / request changes",
    "PR review comment posted",
    "## Merge Notes",
    "Must-fix findings cleared",
    "Linear completion comment posted",
  ]);

  checkRequiredPhrases("docs/agent-pr-review-protocol.md", [
    "Linear comments explain what happened on the task. PR comments explain whether the code is ready to merge.",
    "Agent Review",
    "Verdict: approve / approve with nits / request changes",
    "Must-fix before merge",
    "Test coverage gaps",
    "Manual verification",
    "Host-neutrality / release risk",
    "Merge captain checklist",
    "At least one agent review comment exists for v1.0 blockers",
    "Do not give merge green light while must-fix findings remain open.",
    "Subagent handoff prompt",
  ]);

  checkRequiredPhrases("AGENTS.md", [
    "PR review protocol",
    "GitHub PR is the code review truth",
    "Do not give merge green light while must-fix findings remain open",
    "docs/agent-pr-review-protocol.md",
  ]);

  checkRequiredPhrases("CLAUDE.md", [
    "PR review protocol",
    "GitHub PR is the code review truth",
    "Do not give merge green light while must-fix findings remain open",
    "docs/agent-pr-review-protocol.md",
  ]);

  checkRequiredPhrases("docs/developer-guide.md", [
    "Agent PR review protocol",
    ".github/pull_request_template.md",
    "GitHub PRs are the code review truth",
    "Linear issue comments are the task log",
  ]);
}

if (require.main === module) {
  main();
}

module.exports = { main };

