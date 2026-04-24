figma.showUI(__html__, { width: 240, height: 120, themeColors: true });

function serializeNode(node) {
  const result = {
    id: node.id,
    name: node.name,
    type: node.type
  };

  if ('description' in node) result.description = node.description || "";
  if ('documentationLinks' in node) result.documentationLinks = node.documentationLinks || [];
  if ('componentPropertyDefinitions' in node) result.componentPropertyDefinitions = node.componentPropertyDefinitions;
  if ('componentProperties' in node) result.componentProperties = node.componentProperties;

  if ('layoutMode' in node) result.layoutMode = node.layoutMode;
  if ('paddingTop' in node) {
    result.padding = {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft
    };
  }
  if ('itemSpacing' in node) result.itemSpacing = node.itemSpacing;

  if ('children' in node && Array.isArray(node.children)) {
    result.children = node.children.map(child => serializeNode(child));
  }

  return result;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'extract-all') {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();

    const componentNodes = figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });

    const payload = {
      collections: collections.map(c => ({
        id: c.id,
        name: c.name,
        variableIds: c.variableIds,
        modes: c.modes
      })),
      variables: variables.map(v => ({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        valuesByMode: v.valuesByMode
      })),
      textStyles: textStyles.map(s => ({
        id: s.id,
        name: s.name,
        fontName: s.fontName,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing
      })),
      effectStyles: effectStyles.map(s => ({
        id: s.id,
        name: s.name,
        effects: s.effects
      })),
      components: componentNodes.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
        description: n.description || "",
        documentationLinks: n.documentationLinks || [],
        componentPropertyDefinitions: n.type === 'COMPONENT_SET' ? n.componentPropertyDefinitions : {},
        parentSetId: n.parent && n.parent.type === 'COMPONENT_SET' ? n.parent.id : null
      }))
    };

    figma.ui.postMessage({ type: 'data-extracted', data: payload });
  }

  if (msg.type === 'extract-selection') {
    const selection = figma.currentPage.selection;
    const payload = {
      selection: selection.map(node => serializeNode(node))
    };
    figma.ui.postMessage({ type: 'selection-extracted', data: payload });
  }

  if (msg.type === 'sync-success') {
    figma.notify('Data synced to local machine successfully!');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // build-showcase — renders token showcase pages directly in Figma.
  // Equivalent of the figlets fig-ds-showcase skill, ported to run inside the
  // plugin so no agent reasoning is needed. All rendering stays on the machine.
  // ─────────────────────────────────────────────────────────────────────────
  if (msg.type === 'build-showcase') {
    try {
      const result = await _buildShowcase();
      figma.ui.postMessage({ type: 'showcase-built', data: result });
      figma.notify('Token showcase built!');
    } catch (err) {
      figma.ui.postMessage({ type: 'showcase-built', data: { error: err.message } });
    }
  }
};

// ── Showcase implementation ──────────────────────────────────────────────────
// Ported from figlets skills/fig-ds-showcase — all rendering via Figma Plugin API.

