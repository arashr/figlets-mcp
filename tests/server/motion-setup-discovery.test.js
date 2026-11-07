'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { handleFigletsWorkflowGuide } = require('../../packages/figlets-mcp-server/src/tools/agent-interface');
const result = handleFigletsWorkflowGuide({ workflow_id: 'new-ds-setup' });
const guide = result.workflow;
const steps = guide.steps;
const choice = steps.find(step => step.id === 'motion-choice');
assert.ok(choice, 'ordinary setup must surface the optional motion choice');
assert.strictEqual(choice.kind, 'confirmation');
assert.deepStrictEqual(choice.selectionPrompt.choices.map(item => item.id), ['include-motion', 'skip-motion']);
for (const item of choice.selectionPrompt.choices) assert.ok(choice.selectionPrompt.message.includes(item.label), 'native and text choices must agree');
const index = id => steps.findIndex(step => step.id === id);
assert.ok(index('collect-answers') < index('motion-choice'));
assert.ok(index('motion-choice') < index('create-config-from-intake'));
assert.ok(index('motion-choice') < index('prepare'));
assert.ok(index('motion-choice') < index('approve-build'));
assert.strictEqual(choice.optionalFeature, true, 'choosing motion remains optional');
assert.ok(guide.intakeContract.requiredTopics.some(topic => /motion choice/.test(topic)), 'the include/skip answer belongs to intake completion');
assert.ok(guide.intakeContract.intakeQuestionOrder.some(topic => /motion choice/.test(topic)));
assert.strictEqual(choice.requiredBeforeTool, 'create_ds_config_from_intake');
for (const id of ['preview-motion', 'save-motion', 'reprepare-after-motion']) assert.ok(!steps.some(step => step.id === id), 'new setup must not append separate motion stages');
assert.ok(choice.skipRule.includes('no separate motion tools'));
assert.ok(choice.repeatRule.includes('already'));
assert.ok(result.hardRules.bulkRepairRouting.some(rule => rule.includes('skip-motion') && rule.includes('same Figma build approval')));
for (const file of ['packages/figlets-adapter/AGENTS.md', 'packages/figlets-adapter/CLAUDE.md', 'plugins/codex/figlets/skills/figlets-designer/SKILL.md', 'plugins/claude-code/figlets/skills/figlets-designer/SKILL.md']) {
  const text = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  assert.ok(text.includes('Include motion') && text.includes('Skip for now'), 'all host instructions must expose the same choice');
  assert.ok(!text.includes('Do not add a motion question to ordinary intake') && !text.includes('Do not add motion to ordinary intake'), 'remove the superseded discovery prohibition');
}

assert.ok(!result.hardRules.bulkRepairRouting.some(rule => rule.includes('Follow apply_ds_setup.nextStep')));

assert.ok(guide.intakeContract.optionalMotionRule.includes('before config creation or preparation'));
assert.ok(!guide.intakeContract.optionalMotionRule.includes('After base intake'));
