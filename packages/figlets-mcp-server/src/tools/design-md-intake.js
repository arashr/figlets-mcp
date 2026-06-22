'use strict';

const fs = require('fs');
const path = require('path');
const { getActiveFileConfigPath, getConfigPathGuardError } = require('../utils/paths.js');
const { dsConfig } = require('../figlets-core.js');

const designMdIntakeTool = {
  name: 'create_ds_config_from_design_md',
  description: 'Create a starter design-system.config.js from an existing DESIGN.md file. Accepts Google-style YAML front matter or Markdown-only docs with optional linked JSON config. Use as an optional setup intake shortcut when a designer already has DESIGN.md; explicit designer answers can still override the generated config before prepare_ds_config.',
  inputSchema: {
    type: 'object',
    properties: {
      design_md_path: {
        type: 'string',
        description: 'Absolute path to DESIGN.md.'
      },
      config_path: {
        type: 'string',
        description: 'Absolute path where design-system.config.js should be written.'
      },
      linked_config_path: {
        type: 'string',
        description: 'Optional absolute path to a linked JSON config referenced by DESIGN.md (for example theme or gallery config).'
      }
    },
    required: ['design_md_path', 'config_path'],
    additionalProperties: false
  }
};

const intakeConfigTool = {
  name: 'create_ds_config_from_intake',
  description: 'Create a file-scoped design-system.config.js from completed new-design-system intake answers. This writes only the local Figlets config file, never mutates Figma, and should be followed by prepare_ds_config. If required concrete choices such as brand hex colors are missing, returns needsDesignerInput instead of inventing values.',
  inputSchema: {
    type: 'object',
    properties: {
      config_path: {
        type: 'string',
        description: 'Optional absolute path where design-system.config.js should be written. Defaults to the active Figma file-scoped config path.'
      },
      project_name: { type: 'string' },
      platform: { type: 'string' },
      grid_base: { type: 'number' },
      breakpoint_tier: { type: 'string', description: '3-tier, 4-tier, or a number.' },
      breakpoint_modes: { type: 'array', items: { type: 'string' } },
      semantic_color_grammar: { type: 'string' },
      contrast_standard: { type: 'string' },
      theme_behavior: { type: 'string' },
      color_scale: { type: 'string' },
      color_algorithm: { type: 'string' },
      ramp_strategy: { type: 'string' },
      brand_colors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            hex: { type: 'string' },
            role: { type: 'string' },
            step: { type: 'number' }
          }
        }
      },
      color_families: { type: 'array', items: { type: 'string' } },
      typography: { type: 'object' },
      typography_preset: { type: 'string' },
      typography_scale: { type: 'object' },
      naming: { type: 'object' },
      visual_direction: { type: 'string' },
      notes: { type: 'string' }
    },
    additionalProperties: true
  }
};

function _slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'brand';
}

function _roleForColor(name, index) {
  const n = String(name || '').toLowerCase();
  if (/primary|brand|action|interactive|cta/.test(n)) return 'primary';
  if (/secondary/.test(n)) return 'secondary';
  if (/tertiary|accent|highlight|lime|yellow|teal|red|navy/.test(n)) return index === 0 ? 'primary' : (index === 1 ? 'secondary' : 'accent');
  if (index === 0) return 'primary';
  if (index === 1) return 'secondary';
  if (index === 2) return 'accent';
  return null;
}

function _validHex(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '').trim());
}

function _normalizeGrammar(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!text) return null;
  if (/paired|context|material|surface/.test(text)) return 'paired-context';
  if (/element/.test(text)) return 'element-first';
  if (/intent|emphasis|emph/.test(text)) return 'intent-emphasis';
  if (/component/.test(text)) return 'component-scoped';
  if (/custom/.test(text)) return 'custom';
  return null;
}

function _conventionForGrammar(grammar) {
  return grammar === 'paired-context' ? 'surface-based' : 'role-based';
}

function _normalizeContrast(value) {
  const text = String(value || '').trim().toLowerCase();
  if (/wcag/.test(text)) return 'wcag';
  if (/apca/.test(text)) return 'apca';
  return null;
}

function _breakpointModes(args) {
  if (Array.isArray(args.breakpoint_modes) && args.breakpoint_modes.filter(Boolean).length) {
    return args.breakpoint_modes.map(item => String(item).trim()).filter(Boolean);
  }
  const raw = String(args.breakpoint_tier || '').trim().toLowerCase();
  const tier = Number(raw.match(/\d+/) && raw.match(/\d+/)[0]);
  return tier >= 4 ? ['Mobile', 'Tablet', 'Desktop', 'Wide'] : ['Mobile', 'Tablet', 'Desktop'];
}

