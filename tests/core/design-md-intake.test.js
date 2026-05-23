'use strict';

const assert = require('assert');
const { computeDsConfig, designMdIntake } = require('../../packages/figlets-core/src/ds-config/index.js');
const { designMdToDsConfig: convertDesignMd, readDesignMdAsDsConfig, dsConfigToDesignMd: exportDesignMd } = designMdIntake;

const markdown = `---
version: "alpha"
name: Heritage
description: "Editorial product system"
colors:
  primary: "#1A1C1E"
  secondary: "#6C7278"
  tertiary: "#B8422E"
  neutral: "#F7F5F2"
typography:
  h1:
    fontFamily: Public Sans
    fontSize: 3rem
    fontWeight: 700
    lineHeight: 3.5rem
  body-md:
    fontFamily: Public Sans
    fontSize: 1rem
    lineHeight: 1.5rem
spacing:
  sm: 8px
  md: 16px
rounded:
  sm: 4px
---

## Overview

Architectural Minimalism.
`;

const result = convertDesignMd(markdown, { sourcePath: '/tmp/DESIGN.md' });

assert.strictEqual(result.ds.project.name, 'Heritage');
assert.strictEqual(result.ds.typography.families.sans, 'Public Sans');
assert.strictEqual(result.ds.typography.scalePreset, 'custom');
assert.strictEqual(result.ds.typography.scale['display/lg'].sizes[0], 48);
assert.strictEqual(result.ds.typography.scale['body/md'].lineHeights[0], 24);
assert.strictEqual(result.ds.grid.base, 8);
assert.deepStrictEqual(
  result.ds.color.brand.map(c => [c.name, c.hex, c.role]),
  [
    ['primary', '#1A1C1E', 'primary'],
    ['secondary', '#6C7278', 'secondary'],
    ['tertiary', '#B8422E', 'accent']
  ]
);

const computed = computeDsConfig(result.ds);
assert.deepStrictEqual(computed.needsDesignerInput, [], 'imported custom DESIGN.md typography should count as answered intake');

const exported = exportDesignMd(result.ds);
assert.ok(exported.includes('name: "Heritage"'), 'export should preserve project name');
assert.ok(exported.includes('colors:'), 'export should include colors');
assert.ok(exported.includes('typography:'), 'export should include typography');
assert.ok(exported.includes('## Overview'), 'export should include markdown rationale section');

const fs = require('fs');
const path = require('path');
const fixtureDir = path.join(__dirname, '../fixtures/md-gallery');
const markdownOnly = fs.readFileSync(path.join(fixtureDir, 'DESIGN.md'), 'utf8');
const markdownResult = convertDesignMd(markdownOnly, { sourcePath: path.join(fixtureDir, 'DESIGN.md') });

assert.strictEqual(markdownResult.parsedFromFrontMatter, false);
assert.strictEqual(markdownResult.parsedFromMarkdown.projectName, 'MD Gallery');
assert.strictEqual(markdownResult.parsedFromMarkdown.rules.contrastStandard, 'apca');
assert.strictEqual(markdownResult.parsedFromMarkdown.rules.gridBase, 8);
assert.strictEqual(markdownResult.parsedFromMarkdown.rules.colorAlgorithm, 'oklch');
assert.strictEqual(markdownResult.parsedFromMarkdown.rules.backgroundFirstForegroundPairing, true);
assert.strictEqual(markdownResult.parsedFromMarkdown.rules.lightDarkBehavior, 'dark-chrome-only');
assert.ok(
  markdownResult.linkedConfigCandidates.some(entry => entry.path === 'config/gallery.config.json'),
  'should detect linked JSON config candidate'
);
assert.ok(markdownResult.needsDesignerInput.includes('platform'));
assert.ok(!markdownResult.needsDesignerInput.includes('grid base (4px/8px)'));
assert.ok(!markdownResult.needsDesignerInput.includes('contrast standard (APCA default / WCAG 2.2)'));

const linkedResult = convertDesignMd(markdownOnly, {
  sourcePath: path.join(fixtureDir, 'DESIGN.md'),
  linkedConfigPath: path.join(fixtureDir, 'config/gallery.config.json')
});
assert.strictEqual(linkedResult.mapped.linkedConfigUsed, true);
assert.ok(linkedResult.mapped.brandColors >= 2);
assert.strictEqual(linkedResult.ds.typography.families.sans, 'Inconsolata');
assert.ok(linkedResult.ds.typography.scale['body/md']);
assert.ok(!linkedResult.needsDesignerInput.includes('color scale and brand colors (name + hex)'));
assert.ok(!linkedResult.needsDesignerInput.includes('light/dark behavior'));

const autoLinked = readDesignMdAsDsConfig(path.join(fixtureDir, 'DESIGN.md'));
assert.strictEqual(autoLinked.mapped.linkedConfigUsed, true);
assert.ok(autoLinked.mapped.brandColors >= 2);
