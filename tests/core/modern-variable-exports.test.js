'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const values = require('../../packages/figlets-core/src/variable-values');
const make = require('../../packages/figlets-core/src/make-guidelines');
const design = require('../../packages/figlets-core/src/ds-config/design-md-intake');
const alias = id => ({ type: 'VARIABLE_ALIAS', id });
const variable = (id, type, modes, extra = {}) => ({ id, name: id, resolvedType: type, variableCollectionId: 'c', valuesByMode: modes, ...extra });
const snapshot = {
  fileKey: 'test', capabilities: { timing: true },
  collections: [{ id: 'c', name: 'Motion', defaultModeId: 'd', modes: [{ modeId: 'd', name: 'Default' }, { modeId: 'r', name: 'Reduced Motion' }] }],
  variables: [
    variable('base', 'COLOR', { d: { r: 0, g: 0, b: 0 }, r: { r: 1, g: 1, b: 1 } }),
    variable('opacity/scrim', 'FLOAT', { d: 32, r: 16 }, { scopes: ['OPACITY', 'COLOR_OPACITY'] }),
    variable('scrim', 'COLOR', { d: { color: alias('base'), opacity: alias('opacity/scrim') }, r: { color: alias('base'), opacity: alias('opacity/scrim') } }),
    variable('duration', 'TIMING', { d: Math.fround(0.2), r: 0 }),
    variable('ease', 'EASING', { d: { type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: 0.2, y1: -0.3, x2: 0.8, y2: 1.2 } }, r: { type: 'LINEAR' } }),
    variable('spring', 'EASING', { d: { type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 0.3 } } }),
  ],
};
const before = JSON.stringify(snapshot);
const exported = make.serializeStylesheet(snapshot, 'test');
assert.match(exported.css, /200ms/);
assert.match(exported.css, /32%/);
assert.match(exported.css, /rgba\(0, 0, 0, 0.32\)/);
assert.match(exported.css, /cubic-bezier\(0.2, -0.3, 0.8, 1.2\)/);
assert.match(exported.css, /data-figma-mode="reduced-motion"/);
assert.ok(exported.omitted.some(row => row.variableName === 'spring' && row.reason === 'no-portable-css-easing'));
assert.strictEqual(exported.nameMap.find(row => row.variableName === 'spring').emitted, false);
assert.deepStrictEqual(exported.variableData.variables, snapshot.variables);
const scrim = exported.variableData.presentation.find(row => row.name === 'scrim' && row.modeId === 'r');
assert.deepStrictEqual(scrim.resolvedValue, { r: 1, g: 1, b: 1, a: 0.16 });
assert.deepStrictEqual(scrim.references.map(row => row.path), [['color'], ['opacity']]);
assert.strictEqual(JSON.stringify(snapshot), before);
const alternateSpring = JSON.parse(before);
alternateSpring.variables.find(row => row.id === 'ease').valuesByMode.r = { type: 'GENTLE' };
const unavailable = make.serializeStylesheet(alternateSpring, 'test');
assert.match(unavailable.css, /initial; \/\* No portable value in this mode/);
assert.deepStrictEqual(unavailable.nameMap.find(row => row.variableName === 'ease').omittedModes, ['Reduced Motion']);
const cyclic = { ...snapshot, variables: [variable('cycle', 'COLOR', { d: alias('cycle') })] };
assert.strictEqual(values.variableSnapshot(cyclic).presentation[0].error, 'cyclic-variable-alias');
const wrong = { ...snapshot, variables: [variable('bad', 'TIMING', { d: alias('base') }), snapshot.variables[0]] };
assert.strictEqual(values.variableSnapshot(wrong).presentation[0].error, 'missing-or-wrong-type-alias');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-modern-export-'));
try {
  const ds = { project: { name: 'Modern export' }, color: { brand: [{ name: 'brand', hex: '#336699', role: 'primary' }] } };
  const artifacts = design.buildDesignMdArtifacts(ds, path.join(dir, 'DESIGN.md'), { figmaData: snapshot });
  assert.match(artifacts.markdown, /## Variable Values/);
  assert.ok(!artifacts.markdown.includes('```figlets-extended'));
  const sidecar = JSON.parse(artifacts.sidecar.contents);
  assert.strictEqual(sidecar.schemaVersion, '3');
  assert.deepStrictEqual(sidecar.variableData.variables, snapshot.variables);
  design.writeDesignMdArtifacts(artifacts, { writeSidecar: true });
  const restored = design.readDesignMdAsDsConfig(artifacts.path);
  assert.strictEqual(restored.parsed.sidecar, true);
  const restoredDs = restored.DS || restored.ds;
  assert.deepStrictEqual(restoredDs.figlets.variableData.variables, snapshot.variables);
  assert.deepStrictEqual(make.snapshotFromDsConfig(restoredDs).variables, snapshot.variables);
  restoredDs.project.name = 'Edited export';
  assert.strictEqual(values.archivedSnapshot(restoredDs), null);
  const changed = design.buildDesignMdArtifacts(restoredDs, artifacts.path);
  assert.ok(!JSON.parse(changed.sidecar.contents).variableData, 'Changed configs must not reexport stale observed values');
  assert.ok(!changed.markdown.includes('## Variable Values'));
  assert.notStrictEqual(make.snapshotFromDsConfig(restoredDs).source, 'verified-sidecar-snapshot');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