function _breakpointTier(args, modes) {
  const raw = String(args.breakpoint_tier || '').trim();
  const matched = raw.match(/\d+/);
  if (matched) return Number(matched[0]);
  if (Array.isArray(modes) && modes.length >= 2) return modes.length;
  return null;
}

function _defaultMonoForPlatform(platform) {
  const text = String(platform || '').trim().toLowerCase();
  if (/ios|mac|apple/.test(text)) return 'SF Mono';
  if (/android/.test(text)) return 'Roboto Mono';
  return 'JetBrains Mono';
}

function _normalizeMonoFamily(value, platform) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(any|default|reasonable|system)(\s+(reasonable|default|system))?\s+(mono|monospace|mono family|monospace family)$/.test(raw.toLowerCase())) {
    return _defaultMonoForPlatform(platform);
  }
  if (/^any\s+reasonable\s+monospace$/i.test(raw) || /^any\s+reasonable\s+mono$/i.test(raw)) {
    return _defaultMonoForPlatform(platform);
  }
  return raw;
}

function _brandColors(args, needsDesignerInput) {
  const colors = Array.isArray(args.brand_colors) ? args.brand_colors : [];
  const valid = [];
  const missingHex = [];
  colors.forEach((item, index) => {
    const name = String(item && item.name || '').trim();
    const hex = String(item && item.hex || '').trim();
    if (!name || !_validHex(hex)) {
      if (name) missingHex.push(name);
      return;
    }
    const entry = {
      name: _slug(name),
      hex: hex.toUpperCase(),
      role: item.role || _roleForColor(name, valid.length),
    };
    if (item.step != null && Number.isFinite(Number(item.step))) entry.step = Number(item.step);
    valid.push(entry);
  });
  const families = Array.isArray(args.color_families)
    ? args.color_families.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (!valid.length) {
    needsDesignerInput.push(families.length
      ? 'brand colors with hex values for: ' + families.join(', ')
      : 'brand colors with name + #RRGGBB hex values');
  } else if (missingHex.length) {
    needsDesignerInput.push('hex values for brand colors: ' + missingHex.join(', '));
  }
  return valid;
}

function _typography(args, needsDesignerInput) {
  const input = args.typography && typeof args.typography === 'object' ? args.typography : {};
  const families = input.families && typeof input.families === 'object' ? input.families : {};
  const sans = families.sans || input.sans || input.display_family || input.body_family;
  const mono = _normalizeMonoFamily(families.mono || input.mono || input.mono_family, args.platform);
  const scale = input.scale && typeof input.scale === 'object'
    ? input.scale
    : (args.typography_scale && typeof args.typography_scale === 'object' ? args.typography_scale : null);
  const rawPreset = input.scalePreset || input.scale_preset || args.typography_preset;
  const scalePreset = scale
    ? 'custom'
    : dsConfig.normalizeTypographyPreset(rawPreset);
  const knownPreset = ['material3', 'fluid', 'compact', 'custom'].includes(scalePreset);
  if (!sans) needsDesignerInput.push('typography sans/display family name');
  if (!mono) needsDesignerInput.push('typography mono/body family name');
  if (!scale && !rawPreset) needsDesignerInput.push('typography scale or preset');
  else if (!scale && scalePreset === 'custom') needsDesignerInput.push('explicit typography scale for custom preset');
  else if (!scale && !knownPreset) needsDesignerInput.push('supported typography preset (material3, fluid, compact, or custom scale)');
  const typography = {
    scalePreset,
    families: {
      sans: sans || 'Inter',
      mono: mono || 'JetBrains Mono',
    },
  };
  if (scale) typography.scale = scale;
  return typography;
}

