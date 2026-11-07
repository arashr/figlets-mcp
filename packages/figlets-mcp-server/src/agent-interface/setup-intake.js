'use strict';

const { defaultMotionProfile } = require('../figlets-core.js').dsConfig;

const MOTION_INTAKE_SELECTION = {
  type: 'single-choice',
  message: 'Include motion foundations?\n\n1. Include motion\n2. Skip for now',
  choices: [
    { id: 'include-motion', label: 'Include motion', input: { motion_choice: 'include', motion_profile: 'default' } },
    { id: 'skip-motion', label: 'Skip for now', input: { motion_choice: 'skip' } },
  ],
  preset: {
    label: 'Standard motion',
    profile: defaultMotionProfile(),
    description: 'Durations of 0, 100, 200, and 300ms; linear, standard, enter, and exit curves. Reduced Motion uses 0ms and linear easing. Custom settings are allowed.',
  },
};

module.exports = { MOTION_INTAKE_SELECTION };
