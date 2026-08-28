import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../pipeline.js';

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

export function loadApplyConfig({
  profilePath = process.env.APPLY_PROFILE_PATH || './config/candidate-profile.json',
  settingsPath = process.env.APPLY_SETTINGS_PATH || './config/apply-settings.json',
} = {}) {
  const resolvedProfilePath = resolveFromRoot(profilePath);
  const resolvedSettingsPath = resolveFromRoot(settingsPath);
  const profile = readJson(resolvedProfilePath, 'Candidate profile');
  const settings = readJson(resolvedSettingsPath, 'Apply settings');

  for (const key of ['firstName', 'lastName', 'email', 'phone']) {
    if (typeof profile.personal?.[key] !== 'string' || !profile.personal[key].trim()) {
      throw new Error(`Candidate profile is missing personal.${key}`);
    }
  }
  if (!Array.isArray(profile.answers)) profile.answers = [];

  return { profile, settings, resolvedProfilePath, resolvedSettingsPath };
}