function _typographySuggestions(typography) {
  const preset = typography && typography.scalePreset;
  const hasScale = !!(typography && typography.scale && typeof typography.scale === 'object');
  const needsCustomHelp = preset === 'custom' && !hasScale;
  const needsPresetHelp = !preset || !['material3', 'fluid', 'compact', 'custom'].includes(preset);
  if (!needsCustomHelp && !needsPresetHelp) return null;
  return {
    message: 'The designer can choose a preset or approve one of these editable custom scale templates. Do not write a custom scale until one is approved.',
    presetOptions: [
      {
        id: 'material3',
        label: 'Material 3',
        aliases: ['material', 'standard', 'material scale', 'm3'],
        bestFor: 'General-purpose product UI with familiar roles.',
      },
      {
        id: 'fluid',
        label: 'Fluid display',
        aliases: ['responsive scale'],
        bestFor: 'Marketing, editorial, or case-study systems with larger display type.',
      },
      {
        id: 'compact',
        label: 'Compact product',
        aliases: ['dense'],
        bestFor: 'Dashboards and information-dense tools.',
      },
    ],
    customTemplates: [
      {
        id: 'editorial-case-study',
        label: 'Editorial case study',
        bestFor: 'Hard-edged portfolios, posters, launches, and high-contrast case-study layouts.',
        scale: {
          'display/lg': { sizes: [48, 64, 72], lineHeights: [56, 72, 80], weight: 700, tracking: 0 },
          'headline/lg': { sizes: [36, 44, 52], lineHeights: [44, 52, 60], weight: 700, tracking: 0 },
          'headline/md': { sizes: [28, 32, 40], lineHeights: [36, 40, 48], weight: 700, tracking: 0 },
          'body/md': { sizes: [16, 16, 18], lineHeights: [24, 24, 28], weight: 400, tracking: 0 },
          'label/sm': { sizes: [12, 12, 12], lineHeights: [16, 16, 16], weight: 500, tracking: 0.02 },
        },
      },
      {
        id: 'quiet-product',
        label: 'Quiet product',
        bestFor: 'Operational tools, settings, docs, and repeated-use product surfaces.',
        scale: {
          'display/lg': { sizes: [32, 36, 40], lineHeights: [40, 44, 48], weight: 600, tracking: 0 },
          'headline/lg': { sizes: [24, 28, 32], lineHeights: [32, 36, 40], weight: 600, tracking: 0 },
          'title/md': { sizes: [16, 16, 18], lineHeights: [24, 24, 28], weight: 600, tracking: 0 },
          'body/md': { sizes: [14, 16, 16], lineHeights: [20, 24, 24], weight: 400, tracking: 0 },
          'label/sm': { sizes: [12, 12, 12], lineHeights: [16, 16, 16], weight: 500, tracking: 0.02 },
        },
      },
    ],
  };
}

function _collections(input) {
  const provided = input && typeof input === 'object' ? input : {};
  return {
    primitives: provided.primitives || '1. Primitives',
    color: provided.color || '2. Color',
    typography: provided.typography || '3. Typography',
    spacing: provided.spacing || '4. Spacing',
    elevation: provided.elevation || '5. Elevation',
  };
}

function _naming(input) {
  const provided = input && typeof input === 'object' ? input : {};
  return {
    textStyle: provided.textStyle || provided.text_style || 'type/{role}/{size}',
    fontFamily: provided.fontFamily || provided.font_family || 'font/{variant}',
  };
}

function handleCreateDsConfigFromIntake(args) {
  args = args || {};
  const activeConfigPath = getActiveFileConfigPath();
  if (!activeConfigPath) {
    return {
      configWritten: false,
      needsDesignerInput: ['active Figma file config path'],
      error: 'No active file-scoped design-system.config.js path found.',
      hint: 'Run sync_figma_data for the active Figma file or pass config_path after an active file is known.',
    };
  }
  const configPath = args.config_path
    ? path.resolve(args.config_path)
    : activeConfigPath;
  if (path.resolve(configPath) !== path.resolve(activeConfigPath)) {
    return {
      configWritten: false,
      error: 'Refusing to write intake config outside the active file-scoped design-system.config.js.',
      hint: 'Use ' + activeConfigPath + ' for the active Figma file.',
    };
  }
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;

  const needsDesignerInput = [];
  const projectName = String(args.project_name || args.name || '').trim();
  if (!projectName) needsDesignerInput.push('project name');
  const hasPlatform = String(args.platform || '').trim();
  if (!hasPlatform) needsDesignerInput.push('platform');
  const platform = String(args.platform || 'Web').trim();
  const gridBase = Number(args.grid_base || args.grid);
  if (args.grid_base == null && args.grid == null) {
    needsDesignerInput.push('grid base (4px or 8px)');
  } else if (!Number.isFinite(gridBase) || gridBase <= 0) {
    needsDesignerInput.push('valid grid base number');
  }
  if (Array.isArray(args.breakpoint_modes)) {
    const validModes = args.breakpoint_modes.map(item => String(item || '').trim()).filter(Boolean);
    if (validModes.length < 2) needsDesignerInput.push('at least two breakpoint modes');
  } else if (args.breakpoint_tier == null) {
    needsDesignerInput.push('breakpoints (3-tier/4-tier or exact modes)');
  } else {
    const tier = _breakpointTier(args, []);
    if (!Number.isFinite(tier) || tier < 2) needsDesignerInput.push('valid breakpoint tier or exact modes');
  }
  const grammar = _normalizeGrammar(args.semantic_color_grammar || args.semantic_grammar || args.color_grammar);
  if (!grammar) needsDesignerInput.push('semantic color naming grammar');
  const contrast = _normalizeContrast(args.contrast_standard || args.contrast || args.accessibility_standard);
  if (!contrast) needsDesignerInput.push('contrast standard (APCA or WCAG 2.2)');
  if (!String(args.theme_behavior || '').trim()) needsDesignerInput.push('light/dark behavior');
  if (!String(args.color_scale || '').trim()) needsDesignerInput.push('color scale (for example 100-900, 50-950, or 0-100)');
  const brand = _brandColors(args, needsDesignerInput);
  const typography = _typography(args, needsDesignerInput);

  const modes = _breakpointModes(args);
  const tier = _breakpointTier(args, modes);
  const ds = {
    project: {
      name: projectName || 'Untitled design system',
      platform,
    },
    grid: { base: Number.isFinite(gridBase) && gridBase > 0 ? gridBase : 8 },
    breakpoints: { modes, tier },
    typography,
    color: {
      scale: args.color_scale || '50-950',
      algorithm: args.color_algorithm || 'oklch',
      rampStrategy: args.ramp_strategy || 'standard',
      contrastAlgorithm: contrast || 'apca',
      convention: _conventionForGrammar(grammar),
      semanticGrammar: grammar || 'custom',
      brand,
    },
    naming: _naming(args.naming),
    collections: _collections(args.collections),
    figlets: {
      source: 'designer-intake',
      themeBehavior: args.theme_behavior || 'light + dark',
      visualDirection: args.visual_direction || '',
      notes: args.notes || '',
    },
  };

  const preview = {
    project: ds.project,
    grid: ds.grid,
    breakpoints: ds.breakpoints,
    semanticColorGrammar: ds.color.semanticGrammar,
    generatedConvention: ds.color.convention,
    contrastAlgorithm: ds.color.contrastAlgorithm,
    colorScale: ds.color.scale,
    brandColors: ds.color.brand.map(item => ({ name: item.name, hex: item.hex, role: item.role || null })),
    typography: ds.typography,
    collections: ds.collections,
  };
  const suggestions = {
    typography: _typographySuggestions(ds.typography),
  };

  if (needsDesignerInput.length) {
    return {
      configPath,
      configWritten: false,
      readyForPrepare: false,
      needsDesignerInput,
      preview,
      suggestions,
      message: 'I can create the design-system.config.js after these concrete setup choices are provided. Nothing has been written and Figma has not been changed.',
    };
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, 'const DS = ' + JSON.stringify(ds, null, 2) + ';\n', 'utf8');
  return {
    configPath,
    configWritten: true,
    readyForPrepare: true,
    needsDesignerInput: [],
    preview,
    suggestions,
    nextTool: 'prepare_ds_config',
    message: 'File-scoped design-system.config.js created from intake answers. No Figma changes were made. Run prepare_ds_config next and show setupApprovalPreview before asking to build in Figma.',
  };
}

