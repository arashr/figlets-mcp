'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { routeIntent } = require('../../packages/figlets-mcp-server/src/agent-interface/workflows');
const { handleFigletsWorkflowGuide } = require('../../packages/figlets-mcp-server/src/tools/agent-interface');
const workflows = ['health-check', 'new-ds-setup', 'build-showcase', 'component-docs', 'export-design-md', 'export-make-guidelines'];
for (const workflowId of workflows) {
  const routed = routeIntent('A concrete designer goal', { interpretedWorkflowId: workflowId });
  const guide = handleFigletsWorkflowGuide({ workflow_id: workflowId });
  assert.strictEqual(routed.workflow.id, workflowId, 'presentation must not reroute a known goal');
  assert.strictEqual(routed.selectionPrompt, null, 'do not ask designers to choose a known workflow again');
  assert.ok(routed.designerResponse.split(/\s+/).length < 65, 'workflow opening must stay readable');
  assert.ok(!/config|dry.run|sync_figma|prepare_ds|Please make sure/.test(routed.designerResponse), 'keep orchestration out of the opening');
  assert.deepStrictEqual(routed.hardRules.presentation, guide.hardRules.presentation, 'routing and workflow guidance share one presentation contract');
  assert.ok(guide.hardRules.presentation.questions.approval.includes('preselected option is never approval'));
  assert.ok(guide.hardRules.presentation.questions.optional.includes('skip'));
  assert.ok(guide.hardRules.presentation.questions.customInput.includes('custom answers'));
  assert.ok(guide.hardRules.presentation.layout.includes('Omit empty sections'));
}
const ambiguous = routeIntent('help');
assert.strictEqual(ambiguous.selectionPrompt.type, 'single-choice');
for (const choice of ambiguous.selectionPrompt.choices) {
  assert.ok(ambiguous.selectionPrompt.message.includes(`${choice.index}. **${choice.label}**`), 'native and numbered fallback choices must agree');
}
const health = handleFigletsWorkflowGuide({ workflow_id: 'health-check' });
assert.deepStrictEqual(health.workflow.steps.filter(step => step.kind === 'read').slice(0, 5).map(step => step.tool),
  ['sync_figma_data', 'detect_design_system', 'audit_tokens', 'inspect_ds_setup_gaps', 'inspect_ds_token_gaps'], 'shorter opening must retain the full inspection sequence');
const make = handleFigletsWorkflowGuide({ workflow_id: 'export-make-guidelines' });
assert.ok(JSON.stringify(make).includes('mustReviewOptionalSuggestionsBeforeExportApproval'), 'retain suggestion ordering');
const root = path.resolve(__dirname, '../..');
const adapters = ['AGENTS.md', 'CLAUDE.md'].map(name => fs.readFileSync(path.join(root, 'packages/figlets-adapter', name), 'utf8'));
const presentationSection = text => text.split('## Designer presentation\n')[1].split('## Workflows\n')[0];
assert.strictEqual(presentationSection(adapters[0]), presentationSection(adapters[1]), 'shared adapter presentation rules must stay synchronized while preserving host-specific setup');
for (const file of ['docs/prompts/setup-gap-repair.md', 'docs/prompts/export-design-md.md', 'packages/figlets-adapter/AGENTS.md']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(text.includes('hardRules.presentation'), 'each maintained instruction surface references the shared contract');
  assert.ok(!/usually fine in practice|Most designers leave warning|Add brand color\(s\) to the config|after deleting the old Primitives|Want me to run the QA again/.test(text), 'remove conflicting legacy recovery and contrast instructions');
}
