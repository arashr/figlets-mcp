'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const core = require('../figlets-core.js').dsConfig;

function prepareMotionConfig(configPath, args) {
  let ds;
  try { ds = core.readDsConfig(configPath); } catch (error) { return { error: error.message }; }
  if (!args.motion_profile) return { error: 'Provide an explicit motion_profile proposal before saving motion configuration.' };
  const raw = args.motion_profile === 'default' ? core.defaultMotionProfile() : args.motion_profile;
  const normalized = core.normalizeMotionProfile(raw);
  if (normalized.errors.length) return { error: normalized.errors.join(' ') };
  let collection;
  try {
    const snapshotPath = path.join(path.dirname(configPath), 'figma-data.json');
    const snapshot = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : {};
    collection = args.motion_collection || core.motionCollectionName(ds.collections, snapshot.collections || []);
  } catch (error) { return { error: error.message }; }
  if (typeof collection !== 'string' || !collection.trim()) return { error: 'Motion collection name must be non-empty.' };
  if (Object.entries(ds.collections || {}).some(([role, name]) => role !== 'motion' && name === collection)) return { error: 'Motion must use a separate collection from other configured foundations.' };
  const candidate = { ...ds, collections: { ...ds.collections, motion: collection }, motion: normalized.profile };
  const preview = core.motionProfilePreview(candidate);
  const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(configPath)).update(JSON.stringify({ collection, profile: normalized.profile })).digest('hex');
  if (args.save_motion_profile) {
    if (args.motion_profile_fingerprint !== fingerprint) return { error: 'The motion proposal or config changed. Preview again and approve the fresh proposal before saving.' };
    core.writeDsConfig(configPath, candidate);
    return { phase: 'motion_config_saved', configPath, motion: preview, figmaChanged: false, nextInput: { config_path: configPath }, message: 'Saved only the approved motion profile and collection name to the local config. Run prepare_ds_config again, then review and separately approve the Figma motion plan.' };
  }
  return {
    phase: 'review_motion_profile', configPath, motion: preview, fingerprint, configChanged: false, figmaChanged: false,
    saveInput: { config_path: configPath, motion_profile: normalized.profile, motion_collection: collection, save_motion_profile: true, motion_profile_fingerprint: fingerprint },
    approvalRequired: true,
    message: 'Review or edit the exact collection, modes, token names, millisecond durations, and easing curves. Approve saving the local config first. Figma changes require a separate preview and approval.',
  };
}

module.exports = { prepareMotionConfig };
