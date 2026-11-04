'use strict';

const SPRINGS = new Set(['GENTLE', 'QUICK', 'BOUNCY', 'SLOW', 'CUSTOM_SPRING']);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function configSignature(ds) {
  const value = clone(ds || {});
  delete value.source;
  delete value.primitives;
  if (value.figlets) {
    delete value.figlets.variableData;
    delete value.figlets.variableDataConfigSignature;
    if (!Object.keys(value.figlets).length) delete value.figlets;
  }
  function ordered(item) {
    if (Array.isArray(item)) return item.map(ordered);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])]));
  }
  return JSON.stringify(ordered(value));
}
function archivedSnapshot(ds) {
  return ds && ds.figlets && ds.figlets.variableDataConfigSignature === configSignature(ds) ? ds.figlets.variableData : null;
}
function number(value) {
  if (Math.fround(value) === value && Number.isFinite(value)) {
    for (let precision = 1; precision <= 9; precision++) {
      const candidate = Number(value.toPrecision(precision));
      if (Math.fround(candidate) === value) return String(candidate);
    }
  }
  return String(value);
}
const milliseconds = seconds => number(Number(number(seconds)) * 1000);

function easingCss(value) {
  if (!value || SPRINGS.has(value.type)) return null;
  if (value.type === 'LINEAR') return 'linear';
  const curve = value.easingFunctionCubicBezier;
  if (curve && ['x1', 'y1', 'x2', 'y2'].every(key => Number.isFinite(curve[key])) && curve.x1 >= 0 && curve.x1 <= 1 && curve.x2 >= 0 && curve.x2 <= 1) return `cubic-bezier(${['x1', 'y1', 'x2', 'y2'].map(key => number(curve[key])).join(', ')})`;
  return ({ EASE_IN: 'ease-in', EASE_OUT: 'ease-out', EASE_IN_AND_OUT: 'ease-in-out' })[value.type] || null;
}

