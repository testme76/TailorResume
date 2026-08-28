import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../pipeline.js';

function safeName(value) {
  return String(value || 'application')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'application';
}

export class ApplicationAudit {
  constructor(settings = {}) {
    this.historyPath = path.resolve(
      ROOT,
      settings.audit?.historyPath || './data/application-history.jsonl'
    );
    this.screenshotDirectory = path.resolve(
      ROOT,
      settings.audit?.screenshotDirectory || './output/application-audit'
    );
    fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
    fs.mkdirSync(this.screenshotDirectory, { recursive: true });
  }

  append(record) {
    const value = { timestamp: new Date().toISOString(), ...record };
    fs.appendFileSync(this.historyPath, `${JSON.stringify(value)}\n`, 'utf8');
    return value;
  }

  async screenshot(page, label) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(this.screenshotDirectory, `${timestamp}_${safeName(label)}.png`);
    await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});
    return filePath;
  }
}

