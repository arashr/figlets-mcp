'use strict';

const fs = require('fs');
const path = require('path');

function _stripQuotes(value) {
  const s = String(value == null ? '' : value).trim();
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

function _parseScalar(value) {
  const s = _stripQuotes(value);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function _parseSimpleYaml(src) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = String(src || '').split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();
    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) continue;

    const key = _stripQuotes(match[1]);
    const rest = match[2].trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent: indent, value: child });
    } else {
      parent[key] = _parseScalar(rest);
    }
  }

  return root;
}

function parseDesignMd(markdown) {
  const text = String(markdown || '');
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return {
      hasFrontMatter: false,
      tokens: {},
      markdown: text
    };
  }
  return {
    hasFrontMatter: true,
    tokens: _parseSimpleYaml(match[1]),
    markdown: match[2] || ''
  };
}

function _extractProjectNameFromMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  for (const line of lines) {
    const titled = line.match(/^#\s+(?:Design\s+system\s+[—–-]\s+)?(.+?)\s*$/i);
    if (titled) return titled[1].trim();
    const generic = line.match(/^#\s+(.+?)\s*$/);
    if (generic && !/^design\s+system$/i.test(generic[1])) return generic[1].trim();
  }
  return null;
}

function _detectMarkdownRules(markdown) {
  const text = String(markdown || '');
  const lower = text.toLowerCase();
  const rules = {};

  if (/\bapca\b/.test(lower)) rules.contrastStandard = 'apca';
  else if (/\bwcag\s*2(?:\.2)?\b/.test(lower)) rules.contrastStandard = 'wcag-2.2';

  const gridMatch = text.match(/\b(?:grid(?:\s+system)?\s*:\s*)?(\d)\s*px\b/i);
  if (gridMatch) rules.gridBase = Number(gridMatch[1]);

  if (/\boklch\b/.test(lower)) rules.colorAlgorithm = 'oklch';
  if (/semantic\s+color/.test(lower) || /semantic\s+colors/.test(lower)) {
    rules.colorConvention = 'role-based';
  }
  if (/background(?:\s+colors?)?\s+(?:is\s+the\s+anchor|first)|foreground\s+adapt/.test(lower)) {
    rules.backgroundFirstForegroundPairing = true;
  }
  if (/dark\s+(?:mode\s+is\s+)?chrome[-\s]only|chrome[-\s]only/.test(lower)) {
    rules.lightDarkBehavior = 'dark-chrome-only';
  } else if (/\blight\s+and\s+dark\b|\bdark\s+mode\b/.test(lower)) {
    rules.lightDarkBehavior = 'light-and-dark';
  }

  return rules;
}

function _extractLinkedConfigCandidates(markdown, baseDir) {
  const text = String(markdown || '');
  const candidates = [];
  const seen = new Set();

  function addCandidate(rawPath) {
    const candidate = _resolveLinkedConfigCandidate(rawPath, baseDir);
    if (!candidate || seen.has(candidate.path)) return;
    seen.add(candidate.path);
    candidates.push(candidate);
  }

  for (const match of text.matchAll(/`([^`\n]+\.(?:json|md|yaml|yml|config\.js))`/gi)) {
    addCandidate(match[1]);
  }
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)\s]+\.(?:json|md|yaml|yml))\)/gi)) {
    addCandidate(match[1]);
  }

  return candidates;
}

function parseMarkdownIntake(markdown, options) {
  options = options || {};
  const body = String(markdown || '');
  const rules = _detectMarkdownRules(body);
  const projectName = _extractProjectNameFromMarkdown(body);
  const linkedConfigCandidates = _extractLinkedConfigCandidates(body, options.baseDir || null);
  const sections = [];
  for (const match of body.matchAll(/^##\s+(.+?)\s*$/gm)) {
    sections.push(match[1].trim());
  }

  return {
    projectName: projectName,
    rules: rules,
    sections: sections,
    linkedConfigCandidates: linkedConfigCandidates
  };
}

function _resolveColorToken(value, palette) {
  if (value == null) return null;
  const direct = _hex(value);
  if (direct) return direct;
  const token = String(value).trim();
  if (palette && palette[token]) return _resolveColorToken(palette[token], palette);
  return null;
}

function mapLinkedJsonConfig(rawConfig, options) {
  options = options || {};
  const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
  const theme = config && config.theme ? config.theme : {};
  const colors = theme.colors && typeof theme.colors === 'object' ? theme.colors : {};
  const typography = theme.typography && typeof theme.typography === 'object' ? theme.typography : {};
  const brand = [];
  const brandOrder = ['red', 'redBright', 'primary', 'secondary', 'accent', 'tertiary', 'brand'];

  for (const name of brandOrder) {
    if (!Object.prototype.hasOwnProperty.call(colors, name)) continue;
    const hex = _resolveColorToken(colors[name], colors);
    if (!hex) continue;
    brand.push({ name: _slug(name), hex: hex, role: _roleForColor(name, brand.length) });
  }
  for (const [name, value] of Object.entries(colors)) {
    if (brand.some(entry => entry.name === _slug(name))) continue;
    const hex = _resolveColorToken(value, colors);
    if (!hex) continue;
    if (_isNeutralColorName(name) && !/primary|brand|secondary|tertiary|accent|red/i.test(name)) continue;
    brand.push({ name: _slug(name), hex: hex, role: _roleForColor(name, brand.length) });
  }

  const scale = {};
  let sans = null;
  if (typography.bodySize) {
    const fontSize = _toPx(typography.bodySize);
    const lineHeight = _toLineHeightPx(typography.bodyLineHeight, fontSize);
    if (fontSize) {
      scale['body/md'] = {
        sizes: [fontSize, fontSize, fontSize],
        lineHeights: [lineHeight, lineHeight, lineHeight],
        weight: Number(typography.bodyWeight || 400),
        tracking: _trackingPx(typography.bodyLetterSpacing, fontSize)
      };
    }
  }
  if (typography.proseSize) {
    const fontSize = _toPx(typography.proseSize);
    const lineHeight = _toLineHeightPx(typography.proseLineHeight, fontSize);
    if (fontSize) {
      scale['body/lg'] = {
        sizes: [fontSize, fontSize, fontSize],
        lineHeights: [lineHeight, lineHeight, lineHeight],
        weight: Number(typography.proseWeight || 400),
        tracking: 0
      };
    }
  }
  if (typography.labelSize) {
    const fontSize = _toPx(typography.labelSize);
    const lineHeight = _toLineHeightPx(typography.labelLineHeight, fontSize);
    if (fontSize) {
      scale['label/sm'] = {
        sizes: [fontSize, fontSize, fontSize],
        lineHeights: [lineHeight, lineHeight, lineHeight],
        weight: Number(typography.labelWeight || 500),
        tracking: _trackingPx(typography.labelLetterSpacing, fontSize)
      };
    }
  }

  const grounds = config && config.grounds && typeof config.grounds === 'object' ? config.grounds : null;
  const fonts = config && config.fonts && typeof config.fonts === 'object' ? config.fonts : {};
  if (fonts.uiSans && fonts.uiSans.family) sans = fonts.uiSans.family;
  else if (fonts.uiSerif && fonts.uiSerif.family) sans = fonts.uiSerif.family;

  const mapped = {
    brand: brand,
    typographyScale: scale,
    sans: sans,
    gridBase: options.gridBase || null,
    lightDarkBehavior: config.darkTheme ? 'dark-chrome-only' : null,
    groundsCount: grounds ? Object.keys(grounds).length : 0,
    sourcePath: options.sourcePath || null
  };

  return mapped;
}

function _deriveIntakeNeeds(ds, context) {
  context = context || {};
  const needs = [];
  const rules = context.parsedFromMarkdown && context.parsedFromMarkdown.rules
    ? context.parsedFromMarkdown.rules
    : {};

  if (!ds.project || !ds.project.name) needs.push('project name');
  needs.push('platform');
  if (!ds.grid || !ds.grid.base) needs.push('grid base (4px/8px)');
  needs.push('breakpoints (3-tier/4-tier)');
  if (!ds.color || !ds.color.convention) needs.push('semantic color naming grammar (paired context / element-first / intent and emphasis / component-scoped / custom)');
  if (!ds.color || !ds.color.contrastAlgorithm) needs.push('contrast standard (APCA default / WCAG 2.2)');
  if (!ds.color || !Array.isArray(ds.color.brand) || !ds.color.brand.length) {
    needs.push('color scale and brand colors (name + hex)');
  }
  if (
    !ds.typography
    || (
      ds.typography.scalePreset === 'custom'
      && (!ds.typography.scale || !Object.keys(ds.typography.scale).length)
    )
  ) {
    needs.push('typeface and typography preset');
  }
  if (!rules.lightDarkBehavior && !(ds.color && ds.color.modes)) {
    needs.push('light/dark behavior');
  }

  return needs;
}

function _toPx(value) {
  if (typeof value === 'number') return value;
  const s = String(value == null ? '' : value).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)(px|rem|em)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === 'rem' || unit === 'em') return n * 16;
  return n;
}

function _toLineHeightPx(value, fontSize) {
  if (value == null) return fontSize ? Math.round(fontSize * 1.6) : null;
  const s = String(value).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)(px|rem|em)?$/i);
  if (!m) return fontSize ? Math.round(fontSize * 1.6) : null;
  const n = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'rem' || unit === 'em') return Math.round(n * (fontSize || 16));
  if (unit === 'px') return n;
  if (!unit && fontSize && n > 0 && n <= 4) return Math.round(fontSize * n);
  return n;
}

function _linkedConfigSearchRoots(baseDir) {
  const roots = [];
  let current = path.resolve(baseDir || '.');
  for (let depth = 0; depth < 6; depth++) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function _resolveLinkedConfigCandidate(rawPath, baseDir) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return null;

  const resolvedPaths = [];
  if (trimmed.startsWith('..') || path.isAbsolute(trimmed)) {
    const resolved = path.resolve(baseDir || '.', trimmed);
    resolvedPaths.push({
      base: baseDir || '.',
      path: resolved,
      exists: fs.existsSync(resolved)
    });
  } else {
    const normalized = trimmed.replace(/^[./\\]+/, '');
    for (const root of _linkedConfigSearchRoots(baseDir)) {
      const resolved = path.resolve(root, normalized);
      if (resolvedPaths.some(entry => entry.path === resolved)) continue;
      resolvedPaths.push({
        base: root,
        path: resolved,
        exists: fs.existsSync(resolved)
      });
    }
  }

  const existing = resolvedPaths.find(entry => entry.exists);
  const displayPath = trimmed.replace(/^[./\\]+/, '') || trimmed;
  return {
    path: displayPath,
    resolvedPaths: resolvedPaths,
    resolvedPath: existing ? existing.path : resolvedPaths[0].path,
    exists: Boolean(existing),
    kind: /\.json$/i.test(trimmed) ? 'json' : /\.md$/i.test(trimmed) ? 'markdown' : 'config'
  };
}

function _hex(value) {
  const s = String(value == null ? '' : value).trim();
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  if (m[1].length === 3) {
    return '#' + m[1].split('').map(c => c + c).join('').toUpperCase();
  }
  return '#' + m[1].toUpperCase();
}

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
  if (/tertiary|accent|highlight/.test(n)) return 'accent';
  if (index === 0) return 'primary';
  if (index === 1) return 'secondary';
  if (index === 2) return 'accent';
  return null;
}

function _isNeutralColorName(name) {
  return /neutral|background|surface|canvas|paper|white|black|ink|text|foreground|on[-_]/i.test(String(name || ''));
}

function _typographyRole(name) {
  const n = String(name || '').toLowerCase().replace(/_/g, '-');
  if (/^(display|hero)[-/]?lg|^h1$|^display$/.test(n)) return 'display/lg';
  if (/^(display|hero)[-/]?md|^h2$/.test(n)) return 'display/md';
  if (/^(display|hero)[-/]?sm|^h3$/.test(n)) return 'display/sm';
  if (/headline[-/]lg|^headline$/.test(n)) return 'headline/lg';
  if (/headline[-/]md|^h4$/.test(n)) return 'headline/md';
  if (/headline[-/]sm|^h5$/.test(n)) return 'headline/sm';
  if (/title[-/]lg|^title$/.test(n)) return 'title/lg';
  if (/title[-/]md/.test(n)) return 'title/md';
  if (/title[-/]sm/.test(n)) return 'title/sm';
  if (/body[-/]lg/.test(n)) return 'body/lg';
  if (/body[-/]sm|small|caption/.test(n)) return 'body/sm';
  if (/body|paragraph|copy/.test(n)) return 'body/md';
  if (/label[-/]lg|button/.test(n)) return 'label/lg';
  if (/label[-/]sm|overline/.test(n)) return 'label/sm';
  if (/label|caps|meta/.test(n)) return 'label/md';
  return null;
}

function _trackingPx(value, fontSize) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)(px|em|rem)?$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === 'em') return n * (fontSize || 16);
  if (unit === 'rem') return n * 16;
  return n;
}

function _makeTypographyScale(typography) {
  const scale = {};
  const familyCounts = {};
  const entries = typography && typeof typography === 'object' ? Object.entries(typography) : [];

  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue;
    const role = _typographyRole(key);
    if (!role) continue;
    const fontSize = _toPx(value.fontSize || value.size);
    if (!fontSize) continue;
    const lineHeight = _toPx(value.lineHeight || value.leading) || Math.round(fontSize * 1.4);
    const weight = Number(value.fontWeight || value.weight || 400);
    const tracking = _trackingPx(value.letterSpacing || value.tracking, fontSize);
    scale[role] = {
      sizes: [fontSize, fontSize, fontSize],
      lineHeights: [lineHeight, lineHeight, lineHeight],
      weight: weight,
      tracking: tracking
    };
    const family = value.fontFamily || value.family;
    if (family) familyCounts[family] = (familyCounts[family] || 0) + 1;
  }

  let sans = null;
  for (const family of Object.keys(familyCounts)) {
    if (!sans || familyCounts[family] > familyCounts[sans]) sans = family;
  }

  return { scale, sans };
}

function _gridBase(spacing) {
  const vals = [];
  if (spacing && typeof spacing === 'object') {
    for (const value of Object.values(spacing)) {
      const px = _toPx(value);
      if (px && px > 0 && px <= 32) vals.push(Math.round(px));
    }
  }
  if (!vals.length) return 8;
  return vals.some(v => v % 8 !== 0 && v % 4 === 0) ? 4 : 8;
}

function designMdToDsConfig(markdown, options) {
  options = options || {};
  const parsed = parseDesignMd(markdown);
  const tokens = parsed.tokens || {};
  const parsedFromFrontMatter = parsed.hasFrontMatter;
  let parsedFromMarkdown = null;
  let linkedConfigCandidates = [];
  let linkedMapped = null;
  const warnings = [];

  if (parsedFromFrontMatter) {
    // If the body carries a `figlets-extended` block written by our own exporter,
    // use it as the canonical DS. Front matter parsing is the fallback for
    // external DESIGN.md files that have no extended block.
    const extended = _readExtendedBlock(parsed.markdown);
    if (extended && extended.ds && typeof extended.ds === 'object') {
      const ds = extended.ds;
      if (!ds.source) {
        ds.source = {
          type: 'design.md',
          path: options.sourcePath || null,
          version: tokens.version || null
        };
      }
      return {
        ds: ds,
        parsed: {
          name: tokens.name || (ds.project && ds.project.name) || null,
          colors: Object.keys(tokens.colors || {}).length,
          typography: Object.keys(tokens.typography || {}).length,
          spacing: Object.keys(tokens.spacing || {}).length,
          rounded: Object.keys(tokens.rounded || {}).length,
          components: Object.keys(tokens.components || {}).length,
          extended: true
        },
        parsedFromFrontMatter: true,
        parsedFromMarkdown: null,
        linkedConfigCandidates: [],
        mapped: {
          brandColors: ds.color && Array.isArray(ds.color.brand) ? ds.color.brand.length : 0,
          typographyRoles: ds.typography && ds.typography.scale ? Object.keys(ds.typography.scale).length : 0,
          gridBase: ds.grid && ds.grid.base ? ds.grid.base : 8
        },
        needsDesignerInput: [],
        warnings: []
      };
    }

    const colors = tokens.colors && typeof tokens.colors === 'object' ? tokens.colors : {};
    const brand = [];

    for (const [name, value] of Object.entries(colors)) {
      const hex = _hex(value);
      if (!hex) continue;
      if (_isNeutralColorName(name) && !/primary|brand|secondary|tertiary|accent/.test(String(name).toLowerCase())) continue;
      const role = _roleForColor(name, brand.length);
      brand.push({ name: _slug(name), hex: hex, role: role });
    }

    if (!brand.length) {
      for (const [name, value] of Object.entries(colors)) {
        const hex = _hex(value);
        if (!hex) continue;
        brand.push({ name: _slug(name), hex: hex, role: _roleForColor(name, brand.length) });
        if (brand.length) break;
      }
    }

    const type = _makeTypographyScale(tokens.typography || {});
    const DS = {
      project: { name: tokens.name || options.projectName || 'Imported DESIGN.md' },
      grid: { base: _gridBase(tokens.spacing) },
      breakpoints: { tier: 3, modes: ['Mobile', 'Tablet', 'Desktop'] },
      typography: {
        scalePreset: Object.keys(type.scale).length ? 'custom' : 'material3',
        families: {
          sans: type.sans || 'Inter',
          mono: 'JetBrains Mono'
        }
      },
      color: {
        scale: '50-950',
        algorithm: 'oklch',
        convention: 'role-based',
        contrastAlgorithm: 'apca',
        brand: brand
      },
      collections: {
        primitives: '1. Primitives',
        color: '2. Color',
        typography: '3. Typography',
        spacing: '4. Spacing',
        elevation: '5. Elevation'
      },
      naming: {
        color: 'color/{role}/{step}',
        textStyle: 'type/{role}/{size}',
        fontFamily: 'font/{variant}'
      },
      source: {
        type: 'design.md',
        path: options.sourcePath || null,
        version: tokens.version || null
      }
    };

    if (tokens.description) DS.project.description = tokens.description;
    if (Object.keys(type.scale).length) DS.typography.scale = type.scale;

    const frontMatterWarnings = brand.length
      ? []
      : ['No usable color hex tokens found in DESIGN.md; add at least one brand color before prepare_ds_config.'];

    return {
      ds: DS,
      parsed: {
        name: tokens.name || null,
        colors: Object.keys(colors).length,
        typography: Object.keys(tokens.typography || {}).length,
        spacing: Object.keys(tokens.spacing || {}).length,
        rounded: Object.keys(tokens.rounded || {}).length
      },
      parsedFromFrontMatter: true,
      parsedFromMarkdown: null,
      linkedConfigCandidates: [],
      mapped: {
        brandColors: brand.length,
        typographyRoles: Object.keys(type.scale).length,
        gridBase: DS.grid.base
      },
      needsDesignerInput: _deriveIntakeNeeds(DS, {}),
      warnings: frontMatterWarnings
    };
  }

  const baseDir = options.sourcePath ? path.dirname(path.resolve(options.sourcePath)) : null;
  parsedFromMarkdown = parseMarkdownIntake(parsed.markdown, { baseDir: baseDir });
  linkedConfigCandidates = parsedFromMarkdown.linkedConfigCandidates || [];

  if (options.linkedConfigPath) {
    const linkedPath = path.resolve(options.linkedConfigPath);
    if (fs.existsSync(linkedPath)) {
      try {
        linkedMapped = mapLinkedJsonConfig(fs.readFileSync(linkedPath, 'utf8'), {
          sourcePath: linkedPath,
          gridBase: parsedFromMarkdown.rules.gridBase || null
        });
      } catch (err) {
        warnings.push('Linked config could not be parsed: ' + err.message);
      }
    } else {
      warnings.push('Linked config not found: ' + linkedPath);
    }
  }

  const rules = parsedFromMarkdown.rules || {};
  const brand = linkedMapped && Array.isArray(linkedMapped.brand) ? linkedMapped.brand.slice() : [];
  const typographyScale = linkedMapped && linkedMapped.typographyScale ? linkedMapped.typographyScale : {};
  const DS = {
    project: {
      name: parsedFromMarkdown.projectName || options.projectName || 'Imported DESIGN.md'
    },
    grid: { base: rules.gridBase || (linkedMapped && linkedMapped.gridBase) || 8 },
    breakpoints: { tier: 3, modes: ['Mobile', 'Tablet', 'Desktop'] },
    typography: {
      scalePreset: Object.keys(typographyScale).length ? 'custom' : 'material3',
      families: {
        sans: (linkedMapped && linkedMapped.sans) || 'Inter',
        mono: 'JetBrains Mono'
      }
    },
    color: {
      scale: '50-950',
      algorithm: rules.colorAlgorithm || 'oklch',
      convention: rules.colorConvention || 'role-based',
      contrastAlgorithm: rules.contrastStandard || 'apca',
      brand: brand
    },
    collections: {
      primitives: '1. Primitives',
      color: '2. Color',
      typography: '3. Typography',
      spacing: '4. Spacing',
      elevation: '5. Elevation'
    },
    naming: {
      color: 'color/{role}/{step}',
      textStyle: 'type/{role}/{size}',
      fontFamily: 'font/{variant}'
    },
    source: {
      type: 'design.md',
      path: options.sourcePath || null,
      intakeMode: linkedMapped ? 'markdown+linked-config' : 'markdown-only'
    }
  };

  if (Object.keys(typographyScale).length) DS.typography.scale = typographyScale;
  if (linkedMapped && linkedMapped.sans) DS.typography.families.sans = linkedMapped.sans;
  if (rules.lightDarkBehavior === 'dark-chrome-only' || (linkedMapped && linkedMapped.lightDarkBehavior === 'dark-chrome-only')) {
    DS.color.modes = ['Light'];
    DS.project.notes = (DS.project.notes || '') + ' Dark mode limited to chrome/shell per DESIGN.md.';
  }

  if (!parsedFromMarkdown.projectName) {
    warnings.push('Could not infer project name from DESIGN.md heading.');
  }
  if (!brand.length) {
    warnings.push('No brand colors mapped yet. Provide linked JSON config or answer brand color intake questions.');
  }
  if (linkedConfigCandidates.length && !linkedMapped) {
    warnings.push('DESIGN.md references linked config files. Pass linked_config_path to import concrete theme values.');
  }
  warnings.push('Markdown-only DESIGN.md parsed as partial intake. Remaining setup questions still apply.');

  const needsDesignerInput = _deriveIntakeNeeds(DS, {
    parsedFromMarkdown: parsedFromMarkdown,
    linkedMapped: linkedMapped
  });

  return {
    ds: DS,
    parsed: {
      name: parsedFromMarkdown.projectName || null,
      colors: brand.length,
      typography: Object.keys(typographyScale).length,
      spacing: 0,
      rounded: 0,
      sections: parsedFromMarkdown.sections.length
    },
    parsedFromFrontMatter: false,
    parsedFromMarkdown: {
      projectName: parsedFromMarkdown.projectName,
      rules: parsedFromMarkdown.rules,
      sections: parsedFromMarkdown.sections
    },
    linkedConfigCandidates: linkedConfigCandidates,
    mapped: {
      brandColors: brand.length,
      typographyRoles: Object.keys(typographyScale).length,
      gridBase: DS.grid.base,
      linkedConfigUsed: Boolean(linkedMapped),
      groundsCount: linkedMapped ? linkedMapped.groundsCount : 0
    },
    needsDesignerInput: needsDesignerInput,
    warnings: warnings
  };
}

function readDesignMdAsDsConfig(designMdPath, options) {
  const resolved = path.resolve(designMdPath);
  const markdown = fs.readFileSync(resolved, 'utf8');
  const opts = Object.assign({}, options || {}, { sourcePath: resolved });
  if (!opts.linkedConfigPath && opts.autoLinkedConfig !== false) {
    const intake = parseMarkdownIntake(markdown, { baseDir: path.dirname(resolved) });
    const jsonCandidate = (intake.linkedConfigCandidates || []).find(entry => entry.kind === 'json' && entry.exists);
    if (jsonCandidate) {
      opts.linkedConfigPath = jsonCandidate.resolvedPath;
    }
  }
  return designMdToDsConfig(markdown, opts);
}

function _formatDimension(value) {
  if (value == null || !isFinite(value)) return null;
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return String(rounded).replace(/\.0+$/, '') + 'px';
}

function _hexFromRgb(r, g, b) {
  function c(v) {
    const n = Math.round(Math.max(0, Math.min(1, Number(v))) * 255);
    const s = n.toString(16).toUpperCase();
    return s.length === 1 ? '0' + s : s;
  }
  return '#' + c(r) + c(g) + c(b);
}

function _yamlString(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function _slugForToken(name) {
  return String(name || '').replace(/\//g, '-');
}

function _brandRoleColorKey(role) {
  const normalized = _slug(role);
  if (normalized === 'accent') return 'tertiary';
  if (['primary', 'secondary', 'tertiary', 'neutral'].includes(normalized)) return normalized;
  return null;
}

// Build the colors map. Emits bare brand role names (e.g. `primary: "#..."`)
// alongside ramp-stepped names (`primary-500: "#..."`) so the Google linter's
// recommended-colors rule is satisfied.
function _buildColorsMap(DS) {
  const colors = {};
  if (DS.color && Array.isArray(DS.color.brand)) {
    for (const brand of DS.color.brand) {
      if (!brand || !brand.name) continue;
      const hex = _hex(brand.hex) || brand.hex;
      if (!hex) continue;
      colors[_slug(brand.name)] = hex;
      const roleKey = _brandRoleColorKey(brand.role);
      if (roleKey) colors[roleKey] = hex;
    }
  }
  if (DS.color && Array.isArray(DS.color.ramps)) {
    for (const ramp of DS.color.ramps) {
      const rampName = String(ramp.folder || '').replace(/^color\//, '');
      if (!rampName) continue;
      for (const row of ramp.steps || []) {
        if (!Array.isArray(row) || row.length < 4) continue;
        colors[rampName + '-' + row[0]] = _hexFromRgb(row[1], row[2], row[3]);
      }
    }
  }
  return colors;
}

function _buildTypographyMap(DS) {
  const typography = {};
  if (!DS.typography || !DS.typography.scale) return typography;
  const families = DS.typography.families || {};
  const defaultFamily = families.sans || 'Inter';
  for (const role of Object.keys(DS.typography.scale)) {
    const entry = DS.typography.scale[role] || {};
    const sizes = entry.sizes || [];
    const lineHeights = entry.lineHeights || [];
    typography[_slugForToken(role)] = {
      fontFamily: entry.family || defaultFamily,
      fontSize: _formatDimension(sizes[sizes.length - 1] || sizes[0] || 16),
      fontWeight: Number(entry.weight || 400),
      lineHeight: _formatDimension(lineHeights[lineHeights.length - 1] || lineHeights[0] || 24),
      letterSpacing: _formatDimension(entry.tracking || 0)
    };
  }
  return typography;
}

function _buildSpacingMap(DS) {
  const spacing = {};
  if (DS.spacing && DS.spacing.semantic) {
    for (const key of Object.keys(DS.spacing.semantic)) {
      const vals = DS.spacing.semantic[key] || [];
      const value = _formatDimension(vals[vals.length - 1] || vals[0]);
      if (value) spacing[_slugForToken(key)] = value;
    }
  }
  return spacing;
}

function _buildRoundedMap(DS) {
  const rounded = {};
  if (DS.spacing && DS.spacing.radius) {
    for (const key of Object.keys(DS.spacing.radius)) {
      const value = DS.spacing.radius[key];
      if (value == null || value === 9999) continue;
      const formatted = _formatDimension(value);
      if (formatted) rounded[_slugForToken(key)] = formatted;
    }
  }
  return rounded;
}

// Resolve a semantic alias like `color/primary/500` to a colors-map key
// (`primary-500`) that the front matter actually emits. Returns null when the
// alias cannot be expressed as a primitive reference (e.g. multi-hop aliases or
// missing ramp steps).
function _aliasToColorsKey(alias, colorsMap) {
  const s = String(alias || '');
  const match = s.match(/^color\/(.+)$/);
  if (!match) return null;
  const candidate = match[1].replace(/\//g, '-');
  return colorsMap[candidate] ? candidate : null;
}

function _buildComponentsMap(DS, colorsMap) {
  const components = {};
  const pairs = DS.color && DS.color.semantics && Array.isArray(DS.color.semantics.pairs)
    ? DS.color.semantics.pairs
    : [];

  function addPairEntry(slug, modeAlias) {
    if (!slug || !modeAlias) return;
    const bgKey = modeAlias.bg ? _aliasToColorsKey(modeAlias.bg, colorsMap) : null;
    const textKey = modeAlias.text ? _aliasToColorsKey(modeAlias.text, colorsMap) : null;
    const entry = {};
    if (bgKey) entry.backgroundColor = '{colors.' + bgKey + '}';
    if (textKey) entry.textColor = '{colors.' + textKey + '}';
    if (Object.keys(entry).length) components[slug] = entry;
  }

  for (const pair of pairs) {
    if (!pair || (!pair.bg && !pair.text)) continue;
    const bgName = pair.bg || '';
    const textName = pair.text || '';
    const slug = _slugForToken(String(bgName || textName).replace(/^color\//, ''));
    if (!slug) continue;

    const lightAlias = pair.Light && (pair.Light.bg || pair.Light.text) ? pair.Light : null;
    const darkAlias = pair.Dark && (pair.Dark.bg || pair.Dark.text) ? pair.Dark : null;
    addPairEntry(slug, lightAlias || darkAlias);
    if (darkAlias) addPairEntry(slug + '-dark', darkAlias);
  }
  return components;
}

function _writeMap(lines, name, values) {
  const keys = Object.keys(values || {});
  if (!keys.length) return;
  lines.push(name + ':');
  for (const key of keys) {
    lines.push('  ' + key + ': ' + _yamlString(values[key]));
  }
}

function _writeTypographyMap(lines, name, typography) {
  const keys = Object.keys(typography || {});
  if (!keys.length) return;
  lines.push(name + ':');
  for (const role of keys) {
    const entry = typography[role];
    lines.push('  ' + role + ':');
    if (entry.fontFamily != null) lines.push('    fontFamily: ' + _yamlString(entry.fontFamily));
    if (entry.fontSize != null) lines.push('    fontSize: ' + _yamlString(entry.fontSize));
    if (entry.fontWeight != null) lines.push('    fontWeight: ' + Number(entry.fontWeight));
    if (entry.lineHeight != null) lines.push('    lineHeight: ' + _yamlString(entry.lineHeight));
    if (entry.letterSpacing != null) lines.push('    letterSpacing: ' + _yamlString(entry.letterSpacing));
  }
}

function _writeComponentsMap(lines, name, components) {
  const keys = Object.keys(components || {});
  if (!keys.length) return;
  lines.push(name + ':');
  for (const slug of keys) {
    const entry = components[slug];
    lines.push('  ' + slug + ':');
    for (const fieldKey of Object.keys(entry)) {
      lines.push('    ' + fieldKey + ': ' + _yamlString(entry[fieldKey]));
    }
  }
}

// --- Body sections ----------------------------------------------------------

function _formatHex(hex) {
  return _hex(hex) || hex;
}

function _rampName(ramp) {
  return String((ramp && ramp.folder) || '').replace(/^color\//, '');
}

function _formatAliasWithValue(alias, colorsMap) {
  if (!alias) return '-';
  const key = _aliasToColorsKey(alias, colorsMap);
  const value = key && colorsMap ? colorsMap[key] : null;
  return value ? alias + ' (' + value + ')' : alias;
}

function _bodyOverview(DS) {
  if (DS.project && DS.project.description) return DS.project.description;
  const name = (DS.project && DS.project.name) || 'This design system';
  return name + ' is a Figma-rooted design system exported to DESIGN.md as a portable handoff artifact. The tokens below are the normative values; the prose provides context for how to apply them.';
}

function _bodyColors(DS, colorsMap) {
  const lines = [];
  const brand = DS.color && Array.isArray(DS.color.brand) ? DS.color.brand : [];
  const ramps = DS.color && Array.isArray(DS.color.ramps) ? DS.color.ramps : [];
  const pairs = DS.color && DS.color.semantics && Array.isArray(DS.color.semantics.pairs)
    ? DS.color.semantics.pairs
    : [];
  const algo = DS.color && DS.color.contrastAlgorithm ? String(DS.color.contrastAlgorithm).toUpperCase() : null;

  if (brand.length) {
    lines.push('The palette is rooted in source colors that generate the primitive ramp tokens in the front matter.');
    lines.push('');
    lines.push('| Source | Role | Hex | Anchor step |');
    lines.push('|---|---|---|---|');
    for (const entry of brand) {
      if (!entry || !entry.name) continue;
      const hex = _formatHex(entry.hex);
      lines.push('| ' + _tableCell(entry.name) + ' | ' + _tableCell(entry.role || '-') + ' | ' + _tableCell(hex || 'no hex') + ' | ' + _tableCell(entry.step != null ? entry.step : '-') + ' |');
    }
  } else {
    lines.push('The palette is exported from the prepared Figlets ramps.');
  }

  if (ramps.length) {
    lines.push('');
    lines.push('Primitive ramp tokens follow the standard DESIGN.md `colors.<ramp>-<step>` naming pattern. Figlets aliases use the corresponding Figma-style path `color/<ramp>/<step>`.');
    if (algo) lines.push('Contrast-sensitive semantic pairs are evaluated with ' + algo + '.');
    lines.push('');
    lines.push('| Ramp | Steps | Range | Tokens |');
    lines.push('|---|---|---|---|');
    for (const ramp of ramps) {
      const rampName = _rampName(ramp);
      if (!rampName) continue;
      const rows = Array.isArray(ramp.steps) ? ramp.steps.filter(row => Array.isArray(row) && row.length >= 4) : [];
      if (!rows.length) continue;
      const tokens = rows.map(row => '`' + rampName + '-' + row[0] + '` ' + _hexFromRgb(row[1], row[2], row[3]));
      const range = _hexFromRgb(rows[0][1], rows[0][2], rows[0][3]) + ' to ' + _hexFromRgb(rows[rows.length - 1][1], rows[rows.length - 1][2], rows[rows.length - 1][3]);
      lines.push('| ' + _tableCell(rampName) + ' | ' + _tableCell(rows.map(row => row[0]).join(', ')) + ' | ' + _tableCell(range) + ' | ' + _tableCell(tokens.join('; ')) + ' |');
    }
  }

  if (pairs.length) {
    lines.push('');
    lines.push('Semantic background/text pairs are listed with their resolved primitive aliases. Light-mode pairs are also represented in the standard `components` front matter; Dark-mode variants are emitted as matching `*-dark` component entries when they resolve to standard color tokens.');
    lines.push('');
    lines.push('| Pair | Light background | Light text | Dark background | Dark text |');
    lines.push('|---|---|---|---|---|');
    for (const pair of pairs) {
      if (!pair || (!pair.bg && !pair.text)) continue;
      const name = (pair.bg || pair.text || '').replace(/^color\//, '');
      const light = pair.Light || {};
      const dark = pair.Dark || {};
      lines.push('| ' + _tableCell(name || '-') + ' | ' + _tableCell(_formatAliasWithValue(light.bg, colorsMap)) + ' | ' + _tableCell(_formatAliasWithValue(light.text, colorsMap)) + ' | ' + _tableCell(_formatAliasWithValue(dark.bg, colorsMap)) + ' | ' + _tableCell(_formatAliasWithValue(dark.text, colorsMap)) + ' |');
    }
  }

  if (Object.keys(colorsMap || {}).length) {
    lines.push('');
    lines.push('Exact hex values are normative in the YAML `colors` map. The prose above is implementation guidance for selecting the right token family and semantic pair.');
  }
  return lines.join('\n');
}

function _bodyTypography(DS) {
  const lines = [];
  const families = (DS.typography && DS.typography.families) || {};
  if (families.sans) lines.push('Primary typeface: **' + families.sans + '**.');
  if (families.mono) lines.push('Monospace typeface: **' + families.mono + '**.');
  if (families.display) lines.push('Display typeface: **' + families.display + '**.');
  if (!lines.length) lines.push('Typography is exported from the prepared Figlets scale.');
  const scale = DS.typography && DS.typography.scale ? DS.typography.scale : null;
  if (scale) {
    const rows = Object.keys(scale);
    if (rows.length) {
      lines.push('');
      lines.push('| Role | Sizes (mobile / tablet / desktop) | Weight | Tracking |');
      lines.push('|---|---|---|---|');
      for (const role of rows) {
        const entry = scale[role] || {};
        const sizes = entry.sizes || [];
        const sizeCell = sizes.length === 3
          ? (sizes[0] + ' / ' + sizes[1] + ' / ' + sizes[2] + ' px')
          : ((sizes[sizes.length - 1] || sizes[0] || '?') + ' px');
        lines.push('| ' + role + ' | ' + sizeCell + ' | ' + (entry.weight || 400) + ' | ' + (entry.tracking || 0) + ' |');
      }
    }
  }
  return lines.join('\n');
}

function _bodyLayout(DS) {
  const lines = [];
  const grid = DS.grid && DS.grid.base ? DS.grid.base + 'px' : null;
  if (grid) lines.push('Spacing follows a ' + grid + ' grid.');
  const semantic = DS.spacing && DS.spacing.semantic ? DS.spacing.semantic : null;
  if (semantic && Object.keys(semantic).length) {
    lines.push('');
    lines.push('| Role | Mobile / Tablet / Desktop |');
    lines.push('|---|---|');
    for (const key of Object.keys(semantic)) {
      const vals = semantic[key] || [];
      const cell = vals.length === 3
        ? (vals[0] + ' / ' + vals[1] + ' / ' + vals[2] + ' px')
        : ((vals[vals.length - 1] || vals[0] || '?') + ' px');
      lines.push('| ' + key + ' | ' + cell + ' |');
    }
  }
  const border = DS.spacing && DS.spacing.border ? DS.spacing.border : null;
  if (border && border.default != null) {
    lines.push('');
    lines.push('Default border width: ' + border.default + 'px.');
  }
  if (!lines.length) lines.push('Spacing tokens are exported from DS.spacing.');
  return lines.join('\n');
}

function _bodyElevation(DS) {
  const elevation = DS.elevation;
  if (!elevation || typeof elevation !== 'object') return null;
  const lines = ['Shadows are exported from the prepared Figlets elevation scale.'];
  const keys = Object.keys(elevation);
  if (keys.length) {
    lines.push('');
    lines.push('| Step | Definition |');
    lines.push('|---|---|');
    for (const key of keys) {
      const value = elevation[key];
      let summary;
      if (value && typeof value === 'object') summary = '`' + JSON.stringify(value) + '`';
      else summary = '`' + String(value) + '`';
      lines.push('| ' + key + ' | ' + summary + ' |');
    }
  }
  return lines.join('\n');
}

function _tableCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function _formatNumber(value) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

function _formatColor(color) {
  if (!color || typeof color !== 'object' || !('r' in color) || !('g' in color) || !('b' in color)) return null;
  const r = Math.round(Math.max(0, Math.min(1, color.r)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color.g)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color.b)) * 255);
  const a = color.a == null ? 1 : Math.max(0, Math.min(1, color.a));
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + _formatNumber(a) + ')';
}

function _formatEffect(effect) {
  if (!effect || typeof effect !== 'object') return '';
  const parts = [effect.type || 'EFFECT'];
  const color = _formatColor(effect.color);
  if (color) parts.push('color ' + color);
  if (effect.offset && typeof effect.offset === 'object') {
    const x = _formatNumber(effect.offset.x);
    const y = _formatNumber(effect.offset.y);
    if (x != null) parts.push('offset-x ' + x + 'px');
    if (y != null) parts.push('offset-y ' + y + 'px');
  }
  const radius = _formatNumber(effect.radius);
  if (radius != null) parts.push('blur ' + radius + 'px');
  const spread = _formatNumber(effect.spread);
  if (spread != null) parts.push('spread ' + spread + 'px');
  if (effect.blendMode) parts.push('blend ' + effect.blendMode);
  if (effect.visible === false) parts.push('hidden');
  return parts.join(', ');
}

function _configuredEffectStyleNames(DS) {
  const names = new Set();
  const elevation = DS && DS.elevation && typeof DS.elevation === 'object' ? DS.elevation : null;
  if (!elevation) return names;
  for (const key of Object.keys(elevation)) {
    names.add(key);
    names.add('elevation/' + key);
    names.add('shadow/' + key);
  }
  return names;
}

function _bodyObservedEffectStyles(DS, options) {
  const figmaData = options && options.figmaData ? options.figmaData : null;
  const effectStyles = Array.isArray(figmaData && figmaData.effectStyles) ? figmaData.effectStyles : [];
  if (!effectStyles.length) return null;
  const configuredNames = _configuredEffectStyleNames(DS);
  const observed = effectStyles
    .filter(style => style && style.name && !configuredNames.has(style.name))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!observed.length) return null;

  const lines = [
    'These local Figma effect styles were present in the latest synced snapshot and are included for implementation handoff.',
    '',
    '| Style | Definition |',
    '|---|---|',
  ];
  for (const style of observed) {
    const effects = Array.isArray(style.effects) ? style.effects : [];
    const summary = effects.length
      ? effects.map(_formatEffect).filter(Boolean).join(' | ')
      : 'No visible effects recorded.';
    lines.push('| ' + _tableCell(style.name) + ' | ' + _tableCell(summary) + ' |');
  }
  return lines.join('\n');
}

function _bodyShapes(DS) {
  const radius = DS.spacing && DS.spacing.radius ? DS.spacing.radius : null;
  if (!radius || !Object.keys(radius).length) return null;
  const lines = ['Corner radii follow a small named scale.'];
  lines.push('');
  lines.push('| Token | Value |');
  lines.push('|---|---|');
  for (const key of Object.keys(radius)) {
    if (radius[key] === 9999) {
      lines.push('| ' + key + ' | full / pill |');
    } else {
      lines.push('| ' + key + ' | ' + radius[key] + 'px |');
    }
  }
  return lines.join('\n');
}

function _bodyComponents(DS) {
  const pairs = DS.color && DS.color.semantics && Array.isArray(DS.color.semantics.pairs)
    ? DS.color.semantics.pairs
    : [];
  if (!pairs.length) return null;
  const algo = DS.color && DS.color.contrastAlgorithm ? DS.color.contrastAlgorithm.toUpperCase() : 'APCA/WCAG';
  const lines = [
    'Semantic background + text pairs validated against ' + algo + ' contrast. The `components` block in the front matter encodes the Light-mode relationship plus compatible `*-dark` variants when those aliases resolve to standard color tokens. The `figlets-extended` block below remains the lossless source for all Figlets-specific mode data.',
    ''
  ];
  lines.push('| Pair | Light bg / text | Dark bg / text |');
  lines.push('|---|---|---|');
  for (const pair of pairs) {
    if (!pair || (!pair.bg && !pair.text)) continue;
    const name = (pair.bg || pair.text || '').replace(/^color\//, '');
    const light = pair.Light || {};
    const dark = pair.Dark || {};
    const lightCell = (light.bg || '—') + ' / ' + (light.text || '—');
    const darkCell = (dark.bg || '—') + ' / ' + (dark.text || '—');
    lines.push('| ' + name + ' | ' + lightCell + ' | ' + darkCell + ' |');
  }
  return lines.join('\n');
}

// --- Extended block (round-trip restoration) -------------------------------

function _stripVolatile(ds) {
  // Clone and strip fields that are environment-dependent or generated.
  const clone = JSON.parse(JSON.stringify(ds || {}));
  if (clone.source) delete clone.source;
  if (clone.primitives) delete clone.primitives;
  return clone;
}

function _buildExtendedBlock(DS, options) {
  const payload = {
    schemaVersion: '1',
    generator: (options && options.generator) || 'figlets-mcp',
    ds: _stripVolatile(DS)
  };
  return [
    '```figlets-extended',
    JSON.stringify(payload, null, 2),
    '```'
  ].join('\n');
}

