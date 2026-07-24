'use strict';

const assert = require('assert');
const makeGuidelines = require('../../packages/figlets-core/src/make-guidelines.js');

const figmaData = {
  fileName: 'Orbit System',
  collections: [
    {
      id: 'colors',
      name: 'Color',
      variableIds: ['primitive', 'surface', 'accent'],
      defaultModeId: 'light',
      modes: [
        { modeId: 'dark', name: 'Dark' },
        { modeId: 'light', name: 'Light' },
      ],
    },
    {
      id: 'spacing',
      name: 'Spacing',
      variableIds: ['space', 'collision'],
      defaultModeId: 'mobile',
      modes: [
        { modeId: 'mobile', name: 'Mobile' },
        { modeId: 'desktop', name: 'Desktop' },
      ],
    },
  ],
  variables: [
    {
      id: 'primitive',
      name: 'color/blue/500',
      resolvedType: 'COLOR',
      variableCollectionId: 'colors',
      hiddenFromPublishing: true,
      valuesByMode: {
        light: { r: 0, g: 0.4, b: 1 },
        dark: { r: 0.2, g: 0.55, b: 1 },
      },
    },
    {
      id: 'surface',
      name: 'color/surface/default',
      resolvedType: 'COLOR',
      variableCollectionId: 'colors',
      codeSyntax: { WEB: 'var(--surface-default)' },
      valuesByMode: {
        light: { r: 1, g: 1, b: 1 },
        dark: { r: 0.05, g: 0.05, b: 0.07 },
      },
    },
    {
      id: 'accent',
      name: 'color/text/accent',
      resolvedType: 'COLOR',
      variableCollectionId: 'colors',
      valuesByMode: {
        light: { type: 'VARIABLE_ALIAS', id: 'primitive' },
        dark: { type: 'VARIABLE_ALIAS', id: 'primitive' },
      },
    },
    {
      id: 'space',
      name: 'space/component/md',
      resolvedType: 'FLOAT',
      variableCollectionId: 'spacing',
      valuesByMode: { mobile: 16, desktop: 24 },
    },
    {
      id: 'collision',
      name: 'space component md',
      resolvedType: 'FLOAT',
      variableCollectionId: 'spacing',
      valuesByMode: { mobile: 20, desktop: 28 },
    },
  ],
  textStyles: [{ name: 'Body/Medium', description: 'Default body copy.' }],
  components: [{
    id: 'button-set',
    name: 'Button',
    type: 'COMPONENT_SET',
    description: 'Primary interaction component.',
    componentPropertyDefinitions: { Tone: {}, Size: {} },
  }],
};

const stylesheet = makeGuidelines.serializeStylesheet(figmaData, 'orbit-system');
assert.ok(stylesheet.css.includes('--surface-default: #FFFFFF;'), 'valid Figma WEB syntax should win');
assert.ok(stylesheet.css.includes('--color-text-accent: #0066FF;'), 'aliases should resolve through non-exported primitives');
assert.ok(stylesheet.css.includes('[data-figma-mode="dark"]'), 'alternate Figma modes should get stable selectors');
assert.ok(stylesheet.css.includes('[data-figma-mode="desktop"]'), 'responsive-named modes should be represented without inventing breakpoints');
assert.ok(stylesheet.nameMap.some(row => row.source === 'codeSyntax.WEB'));
assert.ok(stylesheet.nameMap.some(row => row.collisionRepaired), 'fallback CSS collisions should be repaired deterministically');

const prepared = makeGuidelines.prepareMakeGuidelinesCore({
  ds: { project: { name: 'Orbit System' } },
  figmaData,
  profile: {},
});
assert.strictEqual(prepared.lint.valid, true);
assert.ok(prepared.model.suggestions.length > 0, 'vague areas should produce optional help');
assert.ok(prepared.manifest.some(file => file.path === 'guidelines/Guidelines.md'));
assert.ok(prepared.manifest.some(file => file.path === 'guidelines/setup.md'));
assert.ok(prepared.manifest.some(file => file.path === 'guidelines/styles.md'));
assert.ok(prepared.manifest.some(file => file.path === 'src/orbit-system/styles.css'));
assert.ok(prepared.manifest.some(file => file.path === 'guidelines/components.md'));
assert.ok(prepared.manifest.some(file => file.path === 'guidelines/components/overview.md'));
assert.ok(!prepared.manifest.some(file => /package\.json|node_modules|provider/i.test(file.path)), 'MVP must not generate package scaffolding');
const rootGuidelines = prepared.manifest.find(file => file.path === 'guidelines/Guidelines.md').content;
assert.ok(!rootGuidelines.includes('Product character:'), 'unapproved suggestions must not enter generated guidance');
assert.ok(rootGuidelines.includes('[components.md](./components.md)'), 'root guidance should route through the canonical component entrypoint');
const factsOnlyComponentIndex = prepared.manifest.find(file => file.path === 'guidelines/components.md').content;
assert.ok(factsOnlyComponentIndex.includes('[complete component catalog](./components/overview.md)'));
assert.ok(factsOnlyComponentIndex.includes('No component-specific usage specs are available.'));

