'use strict';

const FIGLETS_TOUCH_MINIMUM_PX = 44;

function isPlaceholderProjectName(value) {
  return !value || /^(?:untitled|imported figma design system|figlets design system)$/i.test(String(value).trim());
}

function _values(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function _modeNames(ds, valueCount) {
  const configured = ds && ds.breakpoints && Array.isArray(ds.breakpoints.modes)
    ? ds.breakpoints.modes
    : [];
  if (configured.length) return configured;
  return Array.from({ length: Math.max(1, valueCount) }, (_, index) => 'mode ' + (index + 1));
}

function validateDesignSystemPolicy(ds) {
  const findings = [];
  const name = ds && ds.project && ds.project.name;
  if (isPlaceholderProjectName(name)) {
    findings.push({
      severity: 'warning',
      path: 'name',
      message: 'The design-system name is a missing or known placeholder value. Supply the exact design_system_name before export.',
      rule: 'figlets-placeholder-project-name',
    });
  }

  const semantic = ds && ds.spacing && ds.spacing.semantic || {};
  const touchMin = _values(semantic['touch/min']);
  const touchComfortable = _values(semantic['touch/comfortable']);
  const modes = _modeNames(ds, Math.max(touchMin.length, touchComfortable.length));

  if (!touchMin.length) {
    findings.push({
      severity: 'warning',
      path: 'spacing.touch/min',
      message: 'touch/min is missing. Figlets requires a 44px minimum interactive target in every mode.',
      rule: 'figlets-touch-target-required',
    });
    return findings;
  }

  if (touchMin.length < modes.length) {
    findings.push({
      severity: 'warning',
      path: 'spacing.touch/min',
      message: 'touch/min defines ' + touchMin.length + ' value(s) for ' + modes.length + ' responsive mode(s). Define one value for every mode.',
      rule: 'figlets-touch-target-mode-coverage',
    });
  }

  for (let index = 0; index < modes.length; index++) {
    const value = Number(touchMin[index]);
    if (!Number.isFinite(value)) {
      findings.push({
        severity: 'warning',
        path: 'spacing.touch/min.' + modes[index],
        message: 'touch/min has no numeric value for ' + modes[index] + '. Figlets requires 44px in every mode.',
        rule: 'figlets-touch-target-mode-coverage',
      });
    } else if (value < FIGLETS_TOUCH_MINIMUM_PX) {
      findings.push({
        severity: 'warning',
        path: 'spacing.touch/min.' + modes[index],
        message: 'touch/min is ' + value + 'px in ' + modes[index] + '; the Figlets accessibility minimum is 44px. Use touch/compact for an intentional dense visual treatment while preserving a 44px interactive target.',
        rule: 'figlets-touch-target-minimum',
      });
    }
  }

  if (touchComfortable.length) {
    if (touchComfortable.length < modes.length) {
      findings.push({
        severity: 'warning',
        path: 'spacing.touch/comfortable',
        message: 'touch/comfortable defines ' + touchComfortable.length + ' value(s) for ' + modes.length + ' responsive mode(s), so its relationship to touch/min cannot be verified in every mode.',
        rule: 'figlets-touch-comfortable-mode-coverage',
      });
    }
    for (let index = 0; index < modes.length; index++) {
      const minimum = Number(touchMin[index]);
      const comfortable = Number(touchComfortable[index]);
      if (!Number.isFinite(minimum) || !Number.isFinite(comfortable) || comfortable >= minimum) continue;
      findings.push({
        severity: 'warning',
        path: 'spacing.touch/comfortable.' + modes[index],
        message: 'touch/comfortable is ' + comfortable + 'px in ' + modes[index] + ', below touch/min at ' + minimum + 'px.',
        rule: 'figlets-touch-target-order',
      });
    }
  }

  return findings;
}

module.exports = {
  FIGLETS_TOUCH_MINIMUM_PX,
  isPlaceholderProjectName,
  validateDesignSystemPolicy,
};
