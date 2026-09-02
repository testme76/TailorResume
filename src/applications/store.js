import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../pipeline.js';

const DEFAULT_DIRECTORY = path.join(ROOT, 'data', 'applications');

export function canonicalizeJobUrl(value) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref|referrer|source|trk|tracking)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function buildJobKey(url) {
  return crypto.createHash('sha256').update(canonicalizeJobUrl(url)).digest('hex').slice(0, 16);
}

export class ApplicationStore {
  constructor(directory = DEFAULT_DIRECTORY) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
  }

  listVersions(url) {
    const jobKey = buildJobKey(url);
    return fs.readdirSync(this.directory)
      .map((name) => name.match(new RegExp(`^${jobKey}-v(\\d+)\\.json$`)))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
  }

  save(snapshot) {
    const canonicalUrl = canonicalizeJobUrl(snapshot.url);
    const jobKey = buildJobKey(canonicalUrl);
    const versions = this.listVersions(canonicalUrl);
    const version = (versions.at(-1) || 0) + 1;
    const applicationId = `${jobKey}-v${version}`;
    const value = {
      ...snapshot,
      applicationId,
      jobKey,
      version,
      url: canonicalUrl,
      createdAt: new Date().toISOString(),
    };
    const destination = path.join(this.directory, `${applicationId}.json`);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, destination);
    return value;
  }

  get(applicationId) {
    if (!/^[a-f0-9]{16}-v\d+$/.test(applicationId)) return null;
    const filePath = path.join(this.directory, `${applicationId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  latest(url) {
    const versions = this.listVersions(url);
    const version = versions.at(-1);
    return version ? this.get(`${buildJobKey(url)}-v${version}`) : null;
  }
}
