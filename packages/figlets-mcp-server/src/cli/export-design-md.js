'use strict';

const path = require('path');
const { handleExportDesignMd } = require('../tools/export-design-md.js');
const { loadDotenv } = require('../utils/load-dotenv.js');

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node packages/figlets-mcp-server/src/cli/export-design-md.js [options]',
      '',
      'Options:',
      '  --config <path>          Absolute path to design-system.config.js (defaults to active file config)',
      '  --output <path>          Output path for DESIGN.md (defaults to DESIGN.md next to the config)',
      '  --figma-data <path>      Use this figma-data.json snapshot instead of running sync_figma_data',
      '  --skip-sync              Skip the sync step and use whatever snapshot is already on disk',
      '  --dry-run                Preview the export without writing design-system.config.js or DESIGN.md',
      '  --json                   Print the full handler result as JSON',
      '  --help, -h               Show this message',
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
    else if (arg === '--config') { opts.config_path = path.resolve(next); i++; }
    else if (arg === '--output') { opts.output_path = path.resolve(next); i++; }
    else if (arg === '--figma-data') { opts.figmaDataPath = path.resolve(next); i++; }
    else if (arg === '--skip-sync') opts.skip_sync = true;
    else if (arg === '--dry-run') opts.dry_run = true;
    else if (arg === '--json') opts.json = true;
    else {
      process.stderr.write('Unknown argument: ' + arg + '\n');
      process.exit(2);
    }
  }
  return opts;
}

function _renderChange(change) {
  if (change.kind === 'brand') return '  - brand ' + change.name + ' (step ' + change.step + ') ' + (change.from || 'unset') + ' -> ' + change.to;
  if (change.kind === 'ramp-step') return '  - ramp ' + change.name + ' updated';
  if (change.kind === 'semantic-alias') return '  - ' + change.token + ' (' + change.mode + '/' + change.slot + ') ' + (change.from || 'unset') + ' -> ' + change.to;
  return '  - ' + JSON.stringify(change);
}

function _printPlain(result) {
  const lines = [];
  lines.push('DESIGN.md export');
  lines.push('================');
  lines.push('Config:       ' + result.configPath);
  lines.push('Output:       ' + (result.designMd && result.designMd.path ? result.designMd.path : '(none)'));
  if (result.sync) {
    if (result.sync.attempted) {
      lines.push('Sync:         ' + (result.sync.completed ? 'OK' : 'failed'));
    } else {
      lines.push('Sync:         skipped');
    }
    if (result.sync.syncedAt) lines.push('Snapshot:     ' + result.sync.snapshotPath + ' (synced ' + result.sync.syncedAt + ')');
  }
  if (result.refresh) {
    const summary = result.refresh.summary || { changedCount: 0, skippedCount: 0 };
    lines.push('Refresh:      ' + summary.changedCount + ' changed, ' + summary.skippedCount + ' skipped' + (result.refresh.dryRun ? ' (dry run)' : ''));
    if (Array.isArray(result.refresh.changes) && result.refresh.changes.length) {
      for (const change of result.refresh.changes) lines.push(_renderChange(change));
    }
  }
  if (result.dryRun) {
    lines.push('');
    lines.push('Dry run: no files were written.');
  } else if (result.designMd && result.designMd.written) {
    lines.push('');
    lines.push('DESIGN.md exported to ' + result.designMd.path);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

async function main() {
  loadDotenv();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }

  const args = {};
  if (opts.config_path) args.config_path = opts.config_path;
  if (opts.output_path) args.output_path = opts.output_path;
  if (opts.figmaDataPath) args.figmaDataPath = opts.figmaDataPath;
  if (opts.skip_sync) args.skip_sync = true;
  if (opts.dry_run) args.dry_run = true;

  const result = await handleExportDesignMd(args);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result && result.error) {
    process.stderr.write('Error: ' + result.error + '\n');
    if (result.hint) process.stderr.write('Hint:  ' + result.hint + '\n');
  } else {
    _printPlain(result);
  }

  if (result && result.error) process.exit(1);
}

main().catch((err) => {
  process.stderr.write('Fatal: ' + err.message + '\n');
  process.exit(1);
});
