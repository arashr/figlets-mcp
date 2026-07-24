'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  prepareMakeGuidelinesTool,
  saveMakeGuidelinesProfileTool,
  exportMakeGuidelinesTool,
  handlePrepareMakeGuidelines,
  handleSaveMakeGuidelinesProfile,
  handleExportMakeGuidelines,
} = require('../../packages/figlets-mcp-server/src/tools/make-guidelines.js');

function writeSnapshot(snapshotPath, surfaceValue) {
  fs.writeFileSync(snapshotPath, JSON.stringify({
    fileKey: 'make-test',
    fileName: 'Make Test',
    collections: [{
      id: 'color',
      name: 'Color',
      variableIds: ['surface'],
      defaultModeId: 'light',
      modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }],
    }],
    variables: [{
      id: 'surface',
      name: 'color/surface/default',
      resolvedType: 'COLOR',
      variableCollectionId: 'color',
      codeSyntax: { WEB: 'var(--surface)' },
      valuesByMode: {
        light: surfaceValue || { r: 1, g: 1, b: 1 },
        dark: { r: 0.05, g: 0.05, b: 0.05 },
      },
    }],
    components: [
      { id: 'card', name: 'Card', type: 'COMPONENT', description: 'Content surface.' },
      { id: 'button', name: 'Button', type: 'COMPONENT', description: 'Action control.' },
    ],
  }, null, 2) + '\n', 'utf8');
}

