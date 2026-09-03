import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../pipeline.js';
import { buildJobKey, canonicalizeJobUrl } from './store.js';

const DEFAULT_FILE = path.join(ROOT, 'data', 'job-status.json');
const NOISE_ROLE = /(?:twitter|facebook|linkedin)\s+widget|widget\s+iframe/i;
const SCRIPT_BODY = /^(?:!function\s*\(|\(function\s*\(|webpackJsonp|var\s+webpack)/i;

function cleanLabel(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

export function isUsableInspection({ role, jd } = {}) {
  const normalizedRole = String(role || '').trim();
  const normalizedJd = String(jd || '').trim();
  if (normalizedJd.length < 40) return false;
  if (NOISE_ROLE.test(normalizedRole)) return false;
  if (SCRIPT_BODY.test(normalizedJd.slice(0, 200))) return false;
  return true;
}

export class JobStatusStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  readAll() {
    if (!fs.existsSync(this.filePath)) return {};
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  writeAll(records) {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  get(url) {
    const canonicalUrl = canonicalizeJobUrl(url);
    const jobKey = buildJobKey(canonicalUrl);
    const stored = this.readAll()[jobKey];
    if (stored && isUsableInspection(stored)) {
      return {
        ...stored,
        status: stored.status === 'new' ? 'new' : 'inspected',
        inspectedAt: stored.inspectedAt
          || stored.firstViewedAt
          || null,
      };
    }
    return {
      jobKey,
      url: canonicalUrl,
      status: 'new',
      inspectedAt: null,
    };
  }

  markInspected({ url, company, role, jd, at = new Date().toISOString() }) {
    const records = this.readAll();
    const current = this.get(url);
    const value = {
      jobKey: current.jobKey,
      url: current.url,
      company: cleanLabel(company, current.company),
      role: cleanLabel(role, current.role),
      jd: cleanLabel(jd, current.jd),
      status: 'inspected',
      inspectedAt: current.inspectedAt || at,
    };
    records[value.jobKey] = value;
    this.writeAll(records);
    return value;
  }

  update({ url, status, company, role, jd }) {
    if (status === 'inspected') return this.markInspected({ url, company, role, jd });
    throw new Error('Job status must be inspected.');
  }
}
