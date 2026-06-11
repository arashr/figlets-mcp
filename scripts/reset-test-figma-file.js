#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_SEED = 'bnn-53-smoke';
const DEFAULT_EXPECTED_FILE_NAME = 'Figlets Test';

function usage() {
  return [
    'Usage: node scripts/reset-test-figma-file.js [--seed <seed>] [--expected-file-name <name>] [--config <path>]',
    '',
    'Developer daily-driver for resetting the disposable Figlets test file.',
    'Defaults: --seed ' + DEFAULT_SEED + ' --expected-file-name "' + DEFAULT_EXPECTED_FILE_NAME + '"',
    '',
    'This command enables FIGLETS_DEV_BRIDGE=1 and delegates to prepare-broken-ds-fixture with',
    'the destructive confirmation flag. Keep the expected file-name guard on unless you are',
    'intentionally preparing a differently named disposable file.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    seed: DEFAULT_SEED,
    expectedFileName: DEFAULT_EXPECTED_FILE_NAME,
    configPath: '',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seed') args.seed = argv[++i] || '';
    else if (arg === '--expected-file-name') args.expectedFileName = argv[++i] || '';
    else if (arg === '--config') args.configPath = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error('Unknown argument: ' + arg);
  }

  if (!args.seed) throw new Error('--seed must not be empty.');
  if (!args.expectedFileName) throw new Error('--expected-file-name must not be empty.');
  if (!args.configPath) {
    args.configPath = path.join('.local', args.seed + '-broken-fixture', 'design-system.config.js');
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message || err);
    console.error('');
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  const prepScript = path.join(__dirname, 'prepare-broken-ds-fixture.js');
  const prepArgs = [
    prepScript,
    '--yes-i-understand-this-mutates-figma',
    '--seed',
    args.seed,
    '--config',
    args.configPath,
    '--expected-file-name',
    args.expectedFileName,
  ];

  const result = spawnSync(process.execPath, prepArgs, {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, { FIGLETS_DEV_BRIDGE: '1' }),
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message || result.error);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

main();