module.exports = (async () => {
  assert.strictEqual(prepareMakeGuidelinesTool.name, 'prepare_make_guidelines');
  assert.strictEqual(saveMakeGuidelinesProfileTool.name, 'save_make_guidelines_profile');
  assert.strictEqual(exportMakeGuidelinesTool.name, 'export_make_guidelines');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-make-guidelines-'));
  const sourceDir = path.join(tmp, 'source');
  const projectDir = path.join(tmp, 'project');
  const configPath = path.join(sourceDir, 'design-system.config.js');
  const snapshotPath = path.join(sourceDir, 'figma-data.json');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'component-specs'), { recursive: true });
  fs.writeFileSync(configPath, "const DS = { project: { name: 'Make Test' } };\n", 'utf8');
  fs.writeFileSync(path.join(projectDir, 'component-specs', 'Card 1.0.0.md'), [
    '# Card',
    '',
    '> Groups related content on a surface.',
    '',
    '## Usage Rules',
    '',
    '**Do:**',
    '- Use for related content.',
    '',
    "**Don't:**",
    '- Do not nest cards without a hierarchy reason.',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'component-specs', 'Button.md'), [
    '# Button',
    '',
    '> Triggers an action.',
    '',
    '## Usage Rules',
    '',
    '**Do:**',
    '- Use the appropriate emphasis for the action hierarchy.',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'component-specs', 'Tag 1.0.0.md'), [
    '# Tag 1.0.0',
    '',
    '> Labels compact metadata and status values.',
    '',
    '## Variable Modes',
    '',
    '| Collection | Mode |',
    '| --- | --- |',
    '| Tag | Neutral |',
    '| Tag | Success |',
    '',
    '## Usage Rules',
    '',
    '**Do:**',
    '- Use for short metadata.',
  ].join('\n'), 'utf8');
  writeSnapshot(snapshotPath);

  try {
    const prepareArgs = {
      config_path: configPath,
      figmaDataPath: snapshotPath,
      project_path: projectDir,
    };
    const first = await handlePrepareMakeGuidelines(prepareArgs);
    assert.ok(!first.error, JSON.stringify(first));
    assert.strictEqual(first.readiness, 'ready_with_optional_suggestions');
    assert.strictEqual(first.exportPlan.outputRoot, path.join(projectDir, 'specs', 'figma-make'));
    assert.ok(first.exportPlan.files.every(file => file.action === 'create'));
    assert.ok(first.optionalSuggestions.length > 0);
    assert.strictEqual(first.interaction.phase, 'review_optional_suggestions');
    assert.strictEqual(first.interaction.exportApprovalReady, false);
    assert.strictEqual(first.interaction.mustReviewOptionalSuggestionsBeforeExportApproval, true);
    assert.deepStrictEqual(
      first.interaction.suggestionIds,
      first.optionalSuggestions.map(suggestion => suggestion.id),
      'the pre-approval interaction must identify every pending suggestion'
    );
    assert.ok(/before asking for export approval/i.test(first.interaction.instruction));
    assert.ok(/do not combine/i.test(first.interaction.instruction));
    assert.strictEqual(first.preview.confirmed.components, 3);
    assert.strictEqual(first.preview.confirmed.figmaComponents, 2);
    assert.strictEqual(first.preview.confirmed.componentSpecComponents, 3);
    assert.strictEqual(first.preview.confirmed.documentedComponents, 3);
    assert.strictEqual(first.source.componentSpecDiscovery.directory, path.join(projectDir, 'component-specs'));
    assert.deepStrictEqual(first.source.componentSpecDiscovery.matchedFigmaComponents, ['Button', 'Card']);
    assert.deepStrictEqual(first.source.componentSpecDiscovery.specOnlyComponents, ['Tag 1.0.0']);
    assert.ok(first.source.componentSpecDiscovery.files.includes('component-specs/Card 1.0.0.md'));
    assert.deepStrictEqual(first.needsDesignerInput, [], 'optional help must not become forced intake');
    assert.ok(!fs.existsSync(first.exportPlan.outputRoot), 'preparation must remain read-only');

    const refusedProfile = handleSaveMakeGuidelinesProfile({
      config_path: configPath,
      profile: { productCharacter: 'Quiet and precise.' },
    });
    assert.ok(refusedProfile.error, 'profile write must require explicit approval');
    const saved = handleSaveMakeGuidelinesProfile({
      config_path: configPath,
      approved: true,
      profile: {
        productCharacter: 'Quiet and precise.',
        compositionRules: ['Use one primary surface per focused task.'],
      },
    });
    assert.strictEqual(saved.written, true);
    assert.ok(fs.existsSync(path.join(sourceDir, 'make-guidelines.config.json')));

    const second = await handlePrepareMakeGuidelines(prepareArgs);
    assert.ok(!second.error, JSON.stringify(second));
    assert.notStrictEqual(second.sourceFingerprint, first.sourceFingerprint, 'approved profile changes must invalidate the old preview');

    const refusedExport = await handleExportMakeGuidelines(Object.assign({}, prepareArgs, {
      source_fingerprint: second.sourceFingerprint,
    }));
    assert.ok(refusedExport.error, 'export must require explicit approval');

    const staleExport = await handleExportMakeGuidelines(Object.assign({}, prepareArgs, {
      approved: true,
      source_fingerprint: first.sourceFingerprint,
    }));
    assert.ok(/stale/i.test(staleExport.error), 'old preview must be rejected after profile changes');

    const unreviewedExport = await handleExportMakeGuidelines(Object.assign({}, prepareArgs, {
      approved: true,
      source_fingerprint: second.sourceFingerprint,
    }));
    assert.ok(/suggestions must be reviewed before export approval/i.test(unreviewedExport.error));
    assert.deepStrictEqual(
      unreviewedExport.optionalSuggestions.map(suggestion => suggestion.id),
      second.optionalSuggestions.map(suggestion => suggestion.id),
      'the export guard must return the same pending suggestions instead of hiding them until after approval'
    );

    const exported = await handleExportMakeGuidelines(Object.assign({}, prepareArgs, {
      approved: true,
      optional_suggestions_reviewed: true,
      source_fingerprint: second.sourceFingerprint,
    }));
    assert.ok(!exported.error, JSON.stringify(exported));
    assert.strictEqual(exported.exported, true);
    assert.ok(exported.written.length > 0);
    assert.ok(fs.existsSync(path.join(exported.outputRoot, 'guidelines', 'Guidelines.md')));
    assert.ok(fs.existsSync(path.join(exported.outputRoot, 'src', 'make-test', 'styles.css')));
    assert.ok(fs.existsSync(path.join(exported.outputRoot, 'guidelines', 'components.md')));
    assert.ok(fs.existsSync(path.join(exported.outputRoot, 'guidelines', 'components', 'card.md')));
    assert.ok(fs.existsSync(path.join(exported.outputRoot, 'guidelines', 'components', 'button.md')));
    assert.ok(fs.existsSync(path.join(exported.outputRoot, 'guidelines', 'components', 'tag-1-0-0.md')));
    const exportedRootGuidelines = fs.readFileSync(path.join(exported.outputRoot, 'guidelines', 'Guidelines.md'), 'utf8');
    assert.ok(exportedRootGuidelines.includes('Quiet and precise.'));
    assert.ok(exportedRootGuidelines.includes('[components.md](./components.md)'));
    const exportedComponentIndex = fs.readFileSync(path.join(exported.outputRoot, 'guidelines', 'components.md'), 'utf8');
    assert.ok(exportedComponentIndex.includes('(./components/card.md)'));
    assert.ok(exportedComponentIndex.includes('(./components/button.md)'));
    assert.ok(exportedComponentIndex.includes('(./components/tag-1-0-0.md)'));
    assert.ok(
      fs.readFileSync(path.join(exported.outputRoot, 'guidelines', 'components', 'tag-1-0-0.md'), 'utf8')
        .includes('## Variable Modes'),
      'Make component guidance should preserve variable-mode sections from the source spec'
    );

    const afterExport = await handlePrepareMakeGuidelines(prepareArgs);
    assert.strictEqual(afterExport.exportPlan.changes.create, 0);
    assert.ok(afterExport.exportPlan.changes.unchanged > 0);

    const obsoletePath = path.join(exported.outputRoot, 'guidelines', 'obsolete.md');
    const unrelatedPath = path.join(exported.outputRoot, 'guidelines', 'designer-notes.md');
    fs.writeFileSync(obsoletePath, '<!-- Generated by Figlets. Refresh through Figlets. -->\n\n# Obsolete\n', 'utf8');
    fs.writeFileSync(unrelatedPath, '# Designer notes\n', 'utf8');
    const removalPreview = await handlePrepareMakeGuidelines(prepareArgs);
    assert.ok(removalPreview.exportPlan.removals.some(file => file.absolutePath === obsoletePath));
    assert.ok(!removalPreview.exportPlan.removals.some(file => file.absolutePath === unrelatedPath));
    const removalExport = await handleExportMakeGuidelines(Object.assign({}, prepareArgs, {
      approved: true,
      optional_suggestions_reviewed: true,
      source_fingerprint: removalPreview.sourceFingerprint,
    }));
    assert.ok(removalExport.removed.includes(obsoletePath));
    assert.ok(fs.existsSync(unrelatedPath), 'refresh must leave unrelated files untouched');

    const stylesheetPath = path.join(exported.outputRoot, 'src', 'make-test', 'styles.css');
    fs.writeFileSync(stylesheetPath, '/* local stale generated content */\n', 'utf8');
    const refreshPreview = await handlePrepareMakeGuidelines(prepareArgs);
    assert.ok(refreshPreview.exportPlan.files.some(file => file.action === 'refresh' && file.absolutePath === stylesheetPath));
    const refreshed = await handleExportMakeGuidelines(Object.assign({}, prepareArgs, {
      approved: true,
      optional_suggestions_reviewed: true,
      source_fingerprint: refreshPreview.sourceFingerprint,
    }));
    assert.ok(refreshed.refreshed.includes(stylesheetPath), 'approved export should refresh existing Figlets CSS');

    const beforeSnapshotChange = await handlePrepareMakeGuidelines(prepareArgs);
    writeSnapshot(snapshotPath, { r: 0.9, g: 0.9, b: 0.9 });
    const rejectedSnapshotChange = await handleExportMakeGuidelines(Object.assign({}, prepareArgs, {
      approved: true,
      optional_suggestions_reviewed: true,
      source_fingerprint: beforeSnapshotChange.sourceFingerprint,
    }));
    assert.ok(/stale/i.test(rejectedSnapshotChange.error), 'snapshot changes must invalidate approval');

    const escaped = await handlePrepareMakeGuidelines(Object.assign({}, prepareArgs, {
      output_path: path.join(tmp, 'outside-project'),
    }));
    assert.ok(escaped.error);
    assert.ok(/inside project_path/i.test(escaped.error));

    const importedDir = path.join(tmp, 'imported-only');
    const importedSnapshot = path.join(importedDir, 'figma-data.json');
    fs.mkdirSync(importedDir, { recursive: true });
    writeSnapshot(importedSnapshot);
    const importedProject = path.join(tmp, 'imported-project');
    fs.mkdirSync(importedProject, { recursive: true });
    const imported = await handlePrepareMakeGuidelines({
      figmaDataPath: importedSnapshot,
      project_path: importedProject,
    });
    assert.ok(!imported.error, JSON.stringify(imported));
    assert.strictEqual(imported.source.configExists, false);
    assert.strictEqual(imported.source.configKind, 'figma-snapshot-bootstrap');
    assert.ok(!fs.existsSync(path.join(importedDir, 'design-system.config.js')), 'existing-Figma-file start must bootstrap in memory during preview');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
