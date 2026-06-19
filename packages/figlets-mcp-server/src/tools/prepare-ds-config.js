'use strict';

/**
 * prepare-ds-config.js
 * MCP tool handler for prepare_ds_config.
 *
 * Reads an existing design-system.config.js, runs the full computation pipeline
 * (spacing, typography, color ramps, semantic pair validation, primitives data),
 * writes the updated config back, and returns structured preview data.
 *
 * The adapter (CLAUDE.md / AGENTS.md) owns intake and initial config creation.
 * This tool is the deterministic computation step — call it after intake is done.
 */

const path = require('path');
const fs = require('fs');
const { getConfigPathGuardError } = require('../utils/paths.js');

const applyDsConfigContrastRepairsTool = {
  name: 'apply_ds_config_contrast_repairs',
  description: 'Apply designer-approved pre-build semantic contrast alias suggestions to the file-scoped design-system.config.js only. This never mutates Figma. Pass options from prepare_ds_config.semanticPairs.contrastRepairOptions after approval, then rerun prepare_ds_config before apply_ds_setup.',
  inputSchema: {
    type: 'object',
    properties: {
      config_path: {
        type: 'string',
        description: 'Absolute path to the prepared file-scoped design-system.config.js.'
      },
      repairs: {
        type: 'array',
        description: 'Designer-approved repair option objects copied from prepare_ds_config.semanticPairs.contrastRepairOptions or setupApprovalPreview.semanticColor.contrast.repairOptions.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            mode: { type: 'string', description: 'Semantic mode to update, usually Light or Dark.' },
            background: { type: 'string', description: 'Semantic background token from the approved repair option.' },
            text: { type: 'string', description: 'Semantic text token from the approved repair option.' },
            suggestedText: { type: 'string', description: 'Approved primitive text alias target from the repair option.' }
          },
          required: ['mode', 'background', 'text', 'suggestedText'],
          additionalProperties: true
        }
      }
    },
    required: ['config_path', 'repairs'],
    additionalProperties: false
  }
};

function _escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _hex(rgb) {
  function c(v) {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
    const s = n.toString(16).toUpperCase();
    return s.length === 1 ? '0' + s : s;
  }
  return '#' + c(rgb.r) + c(rgb.g) + c(rgb.b);
}

function _rgbFromRef(ds, ref) {
  const m = String(ref || '').match(/^color\/([^/]+)\/(\d+)$/);
  if (!m || !ds || !ds.color || !Array.isArray(ds.color.ramps)) return null;
  const rampName = m[1];
  const step = Number(m[2]);
  for (const ramp of ds.color.ramps) {
    if (ramp.folder !== 'color/' + rampName) continue;
    for (const row of ramp.steps || []) {
      if (Number(row[0]) === step) return { r: row[1], g: row[2], b: row[3] };
    }
  }
  return null;
}

function _asArray(value) {
  return Array.isArray(value) ? value : [];
}

function _sample(items, limit) {
  return _asArray(items).slice(0, limit);
}

function _groupCountsByPrefix(names) {
  const counts = {};
  for (const name of names || []) {
    const prefix = String(name || '').split('/')[0] || 'other';
    counts[prefix] = (counts[prefix] || 0) + 1;
  }
  return counts;
}

function _semanticSpacingExamples(ds, limit) {
  const semantic = ds && ds.spacing && ds.spacing.semantic ? ds.spacing.semantic : {};
  return Object.keys(semantic).slice(0, limit).map(name => ({
    token: 'space/' + name,
    values: _asArray(semantic[name]).slice(),
  }));
}

function _semanticPairExample(pair) {
  return {
    background: pair.bg,
    text: pair.text,
    Light: pair.Light ? { background: pair.Light.bg, text: pair.Light.text } : null,
    Dark: pair.Dark ? { background: pair.Dark.bg, text: pair.Dark.text } : null,
  };
}

