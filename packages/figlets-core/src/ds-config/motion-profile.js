'use strict';

const MODES = ['Default', 'Reduced Motion'];
const EASINGS = new Set(['EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT', 'LINEAR', 'EASE_IN_BACK', 'EASE_OUT_BACK', 'EASE_IN_AND_OUT_BACK', 'CUSTOM_CUBIC_BEZIER', 'GENTLE', 'QUICK', 'BOUNCY', 'SLOW', 'CUSTOM_SPRING', 'HOLD']);

function normalizeMotionEasing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = String(value.type || '').toUpperCase();
  if (!EASINGS.has(type)) return null;
  if (type === 'CUSTOM_CUBIC_BEZIER') {
    const curve = value.easingFunctionCubicBezier;
    if (!curve || typeof curve !== 'object' || Array.isArray(curve)) return null;
    const result = {};
    for (const key of ['x1', 'y1', 'x2', 'y2']) {
      const number = Number(curve[key]);
      if (!Number.isFinite(number)) return null;
      result[key] = number;
    }
    if (result.x1 < 0 || result.x1 > 1 || result.x2 < 0 || result.x2 > 1) return null;
    return { type, easingFunctionCubicBezier: result };
  }
  if (type === 'CUSTOM_SPRING') {
    const bounce = value.easingFunctionSpring && Number(value.easingFunctionSpring.bounce);
    if (!Number.isFinite(bounce) || bounce < 0 || bounce > 1) return null;
    return { type, easingFunctionSpring: { bounce } };
  }
  return { type };
}

function motionCollectionName(collections = {}, snapshotCollections = []) {
  if (collections.motion) return String(collections.motion);
  const liveNames = snapshotCollections.map(collection => collection && collection.name).filter(Boolean);
  const existingMotion = liveNames.filter(name => /^(?:\d+\.\s*)?Motion$/i.test(name));
  if (existingMotion.length > 1) throw new Error('Multiple motion collections exist. Choose the exact motion_collection name.');
  if (existingMotion.length === 1) return existingMotion[0];
  const names = [...Object.values(collections), ...liveNames];
  if (!names.length) return '6. Motion';
  const numbered = names.map(name => /^(\d+)\.\s+/.exec(String(name))).filter(Boolean);
  return numbered.length ? `${Math.max(...numbered.map(match => Number(match[1]))) + 1}. Motion` : 'Motion';
}

function defaultMotionProfile() {
  const durations = {};
  for (const [name, value] of Object.entries({ instant: 0, fast: 100, standard: 200, slow: 300 })) durations[`motion/duration/${name}`] = { Default: value, 'Reduced Motion': 0 };
  const curves = {
    linear: { type: 'LINEAR' },
    standard: { type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: 0.2, y1: 0, x2: 0, y2: 1 } },
    enter: { type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: 0, y1: 0, x2: 0.2, y2: 1 } },
    exit: { type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: 0.4, y1: 0, x2: 1, y2: 1 } },
  };
  const easings = {};
  for (const [name, curve] of Object.entries(curves)) easings[`motion/easing/${name}`] = { Default: curve, 'Reduced Motion': { type: 'LINEAR' } };
  return { modes: MODES.slice(), durations, easings };
}

function normalizeMotionProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { errors: ['Motion profile must be an object.'], profile: null };
  if (!Array.isArray(profile.modes) || profile.modes.length !== 2 || !MODES.every(mode => profile.modes.includes(mode))) errors.push('Motion modes must include exactly Default and Reduced Motion. A missing second mode cannot be silently omitted.');
  const normalized = { modes: MODES.slice(), durations: {}, easings: {} };
  for (const [group, prefix] of [['durations', 'motion/duration/'], ['easings', 'motion/easing/']]) {
    const entries = profile[group] || {};
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) { errors.push(`${group} must be a token-name map.`); continue; }
    for (const name of Object.keys(entries).sort()) {
      if (!name.startsWith(prefix) || name.length === prefix.length) { errors.push(`Invalid ${group} token name: ${name}.`); continue; }
      const values = entries[name];
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== 2 || !MODES.every(mode => Object.hasOwn(values, mode))) { errors.push(`${name} requires named Default and Reduced Motion values.`); continue; }
      normalized[group][name] = {};
      for (const mode of MODES) {
        const raw = values[mode];
        const value = group === 'durations' ? raw : normalizeMotionEasing(raw);
        if (group === 'durations' ? (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isFinite(Math.fround(value / 1000))) : !value) errors.push(`Invalid ${group === 'durations' ? 'millisecond duration' : 'easing'} for ${name} in ${mode}.`);
        else normalized[group][name][mode] = value;
      }
    }
  }
  if (!Object.keys(normalized.durations).length && !Object.keys(normalized.easings).length) errors.push('Motion profile must contain at least one duration or easing token.');
  return { errors, profile: errors.length ? null : normalized };
}

function motionProfilePreview(ds) {
  if (!ds.motion) return null;
  const result = normalizeMotionProfile(ds.motion);
  if (result.errors.length) throw new Error(result.errors.join(' '));
  const collection = motionCollectionName(ds.collections);
  if (Object.entries(ds.collections || {}).some(([role, name]) => role !== 'motion' && name === collection)) throw new Error('Motion must use a separate collection from other configured foundations.');
  const tokens = [];
  for (const [group, type] of [['durations', 'TIMING'], ['easings', 'EASING']]) {
    for (const [name, values] of Object.entries(result.profile[group])) tokens.push({ name, type, unit: type === 'TIMING' ? 'ms' : undefined, values });
  }
  return { collection, modes: result.profile.modes, profile: result.profile, tokens, accessibilityNote: 'Reduced-motion variables do not prove runtime accessibility. Implementations must respect user motion preferences.' };
}

function motionProfileStatus(motion, snapshot) {
  const errors = [];
  const collections = (snapshot.collections || []).filter(item => item.name === motion.collection);
  if (collections.length !== 1) return { complete: false, errors: ['Expected one configured motion collection.'] };
  const collection = collections[0];
  const variables = snapshot.variables || [];
  function native(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.fround(value) : null;
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, native(value[key])]));
    return value;
  }
  for (const token of motion.tokens) {
    const matches = variables.filter(item => item.name === token.name);
    const variable = matches[0];
    if (matches.length !== 1 || variable.variableCollectionId !== collection.id || variable.resolvedType !== token.type) {
      errors.push('Missing or conflicting motion token: ' + token.name);
      continue;
    }
    for (const name of motion.modes) {
      const mode = collection.modes.find(item => item.name === name);
      const actual = mode && variable.valuesByMode && variable.valuesByMode[mode.modeId];
      const expected = token.values[name];
      const a = token.type === 'EASING' ? normalizeMotionEasing(actual) : actual;
      const b = token.type === 'EASING' ? normalizeMotionEasing(expected) : expected / 1000;
      if (!mode || a == null || JSON.stringify(native(a)) !== JSON.stringify(native(b))) errors.push(token.name + ' does not match the approved value in ' + name + '.');
    }
  }
  return { complete: errors.length === 0, errors, collectionId: collection.id, tokenCount: motion.tokens.length };
}

module.exports = { defaultMotionProfile, normalizeMotionProfile, normalizeMotionEasing, motionCollectionName, motionProfilePreview, motionProfileStatus };