const documented = makeGuidelines.prepareMakeGuidelinesCore({
  ds: { project: { name: 'Orbit System' } },
  figmaData: Object.assign({}, figmaData, {
    components: figmaData.components.concat([{
      id: 'card',
      name: 'Card',
      type: 'COMPONENT',
      description: 'Groups related content.',
      componentPropertyDefinitions: { Tone: {} },
    }]),
  }),
  componentSpecs: [
    {
      name: 'Button',
      path: 'component-specs/Button.md',
      content: '# Button\n\n## Usage\n\nUse for actions.',
    },
    {
      name: 'Card',
      path: 'component-specs/Card.md',
      content: '# Card\n\n## Usage\n\nUse for related content.',
    },
    {
      name: 'Tag 1.0.0',
      path: 'component-specs/Tag 1.0.0.md',
      content: '# Tag 1.0.0\n\n> Labels compact metadata.\n\n## Variable Modes\n\n| Mode | Purpose |\n| --- | --- |\n| Neutral | Metadata |\n| Danger | Warning |\n\n## Usage Rules\n\nUse for short labels.',
    },
  ],
});
assert.strictEqual(documented.lint.valid, true, JSON.stringify(documented.lint.errors));
const documentedComponentIndex = documented.manifest.find(file => file.path === 'guidelines/components.md').content;
assert.ok(documentedComponentIndex.includes('(./components/button.md)'));
assert.ok(documentedComponentIndex.includes('(./components/card.md)'));
assert.ok(documentedComponentIndex.includes('(./components/tag-1-0-0.md)'));
assert.ok(documented.manifest.some(file => file.path === 'guidelines/components/button.md'));
assert.ok(documented.manifest.some(file => file.path === 'guidelines/components/card.md'));
assert.ok(documented.manifest.some(file => file.path === 'guidelines/components/tag-1-0-0.md'));
assert.strictEqual(
  documented.model.components.find(component => component.name === 'Tag 1.0.0').source,
  'component-spec',
  'project component specs should seed Make guidance even when the current snapshot omits the component'
);
assert.ok(
  documented.manifest.find(file => file.path === 'guidelines/components/tag-1-0-0.md').content.includes('## Variable Modes'),
  'component-specific Make guidance should preserve variable-mode documentation'
);

const missingComponentRouteManifest = documented.manifest.map(file => (
  file.path === 'guidelines/components.md'
    ? Object.assign({}, file, { content: file.content.replace('(./components/card.md)', '(./components/overview.md)') })
    : file
));
const missingComponentRouteLint = makeGuidelines.lintMakeGuidelinesBundle(missingComponentRouteManifest);
assert.strictEqual(missingComponentRouteLint.valid, false);
assert.ok(
  missingComponentRouteLint.errors.includes('guidelines/components.md does not route to guidelines/components/card.md.'),
  'lint should prevent component specs from becoming unreachable'
);

const accepted = makeGuidelines.prepareMakeGuidelinesCore({
  ds: { project: { name: 'Orbit System' } },
  figmaData,
  profile: {
    productCharacter: 'Calm, precise, and compact.',
    compositionRules: ['Use one primary surface per focused task.'],
  },
});
assert.ok(accepted.manifest.find(file => file.path === 'guidelines/Guidelines.md').content.includes('Calm, precise, and compact.'));
assert.ok(accepted.manifest.some(file => file.path === 'guidelines/composition/overview.md'));

const skipped = makeGuidelines.prepareMakeGuidelinesCore({
  ds: { project: { name: 'Orbit System' } },
  figmaData,
  profile: { skippedSuggestions: ['all'] },
});
assert.deepStrictEqual(skipped.model.suggestions, [], 'Skip all should persist and prevent suggestions from recurring');

assert.deepStrictEqual(
  makeGuidelines.normalizeProfile({ unsupported: true }).errors,
  ['Unsupported profile field: unsupported.'],
  'profile schema should reject unknown fields instead of silently inventing behavior'
);

const configSnapshot = makeGuidelines.snapshotFromDsConfig({
  project: { name: 'Config Only' },
  collections: { primitives: 'Primitives', color: 'Color', spacing: 'Spacing', typography: 'Typography' },
  breakpoints: { modes: ['Mobile', 'Desktop'] },
  color: {
    ramps: [{ folder: 'color/primary', steps: [[500, 0.1, 0.2, 0.3]] }],
    semantics: { pairs: [], icons: [], unpaired: [] },
  },
  primitives: { spacing: [[100, 8], [200, 16]] },
  spacing: { semantic: { 'component/md': [16, 24] }, radius: { md: 8 }, border: { default: 1 } },
  typography: {
    families: { sans: 'Inter', mono: 'JetBrains Mono' },
    scale: { 'body/md': { sizes: [14, 16], lineHeights: [20, 24], weight: 400, tracking: 0 } },
  },
});
assert.ok(configSnapshot.variables.some(variable => variable.name === 'space/component/md'));
assert.ok(configSnapshot.variables.some(variable => variable.name === 'type/body/md/size'));
assert.ok(makeGuidelines.prepareMakeGuidelinesCore({
  ds: { project: { name: 'Config Only' } },
  figmaData: configSnapshot,
}).lint.valid, 'a prepared Figlets config should support guidelines generation before Figma contains the built variables');
