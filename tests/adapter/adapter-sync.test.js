const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ADAPTER_DIR = path.resolve(__dirname, "../../packages/figlets-adapter");
const claudeMd = fs.readFileSync(path.join(ADAPTER_DIR, "CLAUDE.md"), "utf-8");
const agentsMd = fs.readFileSync(path.join(ADAPTER_DIR, "AGENTS.md"), "utf-8");

function extractToolNames(content) {
  // Matches backtick-wrapped names in the tools table: | `tool_name` |
  const matches = [...content.matchAll(/\|\s*`([a-z_]+)`\s*\|/g)];
  return new Set(matches.map(m => m[1]));
}

function extractWorkflowHeadings(content) {
  const matches = [...content.matchAll(/^### (.+)$/gm)];
  return new Set(matches.map(m => m[1].trim()));
}

function extractH2Sections(content) {
  const matches = [...content.matchAll(/^## (.+)$/gm)];
  return new Set(matches.map(m => m[1].trim()));
}

// Test 1: both files reference the same set of tool names
{
  const claudeTools = extractToolNames(claudeMd);
  const agentsTools = extractToolNames(agentsMd);

  const onlyInClaude = [...claudeTools].filter(t => !agentsTools.has(t));
  const onlyInAgents = [...agentsTools].filter(t => !claudeTools.has(t));

  assert.deepStrictEqual(
    onlyInClaude, [],
    `Tools in CLAUDE.md but not AGENTS.md: ${onlyInClaude.join(", ")}`
  );
  assert.deepStrictEqual(
    onlyInAgents, [],
    `Tools in AGENTS.md but not CLAUDE.md: ${onlyInAgents.join(", ")}`
  );
}

// Test 2: both files have the same top-level sections (## headings)
{
  const claudeSections = extractH2Sections(claudeMd);
  const agentsSections = extractH2Sections(agentsMd);

  const onlyInClaude = [...claudeSections].filter(s => !agentsSections.has(s));
  const onlyInAgents = [...agentsSections].filter(s => !claudeSections.has(s));

  assert.deepStrictEqual(
    onlyInClaude, [],
    `Sections in CLAUDE.md but not AGENTS.md: ${onlyInClaude.join(", ")}`
  );
  assert.deepStrictEqual(
    onlyInAgents, [],
    `Sections in AGENTS.md but not CLAUDE.md: ${onlyInClaude.join(", ")}`
  );
}

// Test 3: both files define the same workflow headings (### headings)
{
  const claudeWorkflows = extractWorkflowHeadings(claudeMd);
  const agentsWorkflows = extractWorkflowHeadings(agentsMd);

  const onlyInClaude = [...claudeWorkflows].filter(w => !agentsWorkflows.has(w));
  const onlyInAgents = [...agentsWorkflows].filter(w => !claudeWorkflows.has(w));

  assert.deepStrictEqual(
    onlyInClaude, [],
    `Workflows in CLAUDE.md but not AGENTS.md: ${onlyInClaude.join(", ")}`
  );
  assert.deepStrictEqual(
    onlyInAgents, [],
    `Workflows in AGENTS.md but not CLAUDE.md: ${onlyInAgents.join(", ")}`
  );
}
