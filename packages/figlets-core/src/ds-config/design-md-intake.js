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
    throw new Error('DESIGN.md must start with YAML front matter delimited by --- fences.');
  }
  return {
    tokens: _parseSimpleYaml(match[1]),
    markdown: match[2] || ''
  };
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

  return {
    ds: DS,
    parsed: {
      name: tokens.name || null,
      colors: Object.keys(colors).length,
      typography: Object.keys(tokens.typography || {}).length,
      spacing: Object.keys(tokens.spacing || {}).length,
      rounded: Object.keys(tokens.rounded || {}).length
    },
    mapped: {
      brandColors: brand.length,
      typographyRoles: Object.keys(type.scale).length,
      gridBase: DS.grid.base
    },
    warnings: brand.length
      ? []
      : ['No usable color hex tokens found in DESIGN.md; add at least one brand color before prepare_ds_config.']
  };
}

function readDesignMdAsDsConfig(designMdPath, options) {
  const resolved = path.resolve(designMdPath);
  const markdown = fs.readFileSync(resolved, 'utf8');
  return designMdToDsConfig(markdown, Object.assign({}, options || {}, { sourcePath: resolved }));
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

function _quote(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function _writeYamlMap(lines, name, values) {
  const keys = Object.keys(values || {});
  if (!keys.length) return;
  lines.push(name + ':');
  for (const key of keys) {
    const value = values[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push('  ' + key + ':');
      for (const childKey of Object.keys(value)) {
        lines.push('    ' + childKey + ': ' + _quote(value[childKey]));
      }
    } else {
      lines.push('  ' + key + ': ' + _quote(value));
    }
  }
}

function dsConfigToDesignMd(ds, options) {
  options = options || {};
  const DS = ds || {};
  const colors = {};

  if (DS.color && Array.isArray(DS.color.ramps)) {
    for (const ramp of DS.color.ramps) {
      const rampName = String(ramp.folder || '').replace(/^color\//, '');
      if (!rampName) continue;
      for (const row of ramp.steps || []) {
        colors[rampName + '-' + row[0]] = _hexFromRgb(row[1], row[2], row[3]);
      }
    }
  } else if (DS.color && Array.isArray(DS.color.brand)) {
    for (const brand of DS.color.brand) {
      if (brand && brand.name && brand.hex) colors[_slug(brand.name)] = _hex(brand.hex) || brand.hex;
    }
  }

  const typography = {};
  if (DS.typography && DS.typography.scale) {
    const family = DS.typography.families && DS.typography.families.sans ? DS.typography.families.sans : 'Inter';
    for (const role of Object.keys(DS.typography.scale)) {
      const entry = DS.typography.scale[role] || {};
      const sizes = entry.sizes || [];
      const lineHeights = entry.lineHeights || [];
      typography[role.replace(/\//g, '-')] = {
        fontFamily: family,
        fontSize: _formatDimension(sizes[sizes.length - 1] || sizes[0] || 16),
        fontWeight: entry.weight || 400,
        lineHeight: _formatDimension(lineHeights[lineHeights.length - 1] || lineHeights[0] || 24),
        letterSpacing: _formatDimension(entry.tracking || 0)
      };
    }
  }

  const spacing = {};
  if (DS.spacing && DS.spacing.semantic) {
    for (const key of Object.keys(DS.spacing.semantic)) {
      const vals = DS.spacing.semantic[key] || [];
      spacing[key.replace(/\//g, '-')] = _formatDimension(vals[vals.length - 1] || vals[0]);
    }
  }

  const rounded = {};
  if (DS.spacing && DS.spacing.radius) {
    for (const key of Object.keys(DS.spacing.radius)) {
      const value = DS.spacing.radius[key];
      if (value !== 9999) rounded[key] = _formatDimension(value);
    }
  }

  const lines = ['---'];
  lines.push('version: "alpha"');
  lines.push('name: ' + _quote((DS.project && DS.project.name) || options.name || 'Figlets Design System'));
  if (DS.project && DS.project.description) lines.push('description: ' + _quote(DS.project.description));
  _writeYamlMap(lines, 'colors', colors);
  _writeYamlMap(lines, 'typography', typography);
  _writeYamlMap(lines, 'rounded', rounded);
  _writeYamlMap(lines, 'spacing', spacing);
  lines.push('---');
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push('Generated from Figlets design-system.config.js. Treat this file as portable agent context; the prepared Figlets config and Figma variables remain the source of truth.');
  lines.push('');
  lines.push('## Colors');
  lines.push('');
  lines.push('Color tokens are exported from the prepared Figlets ramps.');
  lines.push('');
  lines.push('## Typography');
  lines.push('');
  lines.push('Typography tokens are exported from DS.typography.scale.');
  lines.push('');
  lines.push('## Layout');
  lines.push('');
  lines.push('Spacing and radius tokens are exported from DS.spacing.');
  return lines.join('\n') + '\n';
}

function writeDesignMdFromDsConfig(configPath, outputPath) {
  const resolvedConfig = path.resolve(configPath);
  const resolvedOutput = path.resolve(outputPath || path.join(path.dirname(resolvedConfig), 'DESIGN.md'));
  const src = fs.readFileSync(resolvedConfig, 'utf8')
    .replace(/^\s*(const|let|var)\s+DS\s*=/m, 'DS =');
  const vm = require('vm');
  const ctx = {};
  vm.runInNewContext(src, ctx);
  if (!ctx.DS) throw new Error('Config must export a DS object');
  const ds = ctx.DS;
  const markdown = dsConfigToDesignMd(ds, { sourcePath: resolvedConfig });
  fs.writeFileSync(resolvedOutput, markdown, 'utf8');
  return resolvedOutput;
}

module.exports = {
  parseDesignMd,
  designMdToDsConfig,
  readDesignMdAsDsConfig,
  dsConfigToDesignMd,
  writeDesignMdFromDsConfig
};