function _contrastRepairOptions(pairSuggestions) {
  const options = [];
  for (const key of Object.keys(pairSuggestions || {})) {
    const suggestion = pairSuggestions[key] || {};
    const parts = key.split('|');
    const background = parts[0];
    const text = parts[1];
    for (const mode of ['Light', 'Dark']) {
      const suggestedText = suggestion[mode];
      if (!suggestedText) continue;
      options.push({
        id: `${background}|${text}|${mode}`,
        mode,
        background,
        text,
        suggestedText,
        action: 'Update the semantic pair text alias for this mode to the suggested passing step, then rerun prepare_ds_config.',
        approvalLabel: `${mode}: ${text} on ${background} -> ${suggestedText}`,
      });
    }
  }
  return options;
}

function _textStyleName(pattern, role) {
  const stylePattern = pattern || 'type/{role}/{size}';
  const parts = String(role || '').split('/');
  const size = parts.length > 1 ? parts[parts.length - 1] : role;
  const roleName = stylePattern.indexOf('{size}') >= 0 && parts.length > 1
    ? parts.slice(0, -1).join('/')
    : role;
  return stylePattern.replace('{role}', roleName).replace('{size}', size);
}

function _buildSetupApprovalPreview({ configPath, ds, primitivesData, failCount, apcaFailCount, staleSemantics, needsDesignerInput, derivedColors, pairSuggestions }) {
  const collections = ds && ds.collections ? ds.collections : {};
  const breakpoints = ds && ds.breakpoints && Array.isArray(ds.breakpoints.modes) && ds.breakpoints.modes.length
    ? ds.breakpoints.modes.slice()
    : ['Mobile', 'Tablet', 'Desktop'];
  const color = ds && ds.color ? ds.color : {};
  const ramps = _asArray(color.ramps);
  const rampNames = ramps.map(ramp => String(ramp.folder || '').replace(/^color\//, '')).filter(Boolean);
  const rampSteps = ramps[0] && Array.isArray(ramps[0].steps) ? ramps[0].steps.map(row => row[0]) : [];
  const semantics = color.semantics || {};
  const semanticPairs = _asArray(semantics.pairs);
  const semanticIcons = _asArray(semantics.icons);
  const contrastRepairOptions = _contrastRepairOptions(pairSuggestions);
  const primitiveFloats = _asArray(primitivesData && primitivesData.floats);
  const spacingPrimitiveExamples = primitiveFloats
    .filter(item => /^space\//.test(String(item.name || '')))
    .slice(0, 12)
    .map(item => ({ token: item.name, value: item.value }));
  const typePrimitiveExamples = primitiveFloats
    .filter(item => /^type\//.test(String(item.name || '')))
    .slice(0, 10)
    .map(item => ({ token: item.name, value: item.value }));
  const shadowPrimitives = primitiveFloats
    .filter(item => /^shadow\//.test(String(item.name || '')));
  const shadowPrimitiveExamples = shadowPrimitives
    .slice(0, 8)
    .map(item => ({ token: item.name, value: item.value }));
  const typographyScale = ds && ds.typography && ds.typography.scale ? ds.typography.scale : {};
  const typographyRoles = Object.keys(typographyScale);
  const typeStylePattern = ds && ds.naming && ds.naming.textStyle ? ds.naming.textStyle : 'type/{role}/{size}';
  const textStyleExamples = typographyRoles.slice(0, 8).map(role => _textStyleName(typeStylePattern, role));
  const spacingSemantic = ds && ds.spacing && ds.spacing.semantic ? ds.spacing.semantic : {};
  const spacingSemanticNames = Object.keys(spacingSemantic);
  const status = failCount === 0 && (!staleSemantics || staleSemantics.length === 0) && (!needsDesignerInput || needsDesignerInput.length === 0)
    ? 'ready'
    : 'needs-review';

  return {
    title: 'Detailed design-system build preview',
    status,
    approvalBoundary: {
      previewOnly: true,
      writeTool: 'apply_ds_setup',
      requiredBeforeWrite: 'Explicit designer approval after reviewing this detailed preview.',
      message: 'Nothing has been changed in Figma. Do not call apply_ds_setup until the designer approves this build plan.',
    },
    collections: [
      {
        name: collections.primitives || (primitivesData && primitivesData.collectionName) || '1. Primitives',
        purpose: 'Primitive color, type, spacing, shadow, font, and scrim values.',
        willCreate: {
          colors: _asArray(primitivesData && primitivesData.colors).length,
          floats: primitiveFloats.length,
          strings: _asArray(primitivesData && primitivesData.strings).length,
          scrims: _asArray(primitivesData && primitivesData.scrims).length,
        },
        sampleTokens: {
          colors: _sample(primitivesData && primitivesData.colors, 8).map(item => ({ token: item.name, value: item.hex })),
          spacing: spacingPrimitiveExamples,
          typography: typePrimitiveExamples,
          shadow: shadowPrimitiveExamples,
          fonts: _sample(primitivesData && primitivesData.strings, 4).map(item => ({ token: item.name, value: item.value })),
        },
      },
      {
        name: collections.color || '2. Color',
        purpose: 'Light/Dark semantic color aliases.',
        modes: ['Light', 'Dark'],
        willCreate: {
          semanticPairs: semanticPairs.length,
          iconTokens: semanticIcons.length,
        },
        grammar: semantics.convention || color.convention || 'not specified',
        sampleAliases: semanticPairs.slice(0, 8).map(_semanticPairExample),
      },
      {
        name: collections.typography || '3. Typography',
        purpose: 'Responsive typography variables and local text styles.',
        modes: breakpoints,
        willCreate: {
          variableRoles: typographyRoles.length,
          localTextStyles: typographyRoles.length,
        },
        preset: ds && ds.typography && ds.typography.scalePreset || 'material3',
        families: ds && ds.typography && ds.typography.families || {},
        sampleStyles: textStyleExamples,
      },
      {
        name: collections.spacing || '4. Spacing',
        purpose: 'Responsive semantic spacing, radius, and border-width variables.',
        modes: breakpoints,
        willCreate: {
          semanticSpacingTokens: spacingSemanticNames.length,
          radiusTokens: Object.keys(ds && ds.spacing && ds.spacing.radius || {}).length,
          borderWidthTokens: Object.keys(ds && ds.spacing && ds.spacing.border || {}).length,
        },
        sampleTokens: _semanticSpacingExamples(ds, 10),
        radius: ds && ds.spacing && ds.spacing.radius || {},
        borderWidth: ds && ds.spacing && ds.spacing.border || {},
      },
      {
        name: collections.elevation || '5. Elevation',
        purpose: 'Elevation variables and local effect styles.',
        modes: ['Default'],
        willCreate: {
          shadowPrimitiveVariables: shadowPrimitives.length,
          effectStyles: 6,
        },
        sampleTokens: shadowPrimitiveExamples,
      },
    ],
    colorSystem: {
      algorithm: color.algorithm || 'oklch',
      rampStrategy: color.rampStrategy || 'standard',
      scale: color.scale || '50-950',
      contrastAlgorithm: color.contrastAlgorithm || 'wcag',
      rampCount: ramps.length,
      rampNames,
      steps: rampSteps,
      brandInputs: _asArray(color.brand).map(item => ({
        name: item.name,
        role: item.role || null,
        hex: item.hex,
        step: item.step == null ? 'auto' : item.step,
      })),
      generatedAssumptions: _asArray(derivedColors).map(item => ({
        role: item.role,
        name: item.name,
        hex: item.hex,
        note: item.note,
      })),
    },
    semanticColor: {
      grammar: semantics.convention || color.convention || 'not specified',
      pairCount: semanticPairs.length,
      iconCount: semanticIcons.length,
      contrast: {
        algorithm: color.contrastAlgorithm || 'wcag',
        failedPairs: failCount || 0,
        apcaFailedPairs: apcaFailCount || 0,
        repairTool: applyDsConfigContrastRepairsTool.name,
        repairOptions: contrastRepairOptions,
        repairApplyInput: contrastRepairOptions.length ? { config_path: configPath, repairs: contrastRepairOptions } : null,
        message: contrastRepairOptions.length
          ? 'Contrast failed for one or more semantic pairs. Review these exact alias suggestions before changing Figma.'
          : (failCount ? 'Contrast failed, but no nearest passing alias suggestion was found. Ask for a designer color decision.' : 'All semantic pairs pass.'),
      },
      samplePairs: semanticPairs.slice(0, 10).map(_semanticPairExample),
      sampleIcons: semanticIcons.slice(0, 8).map(icon => ({
        token: icon.token,
        Light: icon.Light,
        Dark: icon.Dark,
      })),
    },
    spacingSystem: {
      base: ds && ds.grid && ds.grid.base || 8,
      modes: breakpoints,
      primitiveSteps: spacingPrimitiveExamples,
      semanticGroups: _groupCountsByPrefix(spacingSemanticNames),
      sampleSemanticTokens: _semanticSpacingExamples(ds, 12),
    },
    typographySystem: {
      preset: ds && ds.typography && ds.typography.scalePreset || 'material3',
      modes: breakpoints,
      families: ds && ds.typography && ds.typography.families || {},
      roleCount: typographyRoles.length,
      sampleRoles: typographyRoles.slice(0, 10).map(role => ({
        role,
        sizes: _asArray(typographyScale[role] && typographyScale[role].sizes).slice(),
        lineHeights: _asArray(typographyScale[role] && typographyScale[role].lineHeights).slice(),
        weight: typographyScale[role] && typographyScale[role].weight,
      })),
      textStyleExamples,
    },
    assumptions: [
      `${color.algorithm || 'oklch'} color ramps on ${color.scale || '50-950'} scale.`,
      `${color.contrastAlgorithm || 'wcag'} contrast validation for semantic color pairs.`,
      `${ds && ds.grid && ds.grid.base || 8}px spacing base with ${breakpoints.join(', ')} responsive modes.`,
      `${ds && ds.typography && ds.typography.scalePreset || 'material3'} typography preset unless the designer supplied a custom scale.`,
    ].concat(
      _asArray(derivedColors).map(item => `Generated ${item.role} ramp "${item.name}" from the supplied brand colors.`)
    ),
    warnings: []
      .concat(_asArray(staleSemantics).map(item => `Stale semantic reference: ${item.token} -> ${item.ref}`))
      .concat(_asArray(needsDesignerInput).map(item => `Needs designer input before build: ${item}`)),
  };
}

function _writeSetupPreview(configPath, ds) {
  if (!ds || !ds.color || !Array.isArray(ds.color.ramps)) return null;
  const previewPath = path.join(path.dirname(configPath), 'design-system.preview.svg');
  const ramps = ds.color.ramps.slice(0, 9);
  const pairs = ds.color.semantics && Array.isArray(ds.color.semantics.pairs)
    ? ds.color.semantics.pairs.slice(0, 24)
    : [];
  const rampRowH = 30;
  const pairRowH = 34;
  const width = 1180;
  const height = 92 + ramps.length * rampRowH + 52 + pairs.length * pairRowH + 36;
  const out = [];

  out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">');
  out.push('<rect width="100%" height="100%" fill="#F8F8F7"/>');
  out.push('<style>text{font-family:Inter,Arial,sans-serif}.title{font-size:22px;font-weight:700;fill:#171717}.sub{font-size:12px;fill:#5F646B}.label{font-size:11px;fill:#30343A}.small{font-size:10px;fill:#5F646B}.token{font-size:10px;fill:#202428;font-weight:600}</style>');
  out.push('<text x="24" y="34" class="title">' + _escapeXml((ds.project && ds.project.name) || 'Design system preview') + '</text>');
  out.push('<text x="24" y="56" class="sub">Generated by prepare_ds_config. Preview only; nothing has been applied to Figma.</text>');

  let y = 86;
  out.push('<text x="24" y="' + (y - 12) + '" class="label">Color ramps</text>');
  for (const ramp of ramps) {
    const name = ramp.folder.replace(/^color\//, '');
    out.push('<text x="24" y="' + (y + 18) + '" class="token">' + _escapeXml(name) + '</text>');
    let x = 160;
    const steps = (ramp.steps || []).slice().sort(function(a, b) { return Number(a[0]) - Number(b[0]); });
    for (const row of steps) {
      const fill = _hex({ r: row[1], g: row[2], b: row[3] });
      out.push('<rect x="' + x + '" y="' + y + '" width="78" height="22" rx="3" fill="' + fill + '" stroke="#D7D7D4"/>');
      out.push('<text x="' + (x + 5) + '" y="' + (y + 15) + '" class="small">' + row[0] + '</text>');
      x += 82;
    }
    y += rampRowH;
  }

  y += 34;
  out.push('<text x="24" y="' + (y - 12) + '" class="label">Semantic pairs</text>');
  for (const pair of pairs) {
    const lightBg = pair.Light && _rgbFromRef(ds, pair.Light.bg);
    const lightText = pair.Light && _rgbFromRef(ds, pair.Light.text);
    const darkBg = pair.Dark && _rgbFromRef(ds, pair.Dark.bg);
    const darkText = pair.Dark && _rgbFromRef(ds, pair.Dark.text);
    out.push('<text x="24" y="' + (y + 21) + '" class="token">' + _escapeXml(pair.bg.replace(/^color\//, '') + ' + ' + pair.text.replace(/^color\//, '')) + '</text>');
    if (lightBg && lightText) {
      out.push('<rect x="330" y="' + y + '" width="360" height="26" rx="4" fill="' + _hex(lightBg) + '" stroke="#D7D7D4"/>');
      out.push('<text x="342" y="' + (y + 18) + '" style="font-size:12px;font-weight:600;fill:' + _hex(lightText) + '">Light preview text</text>');
    }
    if (darkBg && darkText) {
      out.push('<rect x="710" y="' + y + '" width="360" height="26" rx="4" fill="' + _hex(darkBg) + '" stroke="#D7D7D4"/>');
      out.push('<text x="722" y="' + (y + 18) + '" style="font-size:12px;font-weight:600;fill:' + _hex(darkText) + '">Dark preview text</text>');
    }
    y += pairRowH;
  }

  out.push('</svg>');
  fs.writeFileSync(previewPath, out.join('\n'), 'utf8');
  return previewPath;
}

function handlePrepareDsConfig({ config_path }) {
  const resolvedPath = path.resolve(config_path);
  const guardError = getConfigPathGuardError(resolvedPath);
  if (guardError) return guardError;

  let runDsPipeline;
  let designMdIntake;
  try {
    ({ runDsPipeline, designMdIntake } = require("../figlets-core.js").dsConfig);
  } catch (e) {
    // Fallback: direct path for development environments
    ({ runDsPipeline, designMdIntake } = require("../figlets-core.js").dsConfig);
  }

  let result;
  try {
    result = runDsPipeline(resolvedPath);
  } catch (err) {
    return {
      error: err.message,
      hint: err.message.includes('not found')
        ? 'Run intake and write design-system.config.js before calling prepare_ds_config.'
        : err.message.includes('ramps')
        ? 'Config is missing DS.color.brand. Add brand color(s) to the config first.'
        : null,
    };
  }

  const {
    spacingPreview, computed, needsDesignerInput,
    colorRampsSummary, colorRampsTable, contrastAnnotations, derivedColors,
    semanticSummary, semanticPairsTable, iconTable, failCount, apcaFailCount, pairSuggestions,
    staleSemantics,
    primitivesData,
    ds,
  } = result;
  const previewPath = _writeSetupPreview(resolvedPath, ds);
  const setupApprovalPreview = _buildSetupApprovalPreview({
    configPath: resolvedPath,
    ds,
    primitivesData,
    failCount,
    apcaFailCount,
    staleSemantics: staleSemantics || [],
    needsDesignerInput: needsDesignerInput || [],
    derivedColors,
    pairSuggestions,
  });
  const contrastRepairOptions = _contrastRepairOptions(pairSuggestions);
  let designMdPath = null;
  try {
    if (designMdIntake && designMdIntake.writeDesignMdFromDsConfig) {
      designMdPath = designMdIntake.writeDesignMdFromDsConfig(resolvedPath);
    }
  } catch (_) {}

  const staleWarning = staleSemantics && staleSemantics.length > 0
    ? `⚠️  ${staleSemantics.length} semantic token(s) reference ramp(s) not in the current brand config. ` +
      `Confirm with the designer before proceeding: ${staleSemantics.map(s => s.token + ' → ' + s.ref).join(', ')}`
    : null;

  return {
    spacingPreview,
    computed,
    needsDesignerInput,
    colorRamps: {
      summary:     colorRampsSummary,
      table:       colorRampsTable,
      contrasts:   contrastAnnotations,
      derived:     derivedColors,
    },
    semanticPairs: {
      summary:        semanticSummary,
      table:          semanticPairsTable,
      iconTable,
      failCount,
      apcaFailCount:  apcaFailCount || 0,
      pairSuggestions: pairSuggestions || {},
      contrastRepairTool: applyDsConfigContrastRepairsTool.name,
      contrastRepairOptions,
      contrastRepairApplyInput: contrastRepairOptions.length
        ? { config_path: resolvedPath, repairs: contrastRepairOptions }
        : null,
      staleSemantics: staleSemantics || [],
      ready:          failCount === 0 && (!staleSemantics || staleSemantics.length === 0),
    },
    primitives: {
      collectionName: primitivesData.collectionName,
      summary:        primitivesData.summary,
      counts: {
        colors:  primitivesData.colors.length,
        floats:  primitivesData.floats.length,
        strings: primitivesData.strings.length,
        scrims:  primitivesData.scrims.length,
      },
    },
    setupApprovalPreview,
    setupPreview: previewPath ? { svgPath: previewPath } : null,
    designMdExport: designMdPath ? { path: designMdPath } : null,
    configPath: resolvedPath,
    readyToBuild: failCount === 0 && needsDesignerInput.length === 0 && (!staleSemantics || staleSemantics.length === 0),
    message: staleWarning
      ? staleWarning
      : failCount > 0
      ? `Config computed but ${failCount} semantic pair(s) fail contrast. Review semanticPairs.contrastRepairOptions before building.`
      : needsDesignerInput.length > 0
      ? `Config computed but ${needsDesignerInput.join(', ')} need designer input before building.`
      : 'Config ready. Call apply_ds_setup to build all collections in Figma.',
  };
}

function _loadDsConfigCore() {
  try {
    return require("../figlets-core.js").dsConfig;
  } catch (_) {
    return require("../figlets-core.js").dsConfig;
  }
}

function _normalizeRepair(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  let background = String(item.background || '').trim();
  let text = String(item.text || '').trim();
  let mode = String(item.mode || '').trim();
  if ((!background || !text || !mode) && item.id) {
    const parts = String(item.id).split('|');
    if (!background) background = parts[0] || '';
    if (!text) text = parts[1] || '';
    if (!mode) mode = parts[2] || '';
  }
  return {
    id: item.id ? String(item.id) : `${background}|${text}|${mode}`,
    background,
    text,
    mode,
    suggestedText: String(item.suggestedText || '').trim(),
  };
}

function _findSemanticPair(ds, background, text) {
  const pairs = ds && ds.color && ds.color.semantics && Array.isArray(ds.color.semantics.pairs)
    ? ds.color.semantics.pairs
    : [];
  return pairs.find(pair => pair && pair.bg === background && pair.text === text) || null;
}

function handleApplyDsConfigContrastRepairs(args) {
  args = args || {};
  const resolvedPath = path.resolve(args.config_path || '');
  const guardError = getConfigPathGuardError(resolvedPath);
  if (guardError) return guardError;

  const repairs = Array.isArray(args.repairs) ? args.repairs.map(_normalizeRepair) : [];
  if (!repairs.length) {
    return {
      error: 'No contrast repairs were provided.',
      hint: 'Pass one or more objects from prepare_ds_config.semanticPairs.contrastRepairOptions after designer approval.',
    };
  }

  const core = _loadDsConfigCore();
  let ds;
  try {
    ds = core.readDsConfig(resolvedPath);
  } catch (err) {
    return {
      error: err.message,
      hint: 'Run create_ds_config_from_intake and prepare_ds_config before applying setup contrast repairs.',
    };
  }

  if (!ds || !ds.color || !Array.isArray(ds.color.ramps)) {
    return {
      error: 'Config is missing DS.color.ramps.',
      hint: 'Run prepare_ds_config first so Figlets can validate current contrast suggestions.',
    };
  }
  if (!ds.color.semantics || !Array.isArray(ds.color.semantics.pairs)) {
    return {
      error: 'Config is missing DS.color.semantics.pairs.',
      hint: 'Run prepare_ds_config first so Figlets can generate semantic pairs and contrast repair options.',
    };
  }

  let validated;
  try {
    validated = core.validateSemanticPairs(ds);
  } catch (err) {
    return {
      error: err.message,
      hint: 'Run prepare_ds_config first and use the fresh contrastRepairOptions payload.',
    };
  }
  const currentSuggestions = validated && validated.pairSuggestions ? validated.pairSuggestions : {};
  const applied = [];
  const blocked = [];

  for (const repair of repairs) {
    if (!repair.background || !repair.text || !repair.mode || !repair.suggestedText) {
      blocked.push({
        repair,
        reason: 'Repair must include background, text, mode, and suggestedText from prepare_ds_config.',
      });
      continue;
    }
    if (!/^color\/[^/]+\/.+/.test(repair.suggestedText)) {
      blocked.push({
        repair,
        reason: 'suggestedText must be a color variable reference from prepare_ds_config.',
      });
      continue;
    }
    const key = `${repair.background}|${repair.text}`;
    const expectedSuggestion = currentSuggestions[key] && currentSuggestions[key][repair.mode];
    if (expectedSuggestion !== repair.suggestedText) {
      blocked.push({
        repair,
        reason: expectedSuggestion
          ? `Current prepared suggestion is ${expectedSuggestion}, not ${repair.suggestedText}.`
          : 'This repair is not in the current prepare_ds_config contrast suggestions.',
      });
      continue;
    }
    const pair = _findSemanticPair(ds, repair.background, repair.text);
    if (!pair || !pair[repair.mode]) {
      blocked.push({
        repair,
        reason: 'Semantic pair or mode was not found in DS.color.semantics.pairs.',
      });
      continue;
    }
    const before = pair[repair.mode].text;
    if (before === repair.suggestedText) {
      applied.push({
        id: repair.id,
        background: repair.background,
        text: repair.text,
        mode: repair.mode,
        before,
        after: repair.suggestedText,
        unchanged: true,
      });
      continue;
    }
    pair[repair.mode].text = repair.suggestedText;
    applied.push({
      id: repair.id,
      background: repair.background,
      text: repair.text,
      mode: repair.mode,
      before,
      after: repair.suggestedText,
    });
  }

  if (blocked.length) {
    return {
      error: 'One or more approved contrast repairs could not be validated against the current prepared config.',
      configPath: resolvedPath,
      appliedCount: 0,
      blocked,
      hint: 'Rerun prepare_ds_config and pass the fresh semanticPairs.contrastRepairOptions payload.',
    };
  }

  core.writeDsConfig(resolvedPath, ds);
  return {
    configPath: resolvedPath,
    configWritten: true,
    figmaChanged: false,
    appliedCount: applied.length,
    applied,
    nextTool: 'prepare_ds_config',
    message: 'Applied approved semantic contrast repairs to the local design-system.config.js only. No Figma changes were made. Rerun prepare_ds_config and continue to apply_ds_setup only when readyToBuild is true.',
  };
}

module.exports = {
  applyDsConfigContrastRepairsTool,
  handlePrepareDsConfig,
  handleApplyDsConfigContrastRepairs,
};
