'use strict';

const fs = require('fs');
const path = require('path');
const {
  getActiveFileConfigPath,
  getConfigPathGuardError,
} = require('../utils/paths.js');
const { handleSyncFigmaData } = require('./sync-figma-data.js');
const { handleRefreshDsConfigFromFigma } = require('./refresh-ds-config-from-figma.js');

const exportDesignMdTool = {
  name: 'export_design_md',
  description: 'Export a portable DESIGN.md describing the current design system. By default syncs the Figma file, refreshes design-system.config.js from the latest snapshot, then writes DESIGN.md next to the config. Pass dry_run to preview without writing.',
  inputSchema: {
    type: 'object',
    properties: {
      config_path: {
        type: 'string',
        description: 'Optional absolute path to design-system.config.js. Defaults to the active file config.'
      },
      output_path: {
        type: 'string',
        description: 'Optional absolute path for the DESIGN.md output. Defaults to DESIGN.md next to the config.'
      },
      figmaDataPath: {
        type: 'string',
        description: 'Optional path to a figma-data.json snapshot. When provided, the sync_figma_data step is skipped and this snapshot is used directly.'
      },
      skip_sync: {
        type: 'boolean',
        description: 'When true, skip the sync_figma_data step and use whatever snapshot is already on disk. Useful for re-exporting without round-tripping to Figma.'
      },
      dry_run: {
        type: 'boolean',
        description: 'When true, do not write design-system.config.js or DESIGN.md; report what would change.'
      }
    },
    additionalProperties: false
  }
};

function _loadDesignMdIntake() {
  try {
    return require('@figlets/core').dsConfig.designMdIntake;
  } catch (_) {
    return require('../../../figlets-core/src/ds-config/index.js').designMdIntake;
  }
}

function _statSyncedAt(filePath) {
  if (!filePath) return null;
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toISOString();
  } catch (_) {
    return null;
  }
}

function _siblingSnapshotPath(configPath) {
  if (!configPath) return null;
  const candidate = path.join(path.dirname(configPath), 'figma-data.json');
  return fs.existsSync(candidate) ? candidate : null;
}

async function handleExportDesignMd(args) {
  args = args || {};
  const dryRun = !!args.dry_run;

  const configPath = args.config_path
    ? path.resolve(args.config_path)
    : getActiveFileConfigPath();
  if (!configPath) {
    return {
      error: 'No active file-scoped config path found.',
      hint: 'Run sync_figma_data and prepare_ds_config / apply_ds_setup for a Figma file first.'
    };
  }
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;
  if (!fs.existsSync(configPath)) {
    return {
      error: 'design-system.config.js not found: ' + configPath,
      hint: 'Run setup (prepare_ds_config / apply_ds_setup) for this Figma file first, or create one from DESIGN.md with create_ds_config_from_design_md.'
    };
  }

  const explicitSnapshotPath = typeof args.figmaDataPath === 'string' && args.figmaDataPath.length > 0
    ? path.resolve(args.figmaDataPath)
    : null;
  // When a caller targets a specific config file, prefer the snapshot next to
  // that config over the process-wide active file. This keeps custom exports
  // from accidentally refreshing against a different open Figma file.
  const inferredSnapshotPath = explicitSnapshotPath
    ? null
    : (args.config_path ? _siblingSnapshotPath(configPath) : null);
  const snapshotPathForRefresh = explicitSnapshotPath || inferredSnapshotPath;
  const shouldSync = !args.skip_sync && !snapshotPathForRefresh;

  let synced = false;
  if (shouldSync) {
    try {
      await handleSyncFigmaData();
      synced = true;
    } catch (err) {
      return {
        error: 'Figma sync failed before export: ' + err.message,
        hint: 'Open the Figlets Bridge plugin in Figma Desktop, or pass skip_sync: true to export from the cached snapshot.'
      };
    }
  }

  const refreshArgs = {
    config_path: configPath,
    dry_run: dryRun,
  };
  if (snapshotPathForRefresh) refreshArgs.figmaDataPath = snapshotPathForRefresh;

  const refresh = handleRefreshDsConfigFromFigma(refreshArgs);
  if (refresh && refresh.error) {
    return {
      error: 'Config refresh failed before export: ' + refresh.error,
      hint: refresh.hint || 'Verify the synced snapshot is current and the config matches.'
    };
  }

  const outputPath = args.output_path
    ? path.resolve(args.output_path)
    : path.join(path.dirname(configPath), 'DESIGN.md');

  let designMdPath = null;
  let written = false;
  if (!dryRun) {
    const intake = _loadDesignMdIntake();
    if (!intake || typeof intake.writeDesignMdFromDsConfig !== 'function') {
      return { error: 'DESIGN.md exporter not available in figlets-core.' };
    }
    try {
      designMdPath = intake.writeDesignMdFromDsConfig(configPath, outputPath);
      written = true;
    } catch (err) {
      return { error: 'Failed to write DESIGN.md: ' + err.message };
    }
  } else {
    designMdPath = outputPath;
  }

  const snapshotPath = refresh.source && refresh.source.path ? refresh.source.path : null;
  const syncedAt = _statSyncedAt(snapshotPath);

  return {
    dryRun,
    configPath,
    designMd: {
      path: designMdPath,
      written,
    },
    sync: {
      attempted: shouldSync,
      completed: synced,
      snapshotPath,
      syncedAt,
    },
    refresh: {
      dryRun: !!refresh.dryRun,
      changes: refresh.changes || [],
      skipped: refresh.skipped || [],
      summary: refresh.summary || { changedCount: 0, skippedCount: 0 },
    },
    message: dryRun
      ? 'Export dry run complete. No files were written.'
      : (written
        ? 'DESIGN.md exported to ' + designMdPath
        : 'DESIGN.md export did not run.')
  };
}

module.exports = {
  exportDesignMdTool,
  handleExportDesignMd,
};
