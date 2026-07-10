'use strict';

const fs = require('fs');
const path = require('path');
const {
  getActiveFileConfigPath,
  getConfigPathGuardError,
} = require('../utils/paths.js');
const { bootstrapDsFromSnapshot } = require('../utils/bootstrap-ds-from-figma.js');
const { loadActiveFigmaDataSource, loadFigmaDataSource } = require('../bridges/figma-data-source.js');
const { handleSyncFigmaData } = require('./sync-figma-data.js');
const { handleRefreshDsConfigFromFigma } = require('./refresh-ds-config-from-figma.js');

const exportDesignMdTool = {
  name: 'export_design_md',
  description: 'Export a portable DESIGN.md describing the current design system. By default syncs the Figma file, refreshes design-system.config.js from the latest snapshot, then writes specs/DESIGN.md in the opened project directory, falling back to DESIGN.md next to the config when the project path is not writable. If no config exists yet, creates a local snapshot-derived config from Figma variables before exporting. Pass dry_run to preview without writing.',
  inputSchema: {
    type: 'object',
    properties: {
      config_path: {
        type: 'string',
        description: 'Optional absolute path to design-system.config.js. Defaults to the active file config.'
      },
      output_path: {
        type: 'string',
        description: 'Optional absolute path for the DESIGN.md output. Defaults to specs/DESIGN.md in the opened project directory, with a config-folder fallback.'
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
    return require("../figlets-core.js").dsConfig.designMdIntake;
  } catch (_) {
    return require("../figlets-core.js").dsConfig.designMdIntake;
  }
}

function _loadDsConfigCore() {
  try {
    return require("../figlets-core.js").dsConfig;
  } catch (_) {
    return require("../figlets-core.js").dsConfig;
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

function _writeDsConfig(configPath, ds) {
  const core = _loadDsConfigCore();
  if (!core || typeof core.writeDsConfig !== 'function') {
    throw new Error('DS config writer not available in figlets-core.');
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  core.writeDsConfig(configPath, ds);
}

function _siblingSnapshotPath(configPath) {
  if (!configPath) return null;
  const candidate = path.join(path.dirname(configPath), 'figma-data.json');
  return fs.existsSync(candidate) ? candidate : null;
}

function _defaultProjectDesignMdPath() {
  return path.resolve(process.cwd(), 'specs', 'DESIGN.md');
}

function _fallbackDesignMdPath(configPath) {
  return path.join(path.dirname(configPath), 'DESIGN.md');
}

function _resolveOutputTarget(args, configPath) {
  if (args.output_path) {
    return {
      path: path.resolve(args.output_path),
      requestedPath: path.resolve(args.output_path),
      fallbackPath: null,
      defaultKind: 'explicit',
    };
  }
  const requestedPath = _defaultProjectDesignMdPath();
  return {
    path: requestedPath,
    requestedPath,
    fallbackPath: _fallbackDesignMdPath(configPath),
    defaultKind: 'project-specs',
  };
}

function _countObjectKeys(value) {
  return value && typeof value === 'object' ? Object.keys(value).length : 0;
}

function _snapshotPathFromSource(dataSource) {
  return dataSource && dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null;
}

function _loadSnapshotForBootstrap(configPath, snapshotPathForRefresh) {
  if (snapshotPathForRefresh) {
    return loadFigmaDataSource({ figmaDataPath: snapshotPathForRefresh });
  }
  if (configPath) {
    const sibling = _siblingSnapshotPath(configPath);
    if (sibling) return loadFigmaDataSource({ figmaDataPath: sibling });
  }
  return loadActiveFigmaDataSource() || loadFigmaDataSource();
}

function _bootstrapSummary(ds) {
  const spacing = ds.spacing || {};
  const typeScale = ds.typography && ds.typography.scale ? ds.typography.scale : {};
  const semantics = ds.color && ds.color.semantics ? ds.color.semantics : {};
  return {
    collections: ds.collections || {},
    colorRamps: Array.isArray(ds.color && ds.color.ramps) ? ds.color.ramps.length : 0,
    brandRoles: Array.isArray(ds.color && ds.color.brand) ? ds.color.brand.length : 0,
    semanticPairs: Array.isArray(semantics.pairs) ? semantics.pairs.length : 0,
    spacingTokens: _countObjectKeys(spacing.semantic),
    radiusTokens: _countObjectKeys(spacing.radius),
    borderTokens: _countObjectKeys(spacing.border),
    typographyRoles: _countObjectKeys(typeScale),
    elevationStyles: _countObjectKeys(ds.elevation),
  };
}

function _needsDesignerInput(ds) {
  const items = [];
  const modes = ds.breakpoints && Array.isArray(ds.breakpoints.modes) ? ds.breakpoints.modes : [];
  items.push({
    field: 'project.platform',
    question: 'What platform or implementation target should this DESIGN.md speak to?',
    reason: 'Figma snapshots expose tokens and modes, but not the intended code platform.',
  });
  if (modes.length > 1) {
    items.push({
      field: 'breakpoints.widths',
      question: 'What pixel widths define these responsive modes: ' + modes.join(', ') + '?',
      reason: 'Figma variable modes provide names, not CSS breakpoint thresholds.',
    });
  }
  if (!ds.color || !ds.color.semantics || !Array.isArray(ds.color.semantics.pairs) || ds.color.semantics.pairs.length === 0) {
    items.push({
      field: 'color.semanticPairs',
      question: 'Which background/text/icon/border color roles should be treated as paired usage contexts?',
      reason: 'Existing variables were preserved, but reliable semantic pairings were not obvious from names alone.',
    });
  } else {
    items.push({
      field: 'color.semanticNaming',
      question: 'Does the inferred semantic color pairing grammar match how this system should be documented?',
      reason: 'Pairing was inferred from token names and aliases and should be confirmed before treating it as policy.',
    });
  }
  if (!ds.typography || !ds.typography.families || !Object.keys(ds.typography.families).length) {
    items.push({
      field: 'typography.families',
      question: 'What primary and monospace font families should the handoff name?',
      reason: 'No explicit font-family variables or text styles were available in the snapshot.',
    });
  }
  return items;
}

function _refreshResultForBootstrap() {
  return {
    dryRun: false,
    changes: [],
    skipped: [],
    summary: { changedCount: 0, skippedCount: 0 },
  };
}

function _writeDesignMdFromConfig(intake, configPath, outputTarget, options) {
  const attempts = [outputTarget.path];
  if (
    outputTarget.fallbackPath &&
    path.resolve(outputTarget.fallbackPath) !== path.resolve(outputTarget.path)
  ) {
    attempts.push(outputTarget.fallbackPath);
  }

  let firstError = null;
  for (let i = 0; i < attempts.length; i++) {
    const attemptPath = attempts[i];
    try {
      fs.mkdirSync(path.dirname(attemptPath), { recursive: true });
      const writtenPath = intake.writeDesignMdFromDsConfig(configPath, attemptPath, options);
      return {
        path: writtenPath,
        fallbackUsed: i > 0,
        requestedPath: outputTarget.requestedPath,
        fallbackPath: outputTarget.fallbackPath,
        writeError: i > 0 && firstError ? firstError.message : null,
      };
    } catch (err) {
      if (!firstError) firstError = err;
      if (!outputTarget.fallbackPath || i === attempts.length - 1) throw err;
    }
  }
  throw firstError || new Error('Failed to write DESIGN.md.');
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

  const outputTarget = _resolveOutputTarget(args, configPath);

  let bootstrap = null;
  let needsDesignerInput = [];
  let refresh = null;
  let latestFigmaData = null;

  if (!fs.existsSync(configPath)) {
    let dataSource = null;
    try {
      dataSource = _loadSnapshotForBootstrap(configPath, snapshotPathForRefresh);
    } catch (err) {
      return {
        error: 'Unable to load Figma snapshot for missing config: ' + err.message,
        hint: 'Open the Figlets Bridge plugin and retry, or pass figmaDataPath to a synced figma-data.json snapshot.',
      };
    }
    if (!dataSource || !dataSource.figmaData) {
      return {
        error: 'design-system.config.js not found and no Figma snapshot was available: ' + configPath,
        hint: 'Open the Figlets Bridge plugin and retry, or pass figmaDataPath to a synced figma-data.json snapshot.',
      };
    }
    latestFigmaData = dataSource.figmaData;

    const ds = bootstrapDsFromSnapshot(dataSource.figmaData);
    if (!dryRun) {
      try {
        _writeDsConfig(configPath, ds);
      } catch (err) {
        return { error: 'Failed to write snapshot-derived design-system.config.js: ' + err.message };
      }
    }
    bootstrap = {
      created: !dryRun,
      configPath,
      source: 'figma-snapshot-bootstrap',
      reason: 'missing-config',
      snapshotPath: _snapshotPathFromSource(dataSource),
      summary: _bootstrapSummary(ds),
    };
    needsDesignerInput = _needsDesignerInput(ds);
    refresh = _refreshResultForBootstrap();
  }

  if (!refresh) {
    const refreshArgs = {
      config_path: configPath,
      dry_run: dryRun,
    };
    if (snapshotPathForRefresh) refreshArgs.figmaDataPath = snapshotPathForRefresh;

    refresh = handleRefreshDsConfigFromFigma(refreshArgs);
    if (refresh && refresh.error) {
      return {
        error: 'Config refresh failed before export: ' + refresh.error,
        hint: refresh.hint || 'Verify the synced snapshot is current and the config matches.'
      };
    }
  }

  const snapshotPath = (refresh.source && refresh.source.path ? refresh.source.path : null)
    || (bootstrap && bootstrap.snapshotPath)
    || snapshotPathForRefresh
    || null;
  const syncedAt = _statSyncedAt(snapshotPath);
  if (!latestFigmaData && snapshotPath) {
    try {
      const dataSource = loadFigmaDataSource({ figmaDataPath: snapshotPath });
      latestFigmaData = dataSource && dataSource.figmaData ? dataSource.figmaData : null;
    } catch (_) {}
  }

  let designMdPath = null;
  let written = false;
  let output = {
    requestedPath: outputTarget.requestedPath,
    fallbackPath: outputTarget.fallbackPath,
    fallbackUsed: false,
    defaultKind: outputTarget.defaultKind,
    writeError: null,
  };
  if (!dryRun) {
    const intake = _loadDesignMdIntake();
    if (!intake || typeof intake.writeDesignMdFromDsConfig !== 'function') {
      return { error: 'DESIGN.md exporter not available in figlets-core.' };
    }
    try {
      const writeResult = _writeDesignMdFromConfig(
        intake,
        configPath,
        outputTarget,
        latestFigmaData ? { figmaData: latestFigmaData } : null
      );
      designMdPath = writeResult.path;
      output = Object.assign(output, writeResult);
      written = true;
    } catch (err) {
      return { error: 'Failed to write DESIGN.md: ' + err.message };
    }
  } else {
    designMdPath = outputTarget.path;
  }

  return {
    dryRun,
    configPath,
    designMd: {
      path: designMdPath,
      written,
      output,
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
    bootstrap,
    needsDesignerInput,
    message: dryRun
      ? (bootstrap
        ? 'Export dry run complete. No files were written; Figlets found enough snapshot data to create a local config and DESIGN.md.'
        : 'Export dry run complete. No files were written.')
      : (written
        ? (bootstrap
          ? 'Snapshot-derived design-system.config.js created and DESIGN.md exported to ' + designMdPath
          : 'DESIGN.md exported to ' + designMdPath)
        : 'DESIGN.md export did not run.')
  };
}

module.exports = {
  exportDesignMdTool,
  handleExportDesignMd,
};
