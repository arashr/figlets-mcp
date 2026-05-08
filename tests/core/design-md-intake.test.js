'use strict';

const assert = require('assert');
const { computeDsConfig, designMdIntake } = require('../../packages/figlets-core/src/ds-config/index.js');
const { designMdToDsConfig: convertDesignMd, dsConfigToDesignMd: exportDesignMd } = designMdIntake;

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
