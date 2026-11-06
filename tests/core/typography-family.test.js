'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const core = require('../../packages/figlets-core/src/ds-config');
const { snapshotFromDsConfig, serializeStylesheet } = require('../../packages/figlets-core/src/make-guidelines');
const { inferTypographyFromSnapshot } = require('../../packages/figlets-mcp-server/src/utils/bootstrap-ds-from-figma');
const { ensureActiveDsConfig } = require('../../packages/figlets-mcp-server/src/utils/ensure-ds-config');
const { _checkGeneratedSetupPrimitiveCoverage } = require('../../packages/figlets-mcp-server/src/tools/apply-ds-setup');

const typography = {
  families: { sans: 'Inter', mono: 'JetBrains Mono', display: 'Space Grotesk', editorial: 'DM Sans' },
  roleFamilies: { headline: 'editorial' },
  scale: {
    'display/lg': { sizes: [48], lineHeights: [56], weight: 400 },
    'body/md': { sizes: [16], lineHeights: [24], weight: 400 },
    'headline/lg': { sizes: [32], lineHeights: [40], weight: 400 },
    'title/md': { sizes: [20], lineHeights: [28], weight: 400, family: 'Arial' },
  },
};
const family = role => core.resolveTypographyFamily(typography, role).family;
assert.strictEqual(family('display/lg'), 'Space Grotesk');
assert.strictEqual(family('body/md'), 'Inter');
assert.strictEqual(family('label/lg'), 'Inter');
assert.strictEqual(family('headline/lg'), 'DM Sans');
assert.strictEqual(family('title/md'), 'Arial');
assert.strictEqual(core.resolveTypographyFamily({ ...typography, roleFamilies: { display: 'sans' } }, 'display/lg').family, 'Inter', 'explicit mapping overrides optional display convention');
assert.strictEqual(core.resolveTypographyFamily({ families: { sans: 'Inter' } }, 'display/lg').family, 'Inter');
assert.ok(!Object.hasOwn(core.typographyFamilies({ families: { sans: 'Inter' } }), 'display'));
const ds = { project: { name: 'Multi Font' }, typography,
  color: { ramps: [{ folder: 'color/brand', steps: [[500, 0, 0, 0]] }], brand: [{ name: 'brand', hex: '#000000', step: 500 }] },
  primitives: { spacing: [[4, 16]] }, spacing: { semantic: { 'touch/min': [44], 'touch/comfortable': [48] } }, breakpoints: { modes: ['Desktop'] } };
const strings = core.generatePrimitivesData(ds).strings;
const single = { ...ds, typography: { families: { sans: 'Inter', mono: 'JetBrains Mono' }, scale: { 'body/md': typography.scale['body/md'] } } };
assert.deepStrictEqual(core.generatePrimitivesData(single).strings, [{ name: 'font/sans', value: 'Inter' }, { name: 'font/mono', value: 'JetBrains Mono' }], 'single-family primitive inventory must remain unchanged');
assert.ok(!core.designMdIntake.dsConfigToDesignMd(single).includes('| Typeface |'), 'single-family documentation keeps its existing table');
assert.ok(!snapshotFromDsConfig(single).variables.some(item => item.name === 'type/body/md/family'), 'single-family Make output keeps its existing variable inventory');
assert.strictEqual(strings.find(item => item.name === 'font/display').value, 'Space Grotesk');
assert.strictEqual(strings.find(item => item.name === 'font/editorial').value, 'DM Sans');
const incompletePrimitives = core.generatePrimitivesData(ds);
incompletePrimitives.strings = incompletePrimitives.strings.filter(item => item.name !== 'font/display');
assert.ok(_checkGeneratedSetupPrimitiveCoverage(ds, incompletePrimitives).some(error => error.includes('font/display')), 'setup must validate display-family prerequisites');
const custom = core.generatePrimitivesData({ ...ds, naming: { fontFamily: 'family/{variant}' } }).strings;
assert.ok(custom.some(item => item.name === 'family/display'));
const markdown = core.designMdIntake.dsConfigToDesignMd(ds);
const roundtrip = core.designMdIntake.designMdToDsConfig(markdown).ds;
assert.strictEqual(roundtrip.typography.scale['display/lg'].family, 'Space Grotesk');
assert.strictEqual(roundtrip.typography.scale['body/md'].family, 'Inter');
const make = snapshotFromDsConfig(ds);
const familyValue = role => Object.values(make.variables.find(item => item.name === `type/${role}/family`).valuesByMode)[0];
assert.strictEqual(familyValue('display/lg'), 'Space Grotesk');
assert.strictEqual(familyValue('body/md'), 'Inter');
const css = serializeStylesheet(make, 'multi').css;
assert.ok(css.includes('Space Grotesk') && css.includes('Inter'), 'CSS must retain both font families');
const observed = inferTypographyFromSnapshot(make);
assert.strictEqual(observed.scale['display/lg'].family, 'Space Grotesk', 'semantic family aliases must survive snapshot import');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-family-refresh-'));
try {
  const configPath = path.join(dir, 'design-system.config.js');
  const existing = { ...ds, typography: { families: { sans: 'Inter' }, roleFamilies: { headline: 'DM Sans' }, scale: { 'body/md': typography.scale['body/md'] } }, figlets: { source: 'figma-snapshot-bootstrap' } };
  core.writeDsConfig(configPath, existing);
  ensureActiveDsConfig({ configPath, refreshGenerated: true, dataSource: { figmaData: make } });
  const refreshed = core.readDsConfig(configPath);
  assert.strictEqual(refreshed.typography.families.display, 'Space Grotesk', 'refresh must retain additional observed families');
  assert.strictEqual(refreshed.typography.families.editorial, 'DM Sans', 'custom family names must survive');
  assert.strictEqual(refreshed.typography.roleFamilies.headline, 'DM Sans', 'explicit role mappings must survive');
  assert.strictEqual(refreshed.typography.scale['display/lg'].family, 'Space Grotesk');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

const canonical = fs.readFileSync(path.join(__dirname, '../../packages/figlets-core/src/ds-config/typography-family.js'), 'utf8').split("'use strict';\n\n")[1].split('\nmodule.exports')[0];
const bridge = fs.readFileSync(path.join(__dirname, '../../packages/figma-bridge-plugin/code.js'), 'utf8');
assert.ok(bridge.includes(canonical), 'Figma sandbox and Node must embed the same canonical pure resolver');
const context = {};
vm.createContext(context);
vm.runInContext(canonical, context);
for (const role of Object.keys(typography.scale)) assert.strictEqual(context.resolveTypographyFamily(typography, role).family, family(role));
