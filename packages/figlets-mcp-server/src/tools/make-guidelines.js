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

const prepareMakeGuidelinesTool = {
  name: 'prepare_make_guidelines',
  description: 'Prepare a read-only preview for a Figma Make guidelines bundle from the current Figlets config, Figma snapshot, and every project-scoped component-specs/*.md file. Reports component-spec discovery paths/provenance, confirmed translations, optional suggestions, a pre-export interaction state, generated Figlets CSS, lint results, exact file changes, and a source fingerprint. When suggestions exist, show and resolve them before asking for export approval. Does not write files.',
};

const saveMakeGuidelinesProfileTool = {
  name: 'save_make_guidelines_profile',
  description: 'Save designer-approved optional Figma Make guidance or explicit skip choices beside the file-scoped Figlets config. Writes only make-guidelines.config.json and requires approved: true.',
};

const exportMakeGuidelinesTool = {
  name: 'export_make_guidelines',
  description: 'Write a previously previewed Figma Make guidelines bundle inside the selected project. Optional suggestions must be shown and resolved before requesting export approval. Requires approved: true, the exact source fingerprint from prepare_make_guidelines, and optional_suggestions_reviewed: true when that preview contains suggestions; rejects stale previews. Refreshes only Figlets-managed bundle files and leaves unrelated files untouched.',
};

function _core() {
  return require('../figlets-core.js');
}

function _siblingSnapshotPath(configPath) {
  if (!configPath) return null;
  const candidate = path.join(path.dirname(configPath), 'figma-data.json');
  return fs.existsSync(candidate) ? candidate : null;
}

function _resolveConfigPath(args) {
  if (args.config_path) return path.resolve(args.config_path);
  if (args.figmaDataPath) return path.join(path.dirname(path.resolve(args.figmaDataPath)), 'design-system.config.js');
  const active = getActiveFileConfigPath();
  if (active) return active;
  return null;
}

function _isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function _canonicalPath(candidate) {
  let cursor = path.resolve(candidate);
  const remainder = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    remainder.unshift(path.basename(cursor));
    cursor = parent;
  }
  const real = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.resolve(real, ...remainder);
}

function _isInsideResolved(root, candidate) {
  return _isInside(_canonicalPath(root), _canonicalPath(candidate));
}

function _resolveOutput(args) {
  const projectRoot = path.resolve(args.project_path || process.cwd());
  const outputRoot = path.resolve(args.output_path || path.join(projectRoot, 'specs', 'figma-make'));
  if (!_isInsideResolved(projectRoot, outputRoot)) {
    return {
      error: 'The Figma Make guidelines output must stay inside project_path.',
      hint: 'Choose an output_path within ' + projectRoot + '.',
    };
  }
  return { projectRoot, outputRoot };
}

function _readJson(filePath, label) {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err) {
    return { error: 'Could not read ' + label + ': ' + err.message };
  }
}

function _profilePath(configPath) {
  return path.join(path.dirname(configPath), 'make-guidelines.config.json');
}

function _loadProfile(configPath) {
  const profilePath = _profilePath(configPath);
  if (!fs.existsSync(profilePath)) return { path: profilePath, profile: {}, exists: false };
  const read = _readJson(profilePath, 'make-guidelines.config.json');
  if (read.error) return read;
  const normalized = _core().makeGuidelines.normalizeProfile(read.value);
  if (normalized.errors.length) {
    return { error: 'Invalid make-guidelines.config.json: ' + normalized.errors.join(' '), path: profilePath };
  }
  return { path: profilePath, profile: normalized.profile, exists: true };
}

function _loadSnapshot(configPath, explicitPath) {
  if (explicitPath) return loadFigmaDataSource({ figmaDataPath: path.resolve(explicitPath) });
  const sibling = _siblingSnapshotPath(configPath);
  if (sibling) return loadFigmaDataSource({ figmaDataPath: sibling });
  return loadActiveFigmaDataSource() || loadFigmaDataSource();
}

function _readDs(configPath, figmaData) {
  if (fs.existsSync(configPath)) {
    return {
      ds: _core().dsConfig.readDsConfig(configPath),
      kind: 'figlets-config',
      configExists: true,
    };
  }
  return {
    ds: bootstrapDsFromSnapshot(figmaData),
    kind: 'figma-snapshot-bootstrap',
    configExists: false,
  };
}

