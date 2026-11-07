'use strict';

const COLOR_SCALES = {
  '50-950': [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
  '100-900': [100, 200, 300, 400, 500, 600, 700, 800, 900],
  '0-1000': [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
  '0-100': [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
};

function resolveColorScale(color = {}) {
  const key = String(color.scale || '50-950').trim().replace(/[\u2013\u2014]/g, '-').replace(/\s+to\s+/gi, '-').replace(/\s+/g, '');
  if (!COLOR_SCALES[key] && !Array.isArray(color.steps)) throw new Error('Unsupported color scale ' + key + '. Choose ' + Object.keys(COLOR_SCALES).join(', ') + ' or provide explicit steps.');
  const steps = (Array.isArray(color.steps) ? color.steps : COLOR_SCALES[key]).slice();
  if (steps.length < 2 || steps.some((step, i) => !Number.isFinite(step) || step < 0 || (i && step <= steps[i - 1]))) throw new Error('Color steps must contain at least two increasing nonnegative numbers.');
  if (COLOR_SCALES[key] && (steps[0] < COLOR_SCALES[key][0] || steps.at(-1) > COLOR_SCALES[key].at(-1))) throw new Error('Explicit color steps conflict with the selected ' + key + ' scale.');
  return { key, steps };
}

function nearestColorStep(steps, target) {
  return steps.reduce((best, step) => Math.abs(step - target) < Math.abs(best - target) ? step : best);
}

// Templates describe relative tones on the original 50-950 scale. Only those
// templates are translated; existing explicit semantic references stay literal.
function canonicalColorStep(steps, step) {
  const target = steps.at(-1) <= 100
    ? steps[0] + Math.max(0, Math.min(1, (step - 50) / 900)) * (steps.at(-1) - steps[0])
    : step;
  return nearestColorStep(steps, target);
}

function findBrandAnchor(brand, ramps, anchors = []) {
  if (!brand || !/^#[\da-f]{6}$/i.test(brand.hex || '')) return null;
  const ramp = (ramps || []).find(item => item.folder === 'color/' + brand.name);
  if (!ramp) return null;
  const rgb = [1, 3, 5].map(index => parseInt(brand.hex.slice(index, index + 2), 16));
  const matches = ramp.steps.filter(row => rgb.every((channel, i) => Math.abs(row[i + 1] * 255 - channel) < .0001));
  const recorded = anchors.find(item => item && item.name === brand.name && typeof item.hex === 'string' && item.hex.toUpperCase() === brand.hex.toUpperCase());
  const step = brand.step == null ? recorded && recorded.step : brand.step;
  const row = matches.find(item => item[0] === step) || matches[0];
  return row ? { name: brand.name, hex: brand.hex, step: row[0], path: ramp.folder + '/' + row[0] } : null;
}

module.exports = { COLOR_SCALES, resolveColorScale, nearestColorStep, canonicalColorStep, findBrandAnchor };