function isOpacity(variable) {
  return variable && variable.resolvedType === 'FLOAT' && (/^opacity\//.test(variable.name || '') || (variable.scopes || []).some(scope => scope === 'OPACITY' || scope === 'COLOR_OPACITY'));
}

function describeValue(type, value, variable) {
  if (value === undefined || value === null) return 'Unresolved';
  if (type === 'TIMING') return `${milliseconds(value)} ms`;
  if (type === 'EASING') {
    if (SPRINGS.has(value.type)) return `${value.type}${value.easingFunctionSpring ? ` (bounce ${number(value.easingFunctionSpring.bounce)})` : ''}; no portable CSS easing`;
    return easingCss(value) || `${value.type || 'Unknown easing'}; no portable CSS easing`;
  }
  if (type === 'FLOAT') return number(value) + (isOpacity(variable) ? '%' : '');
  if (type === 'COLOR') return cssValue(value, 'COLOR') || 'Unresolved';
  return String(value);
}

function cssValue(value, type, variable) {
  if (value === null || value === undefined) return null;
  if (type === 'TIMING') return Number.isFinite(value) && value >= 0 ? `${milliseconds(value)}ms` : null;
  if (type === 'EASING') return easingCss(value);
  if (type === 'FLOAT') return Number.isFinite(value) ? number(value) + (isOpacity(variable) ? '%' : '') : null;
  if (type === 'STRING') return typeof value === 'string' ? JSON.stringify(value) : null;
  if (type === 'BOOLEAN') return typeof value === 'boolean' ? String(value) : null;
  if (type !== 'COLOR' || !value || !['r', 'g', 'b'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1)) return null;
  const alpha = value.a === undefined ? 1 : value.a;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  const channels = ['r', 'g', 'b'].map(key => Math.round(value[key] * 255));
  if (alpha === 1) return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `rgba(${channels.join(', ')}, ${number(alpha)})`;
}

function createVariableResolver(figmaData = {}) {
  const variables = new Map((figmaData.variables || []).filter(Boolean).map(variable => [variable.id, variable]));
  const collections = figmaData.collections || [];
  function collectionFor(variable) {
    return collections.find(collection => collection.id === variable.variableCollectionId) || collections.find(collection => (collection.variableIds || []).includes(variable.id));
  }
  function targetMode(variable, name) {
    const collection = collectionFor(variable);
    const modes = collection && collection.modes || [];
    const named = modes.find(mode => String(mode.name).toLowerCase() === String(name).toLowerCase());
    return named && Object.hasOwn(variable.valuesByMode || {}, named.modeId) ? named.modeId
      : collection && collection.defaultModeId && Object.hasOwn(variable.valuesByMode || {}, collection.defaultModeId) ? collection.defaultModeId
        : modes.find(mode => Object.hasOwn(variable.valuesByMode || {}, mode.modeId))?.modeId || Object.keys(variable.valuesByMode || {})[0];
  }
  function resolve(variable, modeId, modeName, seen = new Set(), references = [], path = []) {
    if (!variable || !modeId) return { error: 'missing-variable-or-mode', references };
    const key = `${variable.id}:${modeId}`;
    if (seen.has(key)) return { error: 'cyclic-variable-alias', references };
    const nextSeen = new Set(seen); nextSeen.add(key);
    function channel(value, type, channelPath) {
      if (value && value.type === 'VARIABLE_ALIAS') {
        const target = variables.get(value.id);
        if (!target || target.resolvedType !== type) return { error: 'missing-or-wrong-type-alias', references };
        const targetModeId = targetMode(target, modeName);
        references.push({ path: channelPath, id: target.id, name: target.name, type, modeId: targetModeId });
        return resolve(target, targetModeId, modeName, nextSeen, references, channelPath);
      }
      if (type === 'COLOR' && value && Object.hasOwn(value, 'color') && Object.hasOwn(value, 'opacity')) {
        const color = channel(value.color, 'COLOR', channelPath.concat('color'));
        const opacity = channel(value.opacity, 'FLOAT', channelPath.concat('opacity'));
        if (color.error || opacity.error) return { error: color.error || opacity.error, references };
        if (!color.value || !['r', 'g', 'b'].every(key => Number.isFinite(color.value[key])) || !Number.isFinite(opacity.value) || opacity.value < 0 || opacity.value > 100) return { error: 'invalid-composed-color', references };
        return { value: { r: color.value.r, g: color.value.g, b: color.value.b, a: opacity.value / 100 }, references };
      }
      return { value: clone(value), references };
    }
    return channel((variable.valuesByMode || {})[modeId], variable.resolvedType, path);
  }
  return { resolve, collectionFor, targetMode, variables };
}

function variableSnapshot(figmaData = {}) {
  const resolver = createVariableResolver(figmaData);
  const presentation = [];
  for (const variable of figmaData.variables || []) {
    const collection = resolver.collectionFor(variable);
    for (const [modeId, rawValue] of Object.entries(variable.valuesByMode || {})) {
      const modeName = collection && (collection.modes || []).find(mode => mode.modeId === modeId)?.name || modeId;
      const resolved = resolver.resolve(variable, modeId, modeName);
      presentation.push({ variableId: variable.id, name: variable.name, type: variable.resolvedType, collectionId: collection?.id, modeId, modeName, rawValue: clone(rawValue), resolvedValue: resolved.value, references: resolved.references, display: resolved.error ? 'Unresolved' : describeValue(variable.resolvedType, resolved.value, variable), error: resolved.error });
    }
  }
  return { schemaVersion: 1, fileKey: figmaData.fileKey, fileName: figmaData.fileName, capabilities: clone(figmaData.capabilities), collections: clone(figmaData.collections || []), variables: clone(figmaData.variables || []), presentation };
}

module.exports = { createVariableResolver, cssValue, describeValue, easingCss, isOpacity, variableSnapshot, configSignature, archivedSnapshot };