function _hasDesignSystemArtifacts(figmaData) {
  return ["variables", "textStyles", "effectStyles", "paintStyles", "components"]
    .some(key => Array.isArray(figmaData && figmaData[key]) && figmaData[key].length > 0);
}

function _discoverComponentSpecs(projectRoot, figmaData) {
  const specsDir = path.join(projectRoot, 'component-specs');
  const componentNames = new Set((Array.isArray(figmaData.components) ? figmaData.components : [])
    .filter(component => component && typeof component.name === 'string')
    .map(component => component.name));
  const diagnostics = {
    directory: specsDir,
    directoryExists: fs.existsSync(specsDir),
    files: [],
    matchedFigmaComponents: [],
    specOnlyComponents: [],
  };
  if (!diagnostics.directoryExists) return { specs: [], diagnostics };
  const specs = [];
  const seenNames = new Map();
  for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue;
    const absolutePath = path.join(specsDir, entry.name);
    const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join('/');
    const content = fs.readFileSync(absolutePath, 'utf8');
    const heading = content.match(/^#\s+(.+?)\s*$/m);
    const name = heading && heading[1].trim()
      ? heading[1].trim()
      : path.basename(entry.name, path.extname(entry.name));
    if (seenNames.has(name)) {
      throw new Error(
        `Multiple component specs resolve to "${name}": ${seenNames.get(name)} and ${relativePath}.`
      );
    }
    seenNames.set(name, relativePath);
    diagnostics.files.push(relativePath);
    if (componentNames.has(name)) diagnostics.matchedFigmaComponents.push(name);
    else diagnostics.specOnlyComponents.push(name);
    specs.push({
      name,
      path: relativePath,
      content,
    });
  }
  specs.sort((a, b) => a.name.localeCompare(b.name));
  diagnostics.files.sort();
  diagnostics.matchedFigmaComponents.sort();
  diagnostics.specOnlyComponents.sort();
  return { specs, diagnostics };
}

function _fileState(outputRoot, file) {
  const absolutePath = path.resolve(outputRoot, file.path);
  if (!_isInsideResolved(outputRoot, absolutePath)) throw new Error('Unsafe generated file path: ' + file.path);
  const generatedHash = _core().makeGuidelines.fingerprint(file.content);
  if (!fs.existsSync(absolutePath)) {
    return { path: file.path, absolutePath, action: 'create', bytes: Buffer.byteLength(file.content), generatedHash };
  }
  const existing = fs.readFileSync(absolutePath, 'utf8');
  return {
    path: file.path,
    absolutePath,
    action: existing === file.content ? 'unchanged' : 'refresh',
    bytes: Buffer.byteLength(file.content),
    generatedHash,
    existingHash: _core().makeGuidelines.fingerprint(existing),
  };
}

