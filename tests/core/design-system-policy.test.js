'use strict';

const assert = require('assert');
const { designSystemPolicy } = require('../../packages/figlets-core/src/ds-config');

function makeDs(semantic, modes) {
  return {
    project: { name: 'Policy Test' },
    breakpoints: { modes: modes || ['Mobile', 'Tablet', 'Desktop'] },
    spacing: { semantic: semantic || {} },
  };
}

{
  const findings = designSystemPolicy.validateDesignSystemPolicy(makeDs({
    'touch/min': [44, 44, 44],
    'touch/comfortable': [48, 48, 48],
    'touch/compact': [32, 32, 32],
  }));
  assert.deepStrictEqual(findings, [], 'valid generated touch policy should pass');
}

{
  const findings = designSystemPolicy.validateDesignSystemPolicy(makeDs({
    'touch/min': [44, 44, 32],
    'touch/comfortable': [48, 48, 40],
  }));
  const advisory = findings.find(finding => finding.rule === 'figlets-touch-target-minimum');
  assert.ok(advisory);
  assert.strictEqual(advisory.blocking, false);
  assert.match(advisory.message, /For AAA accessibility standards/);
}

{
  const findings = designSystemPolicy.validateDesignSystemPolicy(makeDs({
    'touch/min': [44, 44],
  }));
  assert.ok(findings.some(finding => finding.rule === 'figlets-touch-target-mode-coverage'));
}

{
  const findings = designSystemPolicy.validateDesignSystemPolicy(makeDs({
    'touch/min': [44, 44, 44],
    'touch/comfortable': [48, 40, 48],
  }));
  assert.ok(findings.some(finding => finding.rule === 'figlets-touch-target-order'));
}

{
  const findings = designSystemPolicy.validateDesignSystemPolicy(makeDs({
    'touch/min': [44, 44, 44],
    'touch/comfortable': [48, 48],
  }));
  assert.ok(findings.some(finding => finding.rule === 'figlets-touch-comfortable-mode-coverage'));
}

{
  const findings = designSystemPolicy.validateDesignSystemPolicy(makeDs({}));
  assert.ok(findings.some(finding => finding.rule === 'figlets-touch-target-required' && finding.blocking === false));
}