async function _buildShowcase() {

  // ── detect-ds-structure ────────────────────────────────────────────────────

  const _dsStruct_allVars  = await figma.variables.getLocalVariablesAsync();
  const _dsStruct_allColls = await figma.variables.getLocalVariableCollectionsAsync();
  const textStyles          = await figma.getLocalTextStylesAsync();
  const effectStyles        = await figma.getLocalEffectStylesAsync();

  const varByName = Object.fromEntries(
    [..._dsStruct_allVars]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(v => [v.name, v])
  );

  function resolveVarValue(v, _depth) {
    if (!v) return null;
    if (_depth === undefined) _depth = 0;
    if (_depth > 8) return null;
    const modeId = Object.keys(v.valuesByMode)[0];
    const val = v.valuesByMode[modeId];
    if (!val && val !== 0) return null;
    if (typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
      const aliased = figma.variables.getVariableById(val.id);
      return aliased ? resolveVarValue(aliased, _depth + 1) : null;
    }
    return val;
  }

  function groupByPath(vars, depth) {
    const groups = {};
    for (const v of vars) {
      const parts = v.name.split('/');
      let key;
      if (depth !== undefined) {
        key = parts.slice(0, depth).join('/');
      } else {
        key = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(v);
    }
    return groups;
  }

  const _collIdSets = new Map(
    _dsStruct_allColls.map(c => [c.id, new Set(c.variableIds)])
  );

  const dsCollections = [..._dsStruct_allColls]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(coll => {
      const vars = _dsStruct_allVars
        .filter(v => coll.variableIds.includes(v.id))
        .sort((a, b) => a.name.localeCompare(b.name));

      const colorVars     = vars.filter(v => v.resolvedType === 'COLOR');
      const floatVars     = vars.filter(v => v.resolvedType === 'FLOAT');
      const colorVarCount = colorVars.length;
      const floatVarCount = floatVars.length;
      const myIds         = _collIdSets.get(coll.id);

      let selfAliasCount  = 0;
      let crossAliasCount = 0;
      for (const v of vars) {
        const modeId = Object.keys(v.valuesByMode)[0];
        const val    = v.valuesByMode[modeId];
        if (!val || typeof val !== 'object' || val.type !== 'VARIABLE_ALIAS') continue;
        if (myIds.has(val.id)) selfAliasCount++;
        else crossAliasCount++;
      }
      const aliasCount = selfAliasCount + crossAliasCount;

      const modeNames    = coll.modes.map(m => m.name);
      const hasLightMode = modeNames.some(n => /light|day|bright/i.test(n));
      const hasDarkMode  = modeNames.some(n => /dark|night|dim/i.test(n));
      const hasLightDark = hasLightMode && hasDarkMode;

      const numericLeafCount = colorVars.filter(v => /^\d+$/.test(v.name.split('/').pop())).length;
      const hasNumericSteps  = colorVarCount > 0 && numericLeafCount >= colorVarCount * 0.3;

      const crossAliasRatio = vars.length > 0 ? crossAliasCount / vars.length : 0;
      const totalAliasRatio = vars.length > 0 ? aliasCount       / vars.length : 0;

      const isPrimitive = vars.length === 0
        ? false
        : !hasLightDark &&
          (hasNumericSteps
            ? crossAliasRatio < 0.3
            : totalAliasRatio < 0.2 && crossAliasRatio < 0.1);

      const isAlias = vars.length > 0
        && (hasLightDark || crossAliasRatio > 0.4 || (!hasNumericSteps && totalAliasRatio > 0.7));

      const _rawColorGroups = colorVarCount > 0 ? groupByPath(colorVars) : {};
      const colorGroups = Object.fromEntries(
        Object.keys(_rawColorGroups)
          .sort((a, b) => a.localeCompare(b))
          .map(k => [k, _rawColorGroups[k]])
      );

      return {
        id: coll.id,
        name: coll.name,
        modeNames,
        varCount: vars.length,
        colorVarCount,
        floatVarCount,
        aliasCount,
        selfAliasCount,
        crossAliasCount,
        isPrimitive,
        isAlias,
        hasLightDark,
        hasNumericSteps,
        hasMultipleModes: coll.modes.length > 1,
        vars,
        colorGroups,
        groups: groupByPath(vars),
        topLevelGroups: groupByPath(vars, 1),
      };
    });

  // ── showcase-shared ────────────────────────────────────────────────────────

  function _lum({ r, g, b }) {
    return [r, g, b]
      .map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function _hex({ r, g, b }) {
    const h = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  function _sat({ r, g, b }) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }
  function _contrastRatio(c1, c2) {
    const L1 = _lum(c1), L2 = _lum(c2);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }

  const _semColl       = dsCollections.find(c => c.isAlias && c.colorVarCount > 0);
  const _primColls     = dsCollections.filter(c => c.isPrimitive && c.colorVarCount > c.floatVarCount);
  const _semanticColls = dsCollections.filter(c => c.isAlias && c.colorVarCount > 0);
  const _floatColls    = dsCollections.filter(c =>
    c.floatVarCount > c.colorVarCount &&
    (!c.isAlias || (c.colorVarCount === 0 && c.floatVarCount > 0))
  );

  const _semVars = _semColl
    ? _semColl.vars.filter(v => v.resolvedType === 'COLOR')
    : Object.values(varByName).filter(v => v.resolvedType === 'COLOR');

  function _resolvedRGB(v) {
    const c = resolveVarValue(v);
    return c && 'r' in c ? { r: c.r, g: c.g, b: c.b } : null;
  }

  const _bgRaw = (() => {
    const named = _semVars.find(v => {
      if (/(?:^|\/)on[-_]/i.test(v.name)) return false;
      return /(?:surface|background|base|page)(?:[/_-]default)?$/i.test(v.name);
    });
    if (named) return { v: named };
    return _semVars.map(v => ({ v, l: _resolvedRGB(v) ? _lum(_resolvedRGB(v)) : 0 })).sort((a, b) => b.l - a.l)[0];
  })();
  const _textRaw = (() => {
    const named = _semVars.find(v => /(?:on[-_]surface|foreground)(?:[/_-]default)?$/i.test(v.name));
    if (named) return { v: named };
    return _semVars.map(v => ({ v, l: _resolvedRGB(v) ? _lum(_resolvedRGB(v)) : 1 })).sort((a, b) => a.l - b.l)[0];
  })();
  const _accRaw  = _semVars.map(v => ({ v, s: _resolvedRGB(v) ? _sat(_resolvedRGB(v)) : 0 })).sort((a, b) => b.s - a.s)[0];

  const _bgColor   = _bgRaw   ? _resolvedRGB(_bgRaw.v)   : { r: 1,   g: 1,   b: 1   };
  const _textColor = _textRaw ? _resolvedRGB(_textRaw.v) : { r: 0.1, g: 0.1, b: 0.1 };
  const _accColor  = _accRaw  ? _resolvedRGB(_accRaw.v)  : { r: 0,   g: 0.47,b: 1   };

  const _subColor = {
    r: _bgColor.r * 0.6 + _textColor.r * 0.4,
    g: _bgColor.g * 0.6 + _textColor.g * 0.4,
    b: _bgColor.b * 0.6 + _textColor.b * 0.4,
  };

  const _sortedStyles  = textStyles.slice().sort((a, b) => b.fontSize - a.fontSize);

  const _fontSet = new Map();
  for (const s of textStyles) {
    const k = `${s.fontName.family}::${s.fontName.style}`;
    if (!_fontSet.has(k)) _fontSet.set(k, s.fontName);
  }
  _fontSet.set('Inter::Regular', { family: 'Inter', style: 'Regular' });
  _fontSet.set('Inter::Medium',  { family: 'Inter', style: 'Medium'  });

  const _dsFamily = textStyles.length > 0 ? textStyles[0].fontName.family : 'Inter';
  _fontSet.set(`${_dsFamily}::Regular`,  { family: _dsFamily, style: 'Regular'  });
  _fontSet.set(`${_dsFamily}::SemiBold`, { family: _dsFamily, style: 'SemiBold' });

  await Promise.all([..._fontSet.values()].map(f => figma.loadFontAsync(f)));

  const _C = {
    outlineSubtle:  { r: 0.894, g: 0.894, b: 0.906 },
    surfaceDefault: { r: 0.980, g: 0.980, b: 0.980 },
    surfaceVariant: { r: 0.957, g: 0.957, b: 0.961 },
    brandVariant:   { r: 0.957, g: 0.953, b: 0.988 },
    onBrandVariant: { r: 0.271, g: 0.247, b: 0.616 },
    successBg:      { r: 0.086, g: 0.502, b: 0.239 },
    successBorder:  { r: 0.086, g: 0.639, b: 0.290 },
    successText:    { r: 0.980, g: 0.980, b: 0.980 },
    warningBg:      { r: 0.706, g: 0.325, b: 0.035 },
    warningBorder:  { r: 0.851, g: 0.533, b: 0.024 },
    warningText:    { r: 0.980, g: 0.980, b: 0.980 },
    onSurface:      { r: 0.094, g: 0.094, b: 0.106 },
    onSurfaceLight: { r: 0.980, g: 0.980, b: 0.980 },
  };

  function _findVar(...names) {
    for (const n of names) if (varByName[n]) return varByName[n];
    return null;
  }

  function _paint(fallbackRGB, varOrNull) {
    const base = { type: 'SOLID', color: fallbackRGB };
    return varOrNull
      ? figma.variables.setBoundVariableForPaint(base, 'color', varOrNull)
      : base;
  }

  const _V = {
    bg:             _bgRaw  && _bgRaw.v   ? _bgRaw.v   : null,
    text:           _textRaw && _textRaw.v ? _textRaw.v : null,
    acc:            _accRaw  && _accRaw.v  ? _accRaw.v  : null,
    surfaceBrand:   _findVar('color/surface/brand', 'surface/brand', 'color/brand/default', 'brand/default', 'color/primary', 'primary'),
    textSub:        _findVar('color/on-surface/variant', 'on-surface/variant', 'color/text/subtle', 'text/subtle', 'color/text/muted', 'text/muted') || (_textRaw && _textRaw.v ? _textRaw.v : null),
    outlineSubtle:  _findVar('color/outline/subtle',           'outline/subtle'),
    surfaceDefault: _findVar('color/surface/default',          'surface/default'),
    surfaceVariant: _findVar('color/surface/variant',          'surface/variant'),
    brandVariant:   _findVar('color/surface/brand-variant',    'surface/brand-variant'),
    onBrandVariant: _findVar('color/on-surface/brand-variant', 'on-surface/brand-variant'),
    onSurface:      _findVar('color/on-surface/default',       'on-surface/default'),
    onSurfaceVar:   _findVar('color/on-surface/variant',       'on-surface/variant'),
    successBg:      _findVar('color/surface/success',          'surface/success'),
    successBorder:  _findVar('color/outline/success',          'outline/success'),
    successText:    _findVar('color/on-surface/success',       'on-surface/success'),
    warningBg:      _findVar('color/surface/warning',          'surface/warning'),
    warningBorder:  _findVar('color/outline/warning',          'outline/warning'),
    warningText:    _findVar('color/on-surface/warning',       'on-surface/warning'),
  };

  // Find a COLOR variable whose first-mode resolved value provides sufficient contrast
  // against bgRGB. Prefers on-surface/text/foreground tokens; falls back to any token.
  // Used when a structural variable isn't found by name — guarantees accessibility and
  // ensures mode-switching works (it's a real DS variable, not a hex coincidence).
  function _findContrastVar(bgRGB, minRatio) {
    minRatio = minRatio || 4.5;
    var best = null, bestRatio = 0;
    // Prefer semantically appropriate on-surface / text / foreground variables
    var preferred = Object.values(varByName).filter(function(v) {
      return v.resolvedType === 'COLOR' &&
        /(?:on[-_]surface|foreground|(?:^|\/)text(?:[-_/]|$))/i.test(v.name);
    });
    var candidates = preferred.length ? preferred : Object.values(varByName).filter(function(v) {
      return v.resolvedType === 'COLOR';
    });
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i];
      var raw = resolveVarValue(v);
      if (!raw || !('r' in raw)) continue;
      var ratio = _contrastRatio({ r: raw.r, g: raw.g, b: raw.b }, bgRGB);
      if (ratio >= minRatio && ratio > bestRatio) { bestRatio = ratio; best = v; }
    }
    return best;
  }

  // Brand-variant background — prefer surface/brand-variant naming, fall back to surfaceVariant
  if (!_V.brandVariant) {
    _V.brandVariant = _findVar(
      'color/surface/brand', 'surface/brand',
      'color/brand/surface', 'brand/surface',
      'color/primary/container', 'primary/container'
    ) || _V.surfaceVariant || null;
  }

  // On-brand-variant text — try wider naming patterns, then contrast-based search
  if (!_V.onBrandVariant) {
    _V.onBrandVariant = _findVar(
      'color/on-surface/brand', 'on-surface/brand',
      'color/on-brand/default', 'on-brand/default',
      'color/brand/on-brand',   'brand/on-brand',
      'color/on-primary/container', 'on-primary/container'
    );
    if (!_V.onBrandVariant) {
      // Resolve the actual background we'll be painting on
      var _bvRaw = _V.brandVariant ? resolveVarValue(_V.brandVariant) : null;
      var _bvRGB = _bvRaw && 'r' in _bvRaw
        ? { r: _bvRaw.r, g: _bvRaw.g, b: _bvRaw.b }
        : _C.brandVariant;
      _V.onBrandVariant = _findContrastVar(_bvRGB) || _V.text || null;
    }
  }

  // Surface-brand fallback — used for spacing visuals (bars, radius, border shapes)
  if (!_V.surfaceBrand) {
    _V.surfaceBrand = _findVar('color/accent', 'accent', 'color/brand', 'brand') || _V.acc || null;
  }

  // textSub fallback — if not found by name, use best contrast on the default surface
  if (!_V.textSub) {
    _V.textSub = _findContrastVar(_bgColor, 3) || _V.text || null;
  }

  function _textFill(color, v) {
    // Use the explicit variable when provided. No hex auto-lookup — that binds
    // semantically wrong variables on DSes with non-standard naming.
    return [_paint(color, v != null ? v : null)];
  }

  function _t(str, size, color, medium, v) {
    const t = figma.createText();
    t.characters = String(str);
    t.fontSize = size;
    t.fontName = { family: 'Inter', style: medium ? 'Medium' : 'Regular' };
    t.fills = _textFill(color, v);
    return t;
  }

  function _tDS(str, size, color, semibold, v) {
    const t = figma.createText();
    t.characters = String(str);
    t.fontSize = size;
    t.fontName = { family: _dsFamily, style: semibold ? 'SemiBold' : 'Regular' };
    t.fills = _textFill(color, v);
    return t;
  }

  function _f(name, dir) {
    dir = dir || 'VERTICAL';
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = dir;
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'AUTO';
    f.fills = [];
    return f;
  }

  function _appendFill(child, parent) {
    parent.appendChild(child);
    child.layoutSizingHorizontal = 'FILL';
    child.layoutSizingVertical   = 'HUG';
  }

  function _addToFrame(child, frame) {
    frame.appendChild(child);
    child.layoutSizingHorizontal = 'FILL';
    child.layoutSizingVertical   = 'HUG';
  }

  function _addRow(row, parent) {
    parent.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.layoutSizingVertical   = 'HUG';
  }

  function _metaCell(label) {
    const c = _f('Meta', 'HORIZONTAL');
    c.paddingLeft = 12; c.paddingRight = 12;
    c.paddingTop = 12;  c.paddingBottom = 12;
    c.primaryAxisAlignItems = 'CENTER';
    c.counterAxisAlignItems = 'CENTER';
    c.appendChild(_t(label, 11, _textColor, false, _V.text));
    return c;
  }

  function _tableRow(name) {
    const r = _f(name, 'HORIZONTAL');
    r.itemSpacing = 0;
    r.counterAxisAlignItems = 'CENTER';
    return r;
  }

  function _addTableDivider(parent) {
    const d = figma.createRectangle();
    d.name = 'Divider';
    d.resize(1, 1);
    d.fills = [_paint(_C.outlineSubtle, _V.outlineSubtle)];
    parent.appendChild(d);
    d.layoutSizingHorizontal = 'FILL';
  }

  const _C_successBgV  = _V.successBg;
  const _C_successBdV  = _V.successBorder;
  const _C_successTxtV = _V.successText;
  const _C_warningBgV  = _V.warningBg;
  const _C_warningBdV  = _V.warningBorder;
  const _C_warningTxtV = _V.warningText;

  function _buildBadge(ratio) {
    let bg, border, fg, bgV, bdV, fgV, sign, score;
    if (ratio >= 7) {
      bg = _C.successBg; border = _C.successBorder; fg = _C.successText;
      bgV = _C_successBgV; bdV = _C_successBdV; fgV = _C_successTxtV;
      sign = '✓'; score = 'AAA';
    } else if (ratio >= 4.5) {
      bg = _C.successBg; border = _C.successBorder; fg = _C.successText;
      bgV = _C_successBgV; bdV = _C_successBdV; fgV = _C_successTxtV;
      sign = '✓'; score = 'AA';
    } else if (ratio >= 3) {
      bg = _C.warningBg; border = _C.warningBorder; fg = _C.warningText;
      bgV = _C_warningBgV; bdV = _C_warningBdV; fgV = _C_warningTxtV;
      sign = '~'; score = 'AA*';
    } else {
      bg = _C.warningBg; border = _C.warningBorder; fg = _C.warningText;
      bgV = _C_warningBgV; bdV = _C_warningBdV; fgV = _C_warningTxtV;
      sign = '✗'; score = 'Fail';
    }
    const badge = _f('Contrast Badge', 'HORIZONTAL');
    badge.paddingLeft = 9; badge.paddingRight = 9;
    badge.paddingTop  = 5; badge.paddingBottom = 5;
    badge.itemSpacing = 4;
    badge.cornerRadius = 8;
    badge.primaryAxisAlignItems = 'CENTER';
    badge.counterAxisAlignItems = 'CENTER';
    badge.fills   = [_paint(bg, bgV)];
    badge.strokes = [_paint(border, bdV)];
    badge.strokeWeight = 1;
    badge.strokeAlign  = 'INSIDE';
    badge.appendChild(_tDS(sign,  10, fg, true, fgV));
    badge.appendChild(_tDS(score, 10, fg, true, fgV));
    return badge;
  }

  function _buildGroupHeader(label) {
    const row = _f('Group Header', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 10; row.paddingBottom = 10;
    row.fills = [_paint(_C.surfaceVariant, _V.surfaceVariant)];
    const t = _tDS((label || 'Other').toUpperCase(), 11, _subColor, true, _V.textSub);
    row.appendChild(t);
    t.layoutSizingHorizontal = 'FILL';
    return row;
  }

  function _buildSectionHeader(title, description) {
    const block = _f('Section Header 1.0.0', 'VERTICAL');
    block.itemSpacing = 8;
    const h = _tDS(title, 24, _textColor, false, _V.text);
    block.appendChild(h);
    h.layoutSizingHorizontal = 'FILL';
    if (description) {
      const d = _tDS(description, 16, _subColor, false, _V.textSub);
      block.appendChild(d);
      d.layoutSizingHorizontal = 'FILL';
    }
    return block;
  }

  function _buildTag(label) {
    const tag = _f('Tag 1.0.0', 'HORIZONTAL');
    tag.paddingLeft = 8;  tag.paddingRight = 8;
    tag.paddingTop  = 4;  tag.paddingBottom = 4;
    tag.itemSpacing = 4;
    tag.cornerRadius = 8;
    tag.primaryAxisAlignItems = 'CENTER';
    tag.counterAxisAlignItems = 'CENTER';
    tag.fills = [_paint(_C.brandVariant, _V.brandVariant)];
    tag.appendChild(_tDS(label, 12, _C.onBrandVariant, true, _V.onBrandVariant));
    return tag;
  }

  function _buildTokenBadge(label) {
    const badge = _f('TokenBadge', 'HORIZONTAL');
    badge.paddingLeft = 12; badge.paddingRight  = 12;
    badge.paddingTop  = 4;  badge.paddingBottom = 4;
    badge.cornerRadius = 4;
    badge.primaryAxisAlignItems = 'CENTER';
    badge.counterAxisAlignItems = 'CENTER';
    badge.fills = [_paint(_C.brandVariant, _V.brandVariant)];
    badge.appendChild(_tDS(label, 12, _C.onBrandVariant, true, _V.onBrandVariant));
    return badge;
  }

  const _TABLE_DESC = '[Describe what these tokens are used for]';

  function _buildTable(title, description) {
    const table = _f('Table 1.0.0', 'VERTICAL');
    table.itemSpacing = 0;
    table.fills   = [_paint(_C.surfaceDefault, _V.surfaceDefault)];
    table.strokes = [_paint(_C.outlineSubtle,  _V.outlineSubtle)];
    table.strokeWeight = 0.5;
    table.strokeAlign  = 'INSIDE';
    table.cornerRadius = 16;
    table.clipsContent = true;

    if (title) {
      const titleRow = _f('Table Title', 'VERTICAL');
      titleRow.paddingLeft = 16; titleRow.paddingRight  = 16;
      titleRow.paddingTop  = 16; titleRow.paddingBottom = description ? 12 : 16;
      titleRow.itemSpacing = 4;
      const titleText = _tDS(title, 18, _textColor, true, _V.text);
      titleRow.appendChild(titleText);
      titleText.layoutSizingHorizontal = 'FILL';
      if (description) {
        const descText = _tDS(description, 13, _subColor, false, _V.textSub);
        descText.name = 'DS Description';
        titleRow.appendChild(descText);
        descText.layoutSizingHorizontal = 'FILL';
      }
      table.appendChild(titleRow);
      titleRow.layoutSizingHorizontal = 'FILL';
      _addTableDivider(table);
    }

    return table;
  }

  function _buildTableHeading(cols, gap) {
    gap = gap !== undefined ? gap : 16;
    const heading = _f('Table Heading', 'HORIZONTAL');
    heading.paddingLeft = 16; heading.paddingRight  = 16;
    heading.paddingTop  = 16; heading.paddingBottom = 16;
    heading.itemSpacing = gap;
    heading.fills = [_paint(_C.brandVariant, _V.brandVariant)];
    heading.counterAxisAlignItems = 'CENTER';
    for (const col of cols) {
      const cell = _f('Th', 'HORIZONTAL');
      cell.primaryAxisAlignItems = col.center ? 'CENTER' : 'MIN';
      cell.counterAxisAlignItems = 'CENTER';
      const headText = _tDS(col.text.toUpperCase(), 12, _textColor, true, _V.text);
      cell.appendChild(headText);
      heading.appendChild(cell);
      if (col.flex) {
        cell.layoutSizingHorizontal = 'FILL';
      } else {
        cell.layoutSizingHorizontal = 'FIXED';
        cell.resize(col.width || 128, cell.height || 1);
      }
      cell.layoutSizingVertical = 'HUG';
    }
    return heading;
  }

  function _swatchIndicator(swatchRGB) {
    const BLACK = { r: 0, g: 0, b: 0 };
    const WHITE = { r: 1, g: 1, b: 1 };
    if (_contrastRatio(swatchRGB, BLACK) >= 4.5) return { fg: _C.onSurface,      show: true };
    if (_contrastRatio(swatchRGB, WHITE) >= 4.5) return { fg: _C.onSurfaceLight, show: true };
    return { fg: null, show: false };
  }

  function _buildSwatch(swatchRGB, fgRGB, sampleText, opts) {
    opts = opts || {};
    const { stepLabel = null, hexLabel = null, swatchVar = null, fgVar = null, sampleFontSize = 10, forceIndicator = false } = opts;

    const swatch = _f('Color Swatch 1.0.0', 'VERTICAL');
    swatch.itemSpacing = 8;
    swatch.counterAxisAlignItems = 'CENTER';

    const container = figma.createFrame();
    container.name = 'Color Container';
    container.layoutMode = 'NONE';
    container.resize(80, 56);
    container.cornerRadius = 8;
    container.fills   = [_paint(swatchRGB, swatchVar)];
    container.strokes = [_paint(_C.outlineSubtle, _V.outlineSubtle)];
    container.strokeWeight = 0.5;
    container.strokeAlign  = 'INSIDE';

    const ratio = _contrastRatio(swatchRGB, fgRGB);
    if ((forceIndicator || ratio >= 4.5) && sampleText) {
      const aaText = _tDS(sampleText, sampleFontSize, fgRGB, true, fgVar);
      aaText.name = 'Aa';
      aaText.x = 7; aaText.y = 7;
      container.appendChild(aaText);

      const dot = figma.createFrame();
      dot.name = 'Contrast Indicator';
      dot.resize(6, 6);
      dot.cornerRadius = 9999;
      dot.layoutMode = 'NONE';
      dot.fills = [_paint(fgRGB, fgVar)];
      dot.x = 80 - 6.75 - 6;
      dot.y = 56 - 7 - 6;
      dot.constraints = { horizontal: 'MAX', vertical: 'MAX' };
      container.appendChild(dot);
    }

    swatch.appendChild(container);
    container.layoutSizingHorizontal = 'FILL';
    container.layoutSizingVertical   = 'FIXED';
    container.resize(container.width, 56);

    if (stepLabel || hexLabel) {
      const labels = _f('Variable', 'VERTICAL');
      labels.itemSpacing = 4;
      labels.counterAxisAlignItems = 'MIN';
      if (stepLabel) {
        const st = _tDS(stepLabel, 10, _textColor, true, _V.text);
        labels.appendChild(st);
        st.layoutSizingHorizontal = 'FILL';
      }
      if (hexLabel) {
        const ht = _tDS(hexLabel, 10, _subColor, false, _V.textSub);
        labels.appendChild(ht);
        ht.layoutSizingHorizontal = 'FILL';
      }
      swatch.appendChild(labels);
      labels.layoutSizingHorizontal = 'FILL';
    }

    return swatch;
  }

  function _sortSteps(vars) {
    return vars.slice().sort((a, b) => {
      const aS = a.name.split('/').pop(), bS = b.name.split('/').pop();
      const aN = parseInt(aS, 10),       bN = parseInt(bS, 10);
      return (!isNaN(aN) && !isNaN(bN)) ? aN - bN : 0;
    });
  }

  function _buildPrimSwatchRow(rampName, vars) {
    const row = _f('Table / Row / Primary Color Swatches 1.0.0', 'VERTICAL');
    row.paddingLeft = 16.5; row.paddingRight  = 16.5;
    row.paddingTop  = 16.5; row.paddingBottom = 16.5;
    row.itemSpacing = 16;
    row.fills = [_paint(_C.surfaceDefault, _V.surfaceDefault)];

    const title = _tDS(rampName, 16, _textColor, true, _V.text);
    row.appendChild(title);
    title.layoutSizingHorizontal = 'FILL';

    const strip = _f('Swatches', 'HORIZONTAL');
    strip.itemSpacing = 8;
    strip.counterAxisAlignItems = 'MIN';

    for (const v of vars) {
      const stepName = v.name.split('/').pop();
      const rawVal   = resolveVarValue(v);
      const swatchRGB = rawVal && 'r' in rawVal
        ? { r: rawVal.r, g: rawVal.g, b: rawVal.b }
        : { r: 0.8, g: 0.8, b: 0.8 };
      const ind = _swatchIndicator(swatchRGB);
      const fgRGB = ind.show ? ind.fg : _textColor;
      const swatch = _buildSwatch(swatchRGB, fgRGB, 'Aa', {
        stepLabel: stepName,
        hexLabel:  rawVal && 'r' in rawVal ? _hex(rawVal) : '—',
        swatchVar: v,
      });
      strip.appendChild(swatch);
      swatch.layoutSizingHorizontal = 'FILL';
      swatch.layoutSizingVertical   = 'HUG';
    }

    row.appendChild(strip);
    strip.layoutSizingHorizontal = 'FILL';
    return row;
  }

  // Outline/border token row — surface bg fill + outline color as stroke, no contrast columns.
  function _buildOutlineRow(token, description, outlineRGB, outlineVar) {
    const row = _f('Table / Row / Outline Token 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_C.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('TokenCell', 'VERTICAL');
    tokenCell.itemSpacing = 8;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const _outTag = _buildTag(token);
    tokenCell.appendChild(_outTag);
    _outTag.layoutSizingHorizontal = 'HUG';
    const _outDesc = _tDS(description || _TABLE_DESC, 12, _subColor, false, _V.textSub);
    _outDesc.name = 'DS Description';
    tokenCell.appendChild(_outDesc);
    _outDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const container = figma.createFrame();
    container.name = 'Outline Container';
    container.layoutMode = 'NONE';
    container.resize(80, 56);
    container.cornerRadius = 8;
    container.fills   = [_paint(_bgColor, _V.bg)];
    container.strokes = [_paint(outlineRGB, outlineVar)];
    container.strokeWeight = 2;
    container.strokeAlign  = 'INSIDE';

    const swatchCell = _f('SwatchCell', 'VERTICAL');
    swatchCell.primaryAxisAlignItems = 'CENTER';
    swatchCell.counterAxisAlignItems = 'CENTER';
    swatchCell.appendChild(container);
    container.layoutSizingHorizontal = 'FILL';
    container.layoutSizingVertical   = 'FIXED';
    container.resize(container.width, 56);
    row.appendChild(swatchCell);
    swatchCell.layoutSizingHorizontal = 'FILL';
    swatchCell.layoutSizingVertical   = 'HUG';

    return row;
  }

  function _buildSemColorRow(token, description, bgRGB, fgRGB, bgVar, opts) {
    opts = opts || {};
    var fgVar    = opts.fgVar    !== undefined ? opts.fgVar    : null;
    var hasPairing = opts.hasPairing !== undefined ? opts.hasPairing : true;
    const ratio = _contrastRatio(bgRGB, fgRGB);
    const row = _f('Table / Row / Semantic Color Pairs 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_C.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('TokenCell', 'VERTICAL');
    tokenCell.itemSpacing = 8;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const _semTag = _buildTag(token);
    tokenCell.appendChild(_semTag);
    _semTag.layoutSizingHorizontal = 'HUG';
    const _semRowDesc = _tDS(description || _TABLE_DESC, 12, _subColor, false, _V.textSub);
    _semRowDesc.name = 'DS Description';
    tokenCell.appendChild(_semRowDesc);
    _semRowDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const swatchCell = _f('SwatchCell', 'VERTICAL');
    swatchCell.primaryAxisAlignItems = 'CENTER';
    swatchCell.counterAxisAlignItems = 'CENTER';
    const swatch = _buildSwatch(bgRGB, fgRGB, opts.isIcon ? '☻' : token, {
      swatchVar: bgVar,
      fgVar: fgVar,
      sampleFontSize: opts.isIcon ? 16 : 10,
      forceIndicator: opts.isIcon ? true : false,
    });
    swatchCell.appendChild(swatch);
    swatch.layoutSizingHorizontal = 'FILL';
    row.appendChild(swatchCell);
    swatchCell.layoutSizingHorizontal = 'FILL';
    swatchCell.layoutSizingVertical   = 'FILL';

    if (hasPairing) {
      const metricCell = _f('MetricCell', 'HORIZONTAL');
      metricCell.primaryAxisAlignItems = 'CENTER';
      metricCell.counterAxisAlignItems = 'CENTER';
      metricCell.appendChild(_tDS(`${ratio.toFixed(2)}:1`, 14, _textColor, false, _V.text));
      row.appendChild(metricCell);
      metricCell.layoutSizingHorizontal = 'FIXED';
      metricCell.resize(128, 1);
      metricCell.layoutSizingVertical   = 'FILL';

      const badgeCell = _f('BadgeCell', 'HORIZONTAL');
      badgeCell.primaryAxisAlignItems = 'CENTER';
      badgeCell.counterAxisAlignItems = 'CENTER';
      badgeCell.appendChild(_buildBadge(ratio));
      row.appendChild(badgeCell);
      badgeCell.layoutSizingHorizontal = 'FIXED';
      badgeCell.resize(128, 1);
      badgeCell.layoutSizingVertical   = 'FILL';
    }

    return row;
  }

  function _buildTypoRow(style) {
    const row = _f('Table / Row / Typography 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_C.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('Table Cell', 'VERTICAL');
    tokenCell.itemSpacing = 8;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const _typoTag = _buildTag(style.name);
    tokenCell.appendChild(_typoTag);
    _typoTag.layoutSizingHorizontal = 'HUG';
    const _typoDesc = _tDS((style.description && style.description.trim()) || _TABLE_DESC, 12, _subColor, false, _V.textSub);
    _typoDesc.name = 'DS Description';
    tokenCell.appendChild(_typoDesc);
    _typoDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const sampleCell = _f('Table Cell', 'VERTICAL');
    sampleCell.primaryAxisAlignItems = 'CENTER';
    sampleCell.counterAxisAlignItems = 'MIN';
    sampleCell.clipsContent = true;
    const sampleText = figma.createText();
    sampleText.textStyleId    = style.id;
    sampleText.characters     = 'The quick brown fox jumps over the lazy dog';
    sampleText.fills          = _textFill(_textColor, _V.text);
    sampleText.maxLines       = 1;
    sampleText.textTruncation = 'ENDING';
    sampleCell.appendChild(sampleText);
    row.appendChild(sampleCell);
    sampleCell.layoutSizingHorizontal = 'FILL';
    sampleCell.layoutSizingVertical   = 'HUG';
    sampleText.layoutSizingHorizontal = 'FILL';

    const sizeCell = _f('Table Cell', 'VERTICAL');
    sizeCell.primaryAxisAlignItems = 'CENTER';
    sizeCell.counterAxisAlignItems = 'MIN';
    sizeCell.appendChild(_tDS(`${style.fontSize}px`, 14, _textColor, false, _V.text));
    row.appendChild(sizeCell);
    sizeCell.layoutSizingHorizontal = 'FIXED';
    sizeCell.resize(128, 1);
    sizeCell.layoutSizingVertical   = 'FILL';

    const lhVal = typeof style.lineHeight === 'object' && style.lineHeight.unit !== 'AUTO'
      ? `${Math.round(style.lineHeight.value)}${style.lineHeight.unit === 'PERCENT' ? '%' : 'px'}`
      : 'auto';
    const lhCell = _f('Table Cell', 'VERTICAL');
    lhCell.primaryAxisAlignItems = 'CENTER';
    lhCell.counterAxisAlignItems = 'MIN';
    lhCell.appendChild(_tDS(lhVal, 14, _textColor, false, _V.text));
    row.appendChild(lhCell);
    lhCell.layoutSizingHorizontal = 'FIXED';
    lhCell.resize(128, 1);
    lhCell.layoutSizingVertical   = 'FILL';

    const wtCell = _f('Table Cell', 'VERTICAL');
    wtCell.primaryAxisAlignItems = 'CENTER';
    wtCell.counterAxisAlignItems = 'MIN';
    wtCell.appendChild(_tDS(style.fontName.style, 14, _textColor, false, _V.text));
    row.appendChild(wtCell);
    wtCell.layoutSizingHorizontal = 'FIXED';
    wtCell.resize(128, 1);
    wtCell.layoutSizingVertical   = 'FILL';

    return row;
  }

  function _buildSpacingVisual(type, value) {
    const px = value !== null && isFinite(value) ? Math.round(value) : 1;

    if (type === 'spacing') {
      const size = Math.min(Math.max(px, 2), 128);
      const sq = figma.createRectangle();
      sq.resize(size, size);
      sq.fills = [_paint(_accColor, _V.surfaceBrand)];
      sq.cornerRadius = 2;
      return sq;
    }

    if (type === 'touch') {
      const size = Math.max(px, 16);
      const el = figma.createEllipse();
      el.resize(size, size);
      el.fills       = [_paint(_C.brandVariant, _V.brandVariant)];
      el.strokes     = [_paint(_accColor,        _V.surfaceBrand)];
      el.strokeWeight = 2;
      el.strokeAlign  = 'INSIDE';
      el.dashPattern  = [4, 4];
      return el;
    }

    if (type === 'radius') {
      const sq = figma.createRectangle();
      sq.resize(56, 56);
      sq.fills        = [_paint(_C.brandVariant, _V.brandVariant)];
      sq.strokes      = [_paint(_accColor,        _V.surfaceBrand)];
      sq.strokeWeight  = 1;
      sq.strokeAlign   = 'INSIDE';
      sq.cornerRadius  = Math.min(px, 28);
      return sq;
    }

    const sq = figma.createRectangle();
    sq.resize(56, 56);
    sq.fills        = [_paint(_C.brandVariant, _V.brandVariant)];
    sq.strokes      = [_paint(_accColor,        _V.surfaceBrand)];
    sq.strokeWeight  = Math.max(px, 0.5);
    sq.strokeAlign   = 'INSIDE';
    sq.cornerRadius  = 2;
    return sq;
  }

  function _buildSpacingRow(v, px, visualType) {
    const pxNum    = px !== null && isFinite(px) ? Math.round(px) : 0;
    const desc     = (v.description && v.description.trim()) ? v.description.trim() : null;

    const row = _f('Table / Row / Spacing & Effects 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 8;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_C.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('Container', 'VERTICAL');
    tokenCell.itemSpacing = 4;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const badge = _buildTokenBadge(v.name);
    tokenCell.appendChild(badge);
    const _spDesc = _tDS(desc || _TABLE_DESC, 12, _subColor, false, _V.textSub);
    _spDesc.name = 'DS Description';
    tokenCell.appendChild(_spDesc);
    _spDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const visualCell = _f('Visual', 'HORIZONTAL');
    visualCell.counterAxisAlignItems = 'CENTER';
    visualCell.clipsContent = true;
    const visual = _buildSpacingVisual(visualType, px);
    visualCell.appendChild(visual);
    row.appendChild(visualCell);
    visualCell.layoutSizingHorizontal = 'FIXED';
    visualCell.resize(64, 1);
    visualCell.layoutSizingVertical   = 'HUG';

    const valueCell = _f('Text', 'HORIZONTAL');
    valueCell.itemSpacing = 4;
    valueCell.counterAxisAlignItems = 'CENTER';
    const valStr = px !== null ? `${pxNum}px` : '—';
    const rawStr = px !== null ? `(${pxNum})` : '';
    const valText = _tDS(valStr, 12, _accColor, false, _V.surfaceBrand);
    valueCell.appendChild(valText);
    if (rawStr) {
      const rawText = _tDS(rawStr, 12, _subColor, false, _V.textSub);
      valueCell.appendChild(rawText);
    }
    row.appendChild(valueCell);
    valueCell.layoutSizingHorizontal = 'FIXED';
    valueCell.resize(104, 1);
    valueCell.layoutSizingVertical   = 'HUG';

    return row;
  }

  function _groupVisualType(groupPath, resolvedValues) {
    const vals = resolvedValues.filter(v => v !== null && isFinite(v));
    if (!vals.length) return 'bar';
    const normalVals    = vals.filter(v => v < 500);
    const effectiveVals = normalVals.length >= Math.ceil(vals.length * 0.5) ? normalVals : vals;
    const effectiveMax  = Math.max(...effectiveVals);
    const posVals       = effectiveVals.filter(v => v > 0);
    const effectiveMin  = posVals.length ? Math.min(...posVals) : 0;
    if (effectiveMax <= 8 && vals.length <= 8) return 'border';
    if (/radius|corner|round|pill|curve/i.test(groupPath) && effectiveMax <= 128) return 'radius';
    if (effectiveMax <= 24 && vals.length <= 16 && effectiveMin > 0 && effectiveMax / effectiveMin >= 8) return 'radius';
    if (/touch|tap[-_]?target|hit[-_]?area|minimum[-_]?size|interactive[-_]?size/i.test(groupPath)) return 'touch';
    return 'bar';
  }

  function _tokenDesc(name) {
    const segs = name.toLowerCase().split('/').filter(s => s !== 'color');
    const last = segs[segs.length - 1];
    const has  = k => segs.some(s => s === k || s.startsWith(k + '-'));
    const qualifier = segs.find(s => !['surface','on-surface','outline','border','icon','state','on','color'].includes(s) && !s.startsWith('on-')) || last;

    if (has('icon')) {
      if (qualifier === 'brand')   return 'Brand-colored icon.';
      if (qualifier === 'default' || qualifier === 'icon') return 'Default icon color.';
      if (qualifier === 'subtle')  return 'Low-emphasis icon color.';
      if (qualifier === 'inverse') return 'Icon color for inverted surfaces.';
      return `${qualifier} icon color.`;
    }
    if (segs.some(s => s.startsWith('on-'))) {
      const onSeg = segs.find(s => s.startsWith('on-'));
      const surface = onSeg.replace('on-', '');
      if (surface === 'surface') {
        if (last === 'default') return 'Primary text and icon color on any surface.';
        if (last === 'variant') return 'Secondary text for labels and captions.';
      }
      return `Foreground for ${surface}-colored surfaces.`;
    }
    if (has('surface')) {
      if (last === 'default') return 'Default background for cards and panels.';
      if (last === 'variant') return 'Secondary background for nested containers.';
      return `${qualifier} surface background.`;
    }
    if (has('outline') || has('border')) {
      if (last === 'default') return 'Default border for inputs and cards.';
      if (last === 'subtle')  return 'Low-emphasis border for dividers.';
      return `${qualifier} border color.`;
    }
    return null;
  }

  // ── Page setup ───────────────────────────────────────────────────────────────

  let _page = figma.root.children.find(p => p.name === '00 · Tokens');
  if (!_page) {
    _page = figma.createPage();
    _page.name = '00 · Tokens';
  }
  await figma.setCurrentPageAsync(_page);

  const _SECTION_GAP = 100;
  const _existingShowcases = _page.children.filter(
    n => (n.type === 'FRAME' || n.type === 'SECTION') && n.name.startsWith('Token Showcase')
  );
  let _sectionX = _existingShowcases.length > 0
    ? Math.max(..._existingShowcases.map(n => n.x + n.width)) + _SECTION_GAP
    : 0;

  function _makeShowcaseFrame(name) {
    const f = figma.createFrame();
    f.name = `Token Showcase — ${name}`;
    f.layoutMode = 'VERTICAL';
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'FIXED';
    f.resize(1200, 100);
    f.itemSpacing   = 48;
    f.paddingTop    = 48; f.paddingBottom = 48;
    f.paddingLeft   = 48; f.paddingRight  = 48;
    f.fills = [_paint(_bgColor, _V.bg)];
    return f;
  }

  function _placeShowcaseSection(sectionName, frame, xOverride) {
    const sec = figma.createSection();
    sec.name = `Token Showcase — ${sectionName}`;
    _page.appendChild(sec);
    sec.appendChild(frame);
    frame.x = 0;
    frame.y = 0;
    const posX = xOverride !== null && xOverride !== undefined ? xOverride : _sectionX;
    sec.x = posX;
    sec.y = 0;
    sec.resizeWithoutConstraints(frame.width, frame.height);
    _sectionX = posX + frame.width + _SECTION_GAP;
    return sec;
  }

  // ── Colors section ───────────────────────────────────────────────────────────

  const _prevColors = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Colors'
  );
  const _myColorsX = _prevColors ? _prevColors.x : _sectionX;

  if (_primColls.length || _semanticColls.length) {
    if (_prevColors) _prevColors.remove();
    const _colorsFrame = _makeShowcaseFrame('Colors');
    _addToFrame(_buildSectionHeader('Colors', 'Primitive ramps and their semantic surface / foreground pairs.'), _colorsFrame);

    if (_primColls.length) {
      const _primTable = _buildTable('Primitives', _TABLE_DESC);

      for (const coll of _primColls) {
        const _colorVars = coll.vars.filter(v => {
          if (v.resolvedType !== 'COLOR') return false;
          const raw = resolveVarValue(v);
          if (raw && raw.a !== undefined && raw.a < 0.95) return false;
          return true;
        });
        const _rampMap = groupByPath(_colorVars);

        for (const [rampName, vars] of Object.entries(_rampMap)) {
          const sortedVars = _sortSteps(vars);
          const primRow = _buildPrimSwatchRow(rampName || coll.name, sortedVars);
          _primTable.appendChild(primRow);
          primRow.layoutSizingHorizontal = 'FILL';
          _addTableDivider(_primTable);
        }
      }

      _appendFill(_primTable, _colorsFrame);
    }

    if (_semanticColls.length) {
      const _semVarRGB = new Map();
      for (const coll of _semanticColls) {
        for (const v of coll.vars.filter(v => v.resolvedType === 'COLOR')) {
          const raw = resolveVarValue(v);
          if (raw && 'r' in raw) _semVarRGB.set(v.name, { r: raw.r, g: raw.g, b: raw.b });
        }
      }

      function _findFgPair(bgVarName) {
        const parts = bgVarName.split('/');
        for (let i = parts.length - 1; i >= 0; i--) {
          const candidate = [...parts];
          candidate[i] = 'on-' + candidate[i];
          const rgb = _semVarRGB.get(candidate.join('/'));
          if (rgb) return rgb;
        }
        return null;
      }

      const _allSemGroupEntries = [];
      for (const coll of _semanticColls) {
        if (!coll.colorVarCount) continue;
        const colorGroups = coll.colorGroups || groupByPath(coll.vars.filter(v => v.resolvedType === 'COLOR'));
        for (const entry of Object.entries(colorGroups)) _allSemGroupEntries.push(entry);
      }

      const _mainGroups   = [];
      const _bottomGroups = [];

      for (const [groupKey, groupVars] of _allSemGroupEntries) {
        const nonOnVars = groupVars.filter(v => !v.name.split('/').some(seg => /^on[-_]/i.test(seg)));
        const bgPairedRows = [], bgUnpairedRows = [], fgRows = [];

        for (const v of nonOnVars) {
          const raw = resolveVarValue(v);
          if (!raw || !('r' in raw)) continue;
          if (raw.a !== undefined && raw.a < 0.95) continue;

          const isIcon    = /(?:^|\/)icon(?:\/|$)/i.test(v.name);
          const isOutline = /(?:^|\/)(?:outline|border|stroke)(?:\/|$)/i.test(v.name);
          const tokenLeaf = v.name.split('/').pop();
          const desc      = _tokenDesc(v.name);

          if (isOutline) {
            // Outline tokens: surface bg + stroke — no contrast columns
            const outlineRGB = { r: raw.r, g: raw.g, b: raw.b };
            const row = _buildOutlineRow(tokenLeaf, desc, outlineRGB, v);
            bgUnpairedRows.push(row);
          } else if (isIcon) {
            // Icons are foreground colors — find the best surface to show them on.
            // Priority 1: semantic pairing (replace 'icon' with 'surface' in the path),
            //   e.g. color/icon/inverse → color/surface/inverse (a dark surface).
            //   Use if it gives ≥ 3:1 contrast against the icon color.
            // Priority 2: default surface (the neutral page background).
            //   Use when no semantic pairing exists or its contrast is poor.
            var iconRGB = { r: raw.r, g: raw.g, b: raw.b };
            var iconPathParts = v.name.split('/');
            var iconSegIdx    = iconPathParts.findIndex(function(p) { return /^icon$/i.test(p); });
            var semSurfacePath = iconSegIdx >= 0
              ? iconPathParts.map(function(p, i) { return i === iconSegIdx ? 'surface' : p; }).join('/')
              : null;
            var semSurfaceRaw = semSurfacePath ? (_semVarRGB.get(semSurfacePath) || null) : null;
            var semSurfaceVar = semSurfacePath ? (varByName[semSurfacePath] || null) : null;
            var semContrast   = semSurfaceRaw ? _contrastRatio(iconRGB, semSurfaceRaw) : 0;

            var defSurfaceVar = _V.surfaceDefault || _V.bg || null;
            var defSurfaceRaw = defSurfaceVar ? resolveVarValue(defSurfaceVar) : null;
            var defSurfaceRGB = defSurfaceRaw && 'r' in defSurfaceRaw
              ? { r: defSurfaceRaw.r, g: defSurfaceRaw.g, b: defSurfaceRaw.b }
              : _bgColor;
            var defContrast   = _contrastRatio(iconRGB, defSurfaceRGB);

            // Use semantic surface if it gives meaningfully better contrast; otherwise default.
            var useSemanticPair = semSurfaceRaw && semContrast >= 3 && semContrast >= defContrast * 0.8;
            var iconSurfaceRGB = useSemanticPair ? semSurfaceRaw : defSurfaceRGB;
            var iconSurfaceVar = useSemanticPair ? semSurfaceVar : defSurfaceVar;

            // Luminance-based fallback for light icons (e.g. icon/inverse, icon/on-dark).
            // If the icon is very light and neither the semantic surface nor the default
            // surface provides good contrast, scan for the darkest available surface variable.
            if (!useSemanticPair && _lum(iconRGB) > 0.6) {
              var _darkestVar = null, _darkestLum = Infinity;
              var _allVarValues = Object.values(varByName);
              for (var _di = 0; _di < _allVarValues.length; _di++) {
                var _dv = _allVarValues[_di];
                if (_dv.resolvedType !== 'COLOR') continue;
                if (!/(?:surface|background|base|page)/i.test(_dv.name)) continue;
                if (/(?:^|\/)on[-_]/i.test(_dv.name)) continue; // exclude on-surface, on-background, etc.
                var _dRaw = resolveVarValue(_dv);
                if (!_dRaw || !('r' in _dRaw)) continue;
                var _dLum = _lum({ r: _dRaw.r, g: _dRaw.g, b: _dRaw.b });
                if (_dLum < _darkestLum) { _darkestLum = _dLum; _darkestVar = { v: _dv, raw: _dRaw }; }
              }
              if (_darkestVar) {
                var _darkRGB = { r: _darkestVar.raw.r, g: _darkestVar.raw.g, b: _darkestVar.raw.b };
                if (_contrastRatio(iconRGB, _darkRGB) > _contrastRatio(iconRGB, iconSurfaceRGB)) {
                  iconSurfaceRGB = _darkRGB;
                  iconSurfaceVar = _darkestVar.v;
                }
              }
            }

            fgRows.push(_buildSemColorRow(
              tokenLeaf, desc,
              iconSurfaceRGB, iconRGB,
              iconSurfaceVar, { isIcon: true, fgVar: v, hasPairing: true }
            ));
          } else {
            const bgRGB = { r: raw.r, g: raw.g, b: raw.b };
            // Try to find the fg pairing both as RGB and as a variable
            var fgPairName = null;
            var fgPairParts = v.name.split('/');
            for (var pi = fgPairParts.length - 1; pi >= 0; pi--) {
              var cand = fgPairParts.slice();
              cand[pi] = 'on-' + cand[pi];
              var candName = cand.join('/');
              if (_semVarRGB.has(candName)) { fgPairName = candName; break; }
            }
            const fgRGB    = fgPairName ? _semVarRGB.get(fgPairName) : null;
            const fgVar    = fgPairName ? (varByName[fgPairName] || null) : null;
            const hasPairing = !!fgRGB;
            const effectiveFg = fgRGB || (function() {
              var ind = _swatchIndicator(bgRGB);
              return ind.show ? ind.fg : _textColor;
            })();
            const row = _buildSemColorRow(tokenLeaf, desc, bgRGB, effectiveFg, v, { fgVar: fgVar, hasPairing: hasPairing });
            if (hasPairing) bgPairedRows.push(row);
            else bgUnpairedRows.push(row);
          }
        }

        if (!bgPairedRows.length && !bgUnpairedRows.length && !fgRows.length) continue;
        const groupLabel = groupKey.split('/').pop() || groupKey;

        if (bgPairedRows.length) {
          _mainGroups.push({ label: groupLabel, rows: [...bgPairedRows, ...bgUnpairedRows] });
          if (fgRows.length) _bottomGroups.push({ label: groupLabel, rows: fgRows });
        } else {
          _bottomGroups.push({ label: groupLabel, rows: [...fgRows, ...bgUnpairedRows] });
        }
      }

      if (_mainGroups.length) {
        const _semTable = _buildTable('Semantic Colors', _TABLE_DESC);
        const _semHeading = _buildTableHeading([
          { text: 'Token',    flex: true },
          { text: 'Example',  flex: true },
          { text: 'Contrast', width: 128, center: true },
          { text: 'WCAG',     width: 128, center: true },
        ], 16);
        _semTable.appendChild(_semHeading);
        _semHeading.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_semTable);

        for (const { label, rows } of _mainGroups) {
          const headerRow = _buildGroupHeader(label);
          _semTable.appendChild(headerRow);
          headerRow.layoutSizingHorizontal = 'FILL';
          _addTableDivider(_semTable);
          for (const row of rows) {
            _semTable.appendChild(row);
            row.layoutSizingHorizontal = 'FILL';
            _addTableDivider(_semTable);
          }
        }
        _appendFill(_semTable, _colorsFrame);
      }

      for (const { label, rows } of _bottomGroups) {
        const _btTable = _buildTable(label, _TABLE_DESC);
        const _btHeading = _buildTableHeading([
          { text: 'Token',   flex: true },
          { text: 'Example', flex: true },
        ], 16);
        _btTable.appendChild(_btHeading);
        _btHeading.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_btTable);
        for (const row of rows) {
          _btTable.appendChild(row);
          row.layoutSizingHorizontal = 'FILL';
          _addTableDivider(_btTable);
        }
        _appendFill(_btTable, _colorsFrame);
      }
    }

    _placeShowcaseSection('Colors', _colorsFrame, _myColorsX);
  }

  // ── Typography section ───────────────────────────────────────────────────────

  const _prevTypography = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Typography'
  );
  const _myTypographyX = _prevTypography ? _prevTypography.x : _sectionX;

  if (_sortedStyles.length) {
    if (_prevTypography) _prevTypography.remove();
    const _typoFrame = _makeShowcaseFrame('Typography');
    _addToFrame(_buildSectionHeader('Typography', 'Text styles, sizes, weights, and line heights.'), _typoFrame);

    const _typoTable = _buildTable(null);
    const _typoHeading = _buildTableHeading([
      { text: 'Token',       flex: true },
      { text: 'Example',     flex: true },
      { text: 'Size',        width: 128 },
      { text: 'Line Height', width: 128 },
      { text: 'Weight',      width: 128 },
    ], 16);
    _typoTable.appendChild(_typoHeading);
    _typoHeading.layoutSizingHorizontal = 'FILL';
    _addTableDivider(_typoTable);

    for (const style of _sortedStyles) {
      const row = _buildTypoRow(style);
      _typoTable.appendChild(row);
      row.layoutSizingHorizontal = 'FILL';
      _addTableDivider(_typoTable);
    }

    _appendFill(_typoTable, _typoFrame);
    _placeShowcaseSection('Typography', _typoFrame, _myTypographyX);
  }

  // ── Spacing section ──────────────────────────────────────────────────────────

  const _prevSpacing = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Spacing'
  );
  const _mySpacingX = _prevSpacing ? _prevSpacing.x : _sectionX;

  if (_floatColls.length) {
    if (_prevSpacing) _prevSpacing.remove();

    const _barGroups    = [];
    const _touchGroups  = [];
    const _radiusGroups = [];
    const _borderGroups = [];

    for (const coll of _floatColls) {
      const _floatVarsInColl = coll.vars.filter(v => v.resolvedType === 'FLOAT');
      const _groups = groupByPath(_floatVarsInColl);

      for (const [groupPath, vars] of Object.entries(_groups)) {
        if (/^(?:type|typo|typography|font|text(?:[\/-]|$)|label|body|heading|display|caption|letter|tracking|leading|line[-_]?height|font[-_]?size|font[-_]?weight)/i.test(groupPath)) continue;
        const _resolved  = vars.map(v => { const n = resolveVarValue(v); return typeof n === 'number' ? n : null; });
        const _sorted    = vars.map((v, i) => ({ v, val: _resolved[i] }))
                               .sort((a, b) => (a.val != null ? a.val : Infinity) - (b.val != null ? b.val : Infinity));
        const sortedVars   = _sorted.map(p => p.v);
        const sortedValues = _sorted.map(p => p.val);
        const type = _groupVisualType(groupPath, sortedValues);
        const entry = { groupPath: groupPath || coll.name, sortedVars, sortedValues };
        if (type === 'touch')  _touchGroups.push(entry);
        else if (type === 'radius') _radiusGroups.push(entry);
        else if (type === 'border') _borderGroups.push(entry);
        else _barGroups.push(entry);
      }
    }

    const _spacingFrame = _makeShowcaseFrame('Spacing');
    _addToFrame(_buildSectionHeader('Spacing', 'Scale, border radius, and border width tokens.'), _spacingFrame);

    function _buildGroupTable(groupPath, sortedVars, sortedValues, parentCol, visualType) {
      const svType = visualType === 'bar' ? 'spacing' : visualType;
      const table = _buildTable(groupPath.split('/').pop() || groupPath, _TABLE_DESC);
      for (let i = 0; i < sortedVars.length; i++) {
        const row = _buildSpacingRow(sortedVars[i], sortedValues[i], svType);
        table.appendChild(row);
        row.layoutSizingHorizontal = 'FILL';
        _addTableDivider(table);
      }
      _appendFill(table, parentCol);
    }

    const _spTwoCols = _f('Two Columns', 'HORIZONTAL');
    _spTwoCols.itemSpacing = 24;
    _spTwoCols.counterAxisAlignItems = 'MIN';

    if (_barGroups.length) {
      const _leftCol = _f('Spacing', 'VERTICAL');
      _leftCol.itemSpacing = 32;
      _spTwoCols.appendChild(_leftCol);
      _leftCol.layoutSizingHorizontal = 'FILL';
      for (const { groupPath, sortedVars, sortedValues } of _barGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _leftCol, 'bar');
      }
    }

    if (_touchGroups.length || _radiusGroups.length || _borderGroups.length) {
      const _rightCol = _f('Effects', 'VERTICAL');
      _rightCol.itemSpacing = 32;
      _spTwoCols.appendChild(_rightCol);
      _rightCol.layoutSizingHorizontal = 'FILL';
      for (const { groupPath, sortedVars, sortedValues } of _touchGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _rightCol, 'touch');
      }
      for (const { groupPath, sortedVars, sortedValues } of _radiusGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _rightCol, 'radius');
      }
      for (const { groupPath, sortedVars, sortedValues } of _borderGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _rightCol, 'border');
      }
    }

    _appendFill(_spTwoCols, _spacingFrame);
    _placeShowcaseSection('Spacing', _spacingFrame, _mySpacingX);
  }

  // ── Elevation section ────────────────────────────────────────────────────────

  const _elevationStyles = effectStyles
    .filter(s => s.effects.some(e => e.type === 'DROP_SHADOW'))
    .sort((a, b) => {
      const aE = a.effects.find(e => e.type === 'DROP_SHADOW');
      const bE = b.effects.find(e => e.type === 'DROP_SHADOW');
      return (aE ? aE.radius : 0) - (bE ? bE.radius : 0);
    });

  const _prevElevation = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Elevation'
  );
  const _myElevationX = _prevElevation ? _prevElevation.x : _sectionX;

  if (_elevationStyles.length) {
    if (_prevElevation) _prevElevation.remove();
    const _elevFrame = _makeShowcaseFrame('Elevation');
    _addToFrame(_buildSectionHeader('Elevation', 'Drop shadows for layering depth.'), _elevFrame);

    const _elevTable = _buildTable('Elevation', _TABLE_DESC);
    const _elevHeading = _buildTableHeading([
      { text: 'Token',    flex: true },
      { text: 'Preview',  width: 96  },
      { text: 'Offset Y', width: 96  },
      { text: 'Blur',     width: 96  },
      { text: 'Spread',   width: 96  },
    ], 8);
    _elevTable.appendChild(_elevHeading);
    _elevHeading.layoutSizingHorizontal = 'FILL';
    _addTableDivider(_elevTable);

    for (const style of _elevationStyles) {
      const shadow = style.effects.find(e => e.type === 'DROP_SHADOW');
      const row = _tableRow(style.name);
      row.fills    = [_paint(_C.surfaceDefault, _V.surfaceDefault)];
      row.paddingLeft = 16; row.paddingRight  = 16;
      row.paddingTop  = 16; row.paddingBottom = 16;
      row.itemSpacing = 8;

      const tokenCell = _f('TokenCell', 'VERTICAL');
      tokenCell.paddingLeft = 12; tokenCell.paddingRight  = 12;
      tokenCell.paddingTop  = 12; tokenCell.paddingBottom = 12;
      tokenCell.itemSpacing = 6;
      tokenCell.counterAxisAlignItems = 'MIN';
      tokenCell.primaryAxisAlignItems = 'CENTER';
      const _elevTag = _buildTag(style.name.split('/').pop());
      tokenCell.appendChild(_elevTag);
      _elevTag.layoutSizingHorizontal = 'HUG';
      const _elevDesc = _tDS(_tokenDesc(style.name) || _TABLE_DESC, 12, _subColor, false, _V.textSub);
      _elevDesc.name = 'DS Description';
      tokenCell.appendChild(_elevDesc);
      _elevDesc.layoutSizingHorizontal = 'FILL';
      row.appendChild(tokenCell);
      tokenCell.layoutSizingHorizontal = 'FILL';
      tokenCell.layoutSizingVertical   = 'FILL';

      const card = figma.createFrame();
      card.resize(56, 40);
      card.clipsContent = false;
      card.cornerRadius = 8;
      card.fills = [_paint(_bgColor, _V.bg)];
      card.effectStyleId = style.id;
      const previewCell = _f('Visual', 'HORIZONTAL');
      previewCell.paddingTop = 8; previewCell.paddingBottom = 8;
      previewCell.paddingLeft = 12; previewCell.paddingRight = 12;
      previewCell.primaryAxisAlignItems = 'CENTER';
      previewCell.counterAxisAlignItems = 'CENTER';
      previewCell.appendChild(card);
      row.appendChild(previewCell);
      previewCell.layoutSizingHorizontal = 'FIXED';
      previewCell.resize(96, 1);
      previewCell.layoutSizingVertical   = 'FILL';

      const offsetY = shadow ? `${shadow.offset.y}px`   : '—';
      const blur    = shadow ? `${shadow.radius}px`      : '—';
      const spread  = shadow ? `${shadow.spread != null ? shadow.spread : 0}px` : '—';
      for (const val of [offsetY, blur, spread]) {
        const mc = _metaCell(val);
        row.appendChild(mc);
        mc.layoutSizingHorizontal = 'FIXED';
        mc.resize(96, 1);
        mc.layoutSizingVertical   = 'FILL';
      }

      _addRow(row, _elevTable);
      _addTableDivider(_elevTable);
    }

    _appendFill(_elevTable, _elevFrame);
    _placeShowcaseSection('Elevation', _elevFrame, _myElevationX);
  }

  // ── Scrims section ───────────────────────────────────────────────────────────

  const _scrimVars = Object.values(varByName)
    .filter(v => {
      if (v.resolvedType !== 'COLOR') return false;
      const c = resolveVarValue(v);
      if (!c || !('r' in c)) return false;
      return (c.a !== undefined ? c.a : 1) < 0.95;
    })
    .sort((a, b) => {
      const aA = (() => { const c = resolveVarValue(a); return c ? (c.a != null ? c.a : 1) : 1; })();
      const bA = (() => { const c = resolveVarValue(b); return c ? (c.a != null ? c.a : 1) : 1; })();
      return Math.abs(aA - bA) > 0.01 ? aA - bA : a.name.localeCompare(b.name);
    });

  const _prevScrims = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Scrims'
  );
  const _myScrimsX = _prevScrims ? _prevScrims.x : _sectionX;

  if (_scrimVars.length) {
    if (_prevScrims) _prevScrims.remove();
    const _scrimFrame = _makeShowcaseFrame('Scrims');
    _addToFrame(_buildSectionHeader('Overlays & Scrims', 'Scrim and overlay opacity tokens.'), _scrimFrame);

    const _scrimTable = _buildTable('Overlays & Scrims', _TABLE_DESC);
    const _scrimHeading = _buildTableHeading([
      { text: 'Token',   flex: true },
      { text: 'Preview', width: 96  },
      { text: 'Opacity', width: 96, center: true },
    ], 8);
    _scrimTable.appendChild(_scrimHeading);
    _scrimHeading.layoutSizingHorizontal = 'FILL';
    _addTableDivider(_scrimTable);

    const _scrimGroups = {};
    for (const v of _scrimVars) {
      const parts = v.name.split('/');
      const key   = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!_scrimGroups[key]) _scrimGroups[key] = [];
      _scrimGroups[key].push(v);
    }

    for (const [groupPath, groupVars] of Object.entries(_scrimGroups)) {
      if (Object.keys(_scrimGroups).length > 1 && groupPath) {
        const groupHeader = _buildGroupHeader(groupPath.split('/').pop() || groupPath);
        _scrimTable.appendChild(groupHeader);
        groupHeader.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_scrimTable);
      }

      for (const scrimVar of groupVars) {
        const scrimResolved = resolveVarValue(scrimVar);
        const scrimRGB   = scrimResolved && 'r' in scrimResolved
          ? { r: scrimResolved.r, g: scrimResolved.g, b: scrimResolved.b }
          : { r: 0, g: 0, b: 0 };
        const scrimAlpha = scrimResolved && scrimResolved.a !== undefined ? scrimResolved.a : 0.5;
        const desc       = (scrimVar.description && scrimVar.description.trim()) ? scrimVar.description.trim() : null;

        const row = _tableRow(scrimVar.name);
        row.fills    = [_paint(_C.surfaceDefault, _V.surfaceDefault)];
        row.paddingLeft = 16; row.paddingRight  = 16;
        row.paddingTop  = 16; row.paddingBottom = 16;
        row.itemSpacing = 8;

        const tokenCell = _f('TokenCell', 'VERTICAL');
        tokenCell.paddingLeft = 12; tokenCell.paddingRight  = 12;
        tokenCell.paddingTop  = 12; tokenCell.paddingBottom = 12;
        tokenCell.itemSpacing = 6;
        tokenCell.counterAxisAlignItems = 'MIN';
        tokenCell.primaryAxisAlignItems = 'CENTER';
        const _scrimTag = _buildTag(scrimVar.name.split('/').pop());
        tokenCell.appendChild(_scrimTag);
        _scrimTag.layoutSizingHorizontal = 'HUG';
        const scrimDescText = _tokenDesc(scrimVar.name);
        const _scrimDesc = _tDS(scrimDescText || desc || _TABLE_DESC, 12, _subColor, false, _V.textSub);
        _scrimDesc.name = 'DS Description';
        tokenCell.appendChild(_scrimDesc);
        _scrimDesc.layoutSizingHorizontal = 'FILL';
        row.appendChild(tokenCell);
        tokenCell.layoutSizingHorizontal = 'FILL';
        tokenCell.layoutSizingVertical   = 'FILL';

        const demo = figma.createFrame();
        demo.resize(56, 40);
        demo.layoutMode = 'NONE';
        demo.cornerRadius = 4;
        demo.fills = [
          _paint(_bgColor, _V.bg),
          figma.variables.setBoundVariableForPaint(
            { type: 'SOLID', color: scrimRGB, opacity: scrimAlpha },
            'color',
            scrimVar
          ),
        ];
        const demoCell = _f('Visual', 'HORIZONTAL');
        demoCell.paddingTop = 8; demoCell.paddingBottom = 8;
        demoCell.paddingLeft = 12; demoCell.paddingRight = 12;
        demoCell.primaryAxisAlignItems = 'CENTER';
        demoCell.counterAxisAlignItems = 'CENTER';
        demoCell.appendChild(demo);
        row.appendChild(demoCell);
        demoCell.layoutSizingHorizontal = 'FIXED';
        demoCell.resize(96, 1);
        demoCell.layoutSizingVertical   = 'FILL';

        const opacityCell = _metaCell(`${Math.round(scrimAlpha * 100)}%`);
        row.appendChild(opacityCell);
        opacityCell.layoutSizingHorizontal = 'FIXED';
        opacityCell.resize(96, 1);
        opacityCell.layoutSizingVertical   = 'FILL';

        _addRow(row, _scrimTable);
        _addTableDivider(_scrimTable);
      }
    }

    _appendFill(_scrimTable, _scrimFrame);
    _placeShowcaseSection('Scrims', _scrimFrame, _myScrimsX);
  }

  // ── Finale ───────────────────────────────────────────────────────────────────

  const _showcaseNodes = _page.children
    .filter(n => n.name.startsWith('Token Showcase'));

  const _builtSections = _showcaseNodes.map(n => n.name.replace('Token Showcase — ', ''));

  if (_showcaseNodes.length) {
    figma.viewport.scrollAndZoomIntoView(_showcaseNodes);
  }

  return {
    sections: _builtSections,
    layout: 'horizontal, 100px gap between Figma sections',
  };
}
