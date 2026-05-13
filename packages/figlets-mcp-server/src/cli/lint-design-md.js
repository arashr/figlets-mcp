'use strict';

const fs = require('fs');
const path = require('path');
const { getActiveFilePaths } = require('../utils/paths.js');

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node packages/figlets-mcp-server/src/cli/lint-design-md.js [options]',
      '',
      'Options:',
      '  --file <path>       Absolute path to a DESIGN.md file (defaults to DESIGN.md next to the active file-scoped config)',
      '  --json              Print the full lint report as JSON',
      '  --help, -h          Show this message',
      ''
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--file') { opts.file = path.resolve(next); i++; }
    else if (arg === '--json') opts.json = true;
    else {
      process.stderr.write('Unknown argument: ' + arg + '\n');
      process.exit(2);
    }
  }
  return opts;
}

function _defaultDesignMdPath() {
  const active = getActiveFilePaths();
  if (!active || !active.config) return null;
  return path.join(path.dirname(active.config), 'DESIGN.md');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }

  const target = opts.file || _defaultDesignMdPath();
  if (!target) {
    process.stderr.write('No DESIGN.md path provided and no active file-scoped config found.\n');
    process.stderr.write('Hint: pass --file </absolute/path/to/DESIGN.md>.\n');
    process.exit(2);
  }
  if (!fs.existsSync(target)) {
    process.stderr.write('DESIGN.md not found: ' + target + '\n');
    process.exit(2);
  }

  let lint;
  try {
    ({ lint } = await import('@google/design.md/linter'));
  } catch (err) {
    process.stderr.write('Could not load @google/design.md: ' + err.message + '\n');
    process.stderr.write('Install it with: npm install --save-dev @google/design.md\n');
    process.exit(2);
  }

  const markdown = fs.readFileSync(target, 'utf8');
  const report = lint(markdown);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      target: target,
      sections: report.sections,
      summary: report.summary,
      findings: report.findings
    }, null, 2) + '\n');
  } else {
    const summary = report.summary || { errors: 0, warnings: 0, infos: 0 };
    process.stdout.write('Linting ' + target + '\n');
    process.stdout.write('Sections: ' + (report.sections || []).join(' -> ') + '\n');
    process.stdout.write('Findings: ' + summary.errors + ' error(s), ' + summary.warnings + ' warning(s), ' + summary.infos + ' info(s)\n');
    for (const f of report.findings || []) {
      process.stdout.write('  [' + (f.severity || '?') + '] ' + (f.rule || '?') + ': ' + (f.message || '') + '\n');
    }
  }

  if (report.summary && report.summary.errors > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write('Fatal: ' + err.message + '\n');
  process.exit(1);
});