function _readExtendedBlock(markdownBody) {
  const text = String(markdownBody || '');
  const match = text.match(/```figlets-extended\s*\r?\n([\s\S]*?)\r?\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

// --- Public exporters -------------------------------------------------------

function dsConfigToDesignMd(ds, options) {
  options = options || {};
  const DS = ds || {};

  const colorsMap = _buildColorsMap(DS);
  const typographyMap = _buildTypographyMap(DS);
  const spacingMap = _buildSpacingMap(DS);
  const roundedMap = _buildRoundedMap(DS);
  const componentsMap = _buildComponentsMap(DS, colorsMap);

  const lines = ['---'];
  lines.push('version: alpha');
  lines.push('name: ' + _yamlString((DS.project && DS.project.name) || options.name || 'Figlets Design System'));
  if (DS.project && DS.project.description) lines.push('description: ' + _yamlString(DS.project.description));
  _writeMap(lines, 'colors', colorsMap);
  _writeTypographyMap(lines, 'typography', typographyMap);
  _writeMap(lines, 'rounded', roundedMap);
  _writeMap(lines, 'spacing', spacingMap);
  _writeComponentsMap(lines, 'components', componentsMap);
  lines.push('---');
  lines.push('');

  function pushSection(heading, content) {
    if (!content) return;
    lines.push('## ' + heading);
    lines.push('');
    lines.push(content);
    lines.push('');
  }

  // Canonical section order per the DESIGN.md spec.
  pushSection('Overview', _bodyOverview(DS));
  pushSection('Colors', _bodyColors(DS, colorsMap));
  pushSection('Typography', _bodyTypography(DS));
  pushSection('Layout', _bodyLayout(DS));
  pushSection('Elevation & Depth', _bodyElevation(DS));
  pushSection('Additional Effect Styles', _bodyObservedEffectStyles(DS, options));
  pushSection('Shapes', _bodyShapes(DS));
  pushSection('Components', _bodyComponents(DS));

  // Footer + round-trip block.
  const algo = DS.color && DS.color.contrastAlgorithm ? DS.color.contrastAlgorithm.toUpperCase() : null;
  const footer = 'Generated by Figlets from `design-system.config.js`. Standard: Google DESIGN.md (alpha).'
    + (algo ? ' Contrast algorithm: ' + algo + '.' : '');
  lines.push('---');
  lines.push('');
  lines.push(footer);
  lines.push('');
  lines.push(_buildExtendedBlock(DS, options));
  lines.push('');

  return lines.join('\n');
}

function writeDesignMdFromDsConfig(configPath, outputPath, options) {
  const resolvedConfig = path.resolve(configPath);
  const resolvedOutput = path.resolve(outputPath || path.join(path.dirname(resolvedConfig), 'DESIGN.md'));
  const src = fs.readFileSync(resolvedConfig, 'utf8')
    .replace(/^\s*(const|let|var)\s+DS\s*=/m, 'DS =');
  const vm = require('vm');
  const ctx = {};
  vm.runInNewContext(src, ctx);
  if (!ctx.DS) throw new Error('Config must export a DS object');
  const ds = ctx.DS;
  const markdown = dsConfigToDesignMd(ds, Object.assign({}, options || {}, { sourcePath: resolvedConfig }));
  fs.writeFileSync(resolvedOutput, markdown, 'utf8');
  return resolvedOutput;
}

module.exports = {
  parseDesignMd,
  parseMarkdownIntake,
  mapLinkedJsonConfig,
  designMdToDsConfig,
  readDesignMdAsDsConfig,
  dsConfigToDesignMd,
  writeDesignMdFromDsConfig,
  _readExtendedBlock: _readExtendedBlock
};