function _managedGeneratedFiles(outputRoot) {
  if (!fs.existsSync(outputRoot)) return [];
  const files = [];
  const visit = directory => {
    if (!_isInsideResolved(outputRoot, directory)) throw new Error('Unsafe generated bundle directory: ' + directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !/\.(md|css)$/i.test(entry.name)) continue;
      const content = fs.readFileSync(absolutePath, 'utf8');
      if (!/Generated by Figlets\. Refresh through Figlets/.test(content.slice(0, 200))) continue;
      files.push({
        path: path.relative(outputRoot, absolutePath).split(path.sep).join('/'),
        absolutePath,
        action: 'remove',
        bytes: Buffer.byteLength(content),
        existingHash: _core().makeGuidelines.fingerprint(content),
      });
    }
  };
  visit(outputRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function _previewSummary(result) {
  const model = result.model;
  return {
    designSystem: model.designSystem,
    confirmed: {
      variables: model.foundations.variables.length,
      components: model.components.length,
      figmaComponents: model.components.filter(component => component.source !== 'component-spec').length,
      componentSpecComponents: model.components.filter(component => component.spec).length,
      documentedComponents: model.components.filter(component => component.spec).length,
      modes: model.foundations.modes,
      rules: model.rules,
      prohibitions: model.prohibitions,
      provenance: model.provenance,
    },
    styleContext: {
      status: model.styleContext.status,
      generator: model.styleContext.generator,
      stylesheetPath: model.styleContext.stylesheetPath,
      variableCount: model.styleContext.variableCount,
      declarationCount: model.styleContext.declarationCount,
      omitted: model.styleContext.omitted,
    },
    warnings: model.warnings,
  };
}

async function _prepare(args, options) {
  args = args || {};
  options = options || {};
  const configPath = _resolveConfigPath(args);
  if (!configPath) {
    return {
      error: 'No active file-scoped Figlets config or Figma snapshot was found.',
      hint: 'Open the Figlets Bridge for the target file, or pass figmaDataPath explicitly.',
    };
  }
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;

  const output = _resolveOutput(args);
  if (output.error) return output;

  const explicitSnapshotPath = args.figmaDataPath ? path.resolve(args.figmaDataPath) : null;
  const hasSiblingSnapshot = Boolean(_siblingSnapshotPath(configPath));
  const shouldSync = options.allowSync !== false
    && !args.skip_sync
    && !explicitSnapshotPath
    && !hasSiblingSnapshot;
  let synced = false;
  if (shouldSync) {
    try {
      await handleSyncFigmaData();
      synced = true;
    } catch (err) {
      return {
        error: 'Figma sync failed before preparing Make guidelines: ' + err.message,
        hint: 'Open the Figlets Bridge plugin, or pass skip_sync: true to use the cached snapshot.',
      };
    }
  }

  let dataSource;
  try {
    dataSource = _loadSnapshot(configPath, explicitSnapshotPath);
  } catch (err) {
    return { error: 'Unable to load the Figma snapshot: ' + err.message };
  }
  if (!dataSource || !dataSource.figmaData) {
    return {
      error: 'No Figma snapshot is available for Make guidelines generation.',
      hint: 'Open the Figlets Bridge plugin and sync the file, or pass figmaDataPath.',
    };
  }

  let dsSource;
  try {
    dsSource = _readDs(configPath, dataSource.figmaData);
  } catch (err) {
    return { error: 'Unable to read the design-system source: ' + err.message };
  }
  if (!_hasDesignSystemArtifacts(dataSource.figmaData)) {
    if (!dsSource.configExists) {
      return {
        readiness: 'blocked_empty_design_system',
        needsDesignerInput: [{
          field: 'designSystemFoundation',
          question: 'This Figma file has no design-system variables, styles, or components yet. Do you want to set up its design-system foundation first?',
          reason: 'There are no design-system facts to translate into useful Make guidance.',
        }],
        nextWorkflow: 'new-ds-setup',
      };
    }
    try {
      dataSource = Object.assign({}, dataSource, {
        kind: 'figlets-config-derived',
        figmaData: _core().makeGuidelines.snapshotFromDsConfig(dsSource.ds),
      });
    } catch (err) {
      return {
        readiness: 'blocked_config_not_prepared',
        needsDesignerInput: [{
          field: 'preparedConfig',
          question: 'The Figlets config exists but is not prepared enough to generate guidelines yet. Should I run the normal Figlets config preparation flow first?',
          reason: err.message,
        }],
        nextWorkflow: 'new-ds-setup',
      };
    }
  }
  const profileSource = _loadProfile(configPath);
  if (profileSource.error) return profileSource;
  let componentSpecs;
  let componentSpecDiscovery;
  try {
    const discovered = _discoverComponentSpecs(output.projectRoot, dataSource.figmaData);
    componentSpecs = discovered.specs;
    componentSpecDiscovery = discovered.diagnostics;
  } catch (err) {
    return { error: 'Unable to inspect local component specs: ' + err.message };
  }

  let generated;
  try {
    generated = _core().makeGuidelines.prepareMakeGuidelinesCore({
      ds: dsSource.ds,
      figmaData: dataSource.figmaData,
      profile: profileSource.profile,
      componentSpecs,
      source: {
        configPath,
        configKind: dsSource.kind,
        snapshotPath: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
        profilePath: profileSource.path,
      },
    });
  } catch (err) {
    return { error: 'Unable to generate Figma Make guidelines: ' + err.message };
  }

  const files = generated.manifest.map(file => _fileState(output.outputRoot, file));
  const nextPaths = new Set(files.map(file => file.path));
  const removals = _managedGeneratedFiles(output.outputRoot).filter(file => !nextPaths.has(file.path));
  const changes = {
    create: files.filter(file => file.action === 'create').length,
    refresh: files.filter(file => file.action === 'refresh').length,
    unchanged: files.filter(file => file.action === 'unchanged').length,
    remove: removals.length,
  };
  const sourceFingerprint = _core().makeGuidelines.fingerprint({
    schemaVersion: generated.model.schemaVersion,
    docsReviewedAt: generated.model.docsReviewedAt,
    ds: dsSource.ds,
    figmaData: dataSource.figmaData,
    profile: profileSource.profile,
    componentSpecs,
    outputRoot: output.outputRoot,
    outputState: files.concat(removals).map(file => ({
      path: file.path,
      action: file.action,
      existingHash: file.existingHash || null,
      generatedHash: file.generatedHash || null,
    })),
  });

  const optionalSuggestions = generated.model.suggestions;
  const mustReviewOptionalSuggestions = optionalSuggestions.length > 0;

  return {
    readiness: generated.lint.valid
      ? (mustReviewOptionalSuggestions ? 'ready_with_optional_suggestions' : 'ready')
      : 'blocked',
    sourceFingerprint,
    docsReviewedAt: generated.model.docsReviewedAt,
    source: {
      configPath,
      configExists: dsSource.configExists,
      configKind: dsSource.kind,
      snapshotPath: dataSource.meta && dataSource.meta.path ? dataSource.meta.path : null,
      snapshotKind: dataSource.kind,
      profilePath: profileSource.path,
      profileExists: profileSource.exists,
      componentSpecs: componentSpecs.map(spec => spec.path),
      componentSpecDiscovery,
      syncAttempted: shouldSync,
      syncCompleted: synced,
    },
    preview: _previewSummary(generated),
    optionalSuggestions,
    interaction: {
      phase: mustReviewOptionalSuggestions ? 'review_optional_suggestions' : 'request_export_approval',
      exportApprovalReady: !mustReviewOptionalSuggestions,
      mustReviewOptionalSuggestionsBeforeExportApproval: mustReviewOptionalSuggestions,
      suggestionIds: optionalSuggestions.map(suggestion => suggestion.id),
      instruction: mustReviewOptionalSuggestions
        ? 'Before asking for export approval, present these optional suggestions as skippable help and ask whether the designer wants to accept, edit, skip, or skip all. Do not combine that question with export confirmation. After the designer resolves them, save accepted values or explicit persistent skips when applicable, prepare again, then ask approval for the latest exact file plan.'
        : 'No optional suggestion review is pending. Ask for export approval against this exact file plan and source fingerprint.',
    },
    needsDesignerInput: [],
    lint: generated.lint,
    exportPlan: {
      approvalRequired: true,
      outputRoot: output.outputRoot,
      projectRoot: output.projectRoot,
      refreshesExistingBundle: changes.refresh > 0 || changes.unchanged > 0 || changes.remove > 0,
      changes,
      files,
      removals,
    },
    _generated: generated,
  };
}

async function handlePrepareMakeGuidelines(args) {
  const prepared = await _prepare(args, { allowSync: true });
  if (prepared && prepared._generated) delete prepared._generated;
  return prepared;
}

function handleSaveMakeGuidelinesProfile(args) {
  args = args || {};
  if (args.approved !== true) {
    return {
      error: 'Saving optional Make guidance requires explicit approval.',
      hint: 'Set approved: true only after the designer accepts the proposed profile values.',
    };
  }
  const configPath = _resolveConfigPath(args);
  if (!configPath) return { error: 'No file-scoped config path is available for the Make profile.' };
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;
  const normalized = _core().makeGuidelines.normalizeProfile(args.profile);
  if (normalized.errors.length) return { error: 'Invalid Make guidelines profile: ' + normalized.errors.join(' ') };
  const profilePath = _profilePath(configPath);
  try {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, JSON.stringify(normalized.profile, null, 2) + '\n', 'utf8');
  } catch (err) {
    return { error: 'Failed to write make-guidelines.config.json: ' + err.message };
  }
  return {
    written: true,
    profilePath,
    profile: normalized.profile,
    message: 'Approved optional Figma Make guidance saved. Prepare again before export.',
  };
}