function _loadDesignMdIntake() {
  try {
    return require("../figlets-core.js").dsConfig.designMdIntake;
  } catch (_) {
    return require("../figlets-core.js").dsConfig.designMdIntake;
  }
}

function handleCreateDsConfigFromDesignMd(args) {
  args = args || {};
  const designPath = path.resolve(args.design_md_path || '');
  const configPath = path.resolve(args.config_path || '');
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;

  if (!fs.existsSync(designPath)) {
    return { error: 'DESIGN.md not found: ' + designPath };
  }

  const intake = _loadDesignMdIntake();
  let result;
  try {
    result = intake.readDesignMdAsDsConfig(designPath, {
      linkedConfigPath: args.linked_config_path || null,
      autoLinkedConfig: args.linked_config_path ? false : true
    });
  } catch (err) {
    return {
      error: err.message,
      hint: 'Provide a readable DESIGN.md file. YAML front matter is optional; Markdown-only docs are supported as partial intake.'
    };
  }

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, 'const DS = ' + JSON.stringify(result.ds, null, 2) + ';\n', 'utf8');

  const intakeMode = result.parsedFromFrontMatter
    ? 'front-matter'
    : (result.mapped && result.mapped.linkedConfigUsed ? 'markdown+linked-config' : 'markdown-only');

  return {
    configPath: configPath,
    sourcePath: designPath,
    intakeMode: intakeMode,
    parsed: result.parsed,
    parsedFromFrontMatter: result.parsedFromFrontMatter,
    parsedFromMarkdown: result.parsedFromMarkdown,
    linkedConfigCandidates: result.linkedConfigCandidates || [],
    mapped: result.mapped,
    needsDesignerInput: result.needsDesignerInput || [],
    warnings: result.warnings || [],
    message: result.parsedFromFrontMatter
      ? 'Starter design-system.config.js created from DESIGN.md front matter. Review any missing answers, then run prepare_ds_config.'
      : 'Starter design-system.config.js created from Markdown-only DESIGN.md intake. Ask only the remaining setup questions listed in needsDesignerInput, then run prepare_ds_config.'
  };
}

module.exports = {
  designMdIntakeTool,
  intakeConfigTool,
  handleCreateDsConfigFromDesignMd,
  handleCreateDsConfigFromIntake
};