async function handleExportMakeGuidelines(args) {
  args = args || {};
  if (args.approved !== true) {
    return {
      error: 'Figma Make guidelines export requires explicit approval.',
      hint: 'Review prepare_make_guidelines, then pass approved: true with its sourceFingerprint.',
    };
  }
  if (!args.source_fingerprint) return { error: 'source_fingerprint is required from prepare_make_guidelines.' };
  const prepared = await _prepare(Object.assign({}, args, { skip_sync: true }), { allowSync: false });
  if (prepared.error) return prepared;
  if (!prepared._generated) {
    return {
      error: 'Figma Make guidelines are not ready to export.',
      readiness: prepared.readiness,
      needsDesignerInput: prepared.needsDesignerInput || [],
      nextWorkflow: prepared.nextWorkflow || null,
    };
  }
  if (prepared.sourceFingerprint !== args.source_fingerprint) {
    return {
      error: 'The Make guidelines preview is stale because its source inputs changed.',
      hint: 'Run prepare_make_guidelines again and review the refreshed preview before exporting.',
      expectedFingerprint: prepared.sourceFingerprint,
      receivedFingerprint: args.source_fingerprint,
    };
  }
  if (!prepared.lint.valid) return { error: 'Generated Make guidelines failed lint.', lint: prepared.lint };
  if ((prepared.optionalSuggestions || []).length && args.optional_suggestions_reviewed !== true) {
    return {
      error: 'Optional Figma Make suggestions must be reviewed before export approval.',
      hint: 'Present the optionalSuggestions from prepare_make_guidelines first. After the designer accepts, edits, skips, or explicitly chooses to continue without them, ask for export approval and retry with optional_suggestions_reviewed: true.',
      optionalSuggestions: prepared.optionalSuggestions,
      interaction: prepared.interaction,
    };
  }

  const written = [];
  const refreshed = [];
  const unchanged = [];
  const removed = [];
  try {
    for (const file of prepared.exportPlan.removals || []) {
      const absolutePath = path.resolve(prepared.exportPlan.outputRoot, file.path);
      if (!_isInsideResolved(prepared.exportPlan.outputRoot, absolutePath)) throw new Error('Unsafe obsolete generated file path: ' + file.path);
      if (!fs.existsSync(absolutePath)) continue;
      const content = fs.readFileSync(absolutePath, 'utf8');
      if (!/Generated by Figlets\. Refresh through Figlets/.test(content.slice(0, 200))) {
        throw new Error('Refusing to remove a file that is no longer marked as Figlets-generated: ' + file.path);
      }
      fs.unlinkSync(absolutePath);
      removed.push(absolutePath);
    }
    for (const file of prepared._generated.manifest) {
      const absolutePath = path.resolve(prepared.exportPlan.outputRoot, file.path);
      if (!_isInsideResolved(prepared.exportPlan.outputRoot, absolutePath)) throw new Error('Unsafe generated file path: ' + file.path);
      const existed = fs.existsSync(absolutePath);
      const existing = existed ? fs.readFileSync(absolutePath, 'utf8') : null;
      if (existing === file.content) {
        unchanged.push(absolutePath);
        continue;
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, file.content, 'utf8');
      (existed ? refreshed : written).push(absolutePath);
    }
  } catch (err) {
    return { error: 'Failed to export Figma Make guidelines: ' + err.message };
  }

  return {
    exported: true,
    outputRoot: prepared.exportPlan.outputRoot,
    sourceFingerprint: prepared.sourceFingerprint,
    written,
    refreshed,
    unchanged,
    removed,
    lint: prepared.lint,
    placementInstructions: [
      'Copy the contents of this figma-make folder into the root of the new Figma Make project.',
      'Keep guidelines/Guidelines.md at that project root so Make can discover the guidance structure.',
      'Keep src/' + prepared.preview.designSystem.librarySlug + '/styles.css at its generated relative path.',
      'What happens after these files leave the Figlets workspace is outside the Figlets flow.',
    ],
    message: 'Figma Make guidelines and Figlets-generated styles exported.',
  };
}

module.exports = {
  prepareMakeGuidelinesTool,
  saveMakeGuidelinesProfileTool,
  exportMakeGuidelinesTool,
  handlePrepareMakeGuidelines,
  handleSaveMakeGuidelinesProfile,
  handleExportMakeGuidelines,
};
