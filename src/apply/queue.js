import fs from 'node:fs';
import path from 'node:path';

export function parseQueueText(text) {
  const seen = new Set();
  const jobs = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let item;
    try {
      item = line.startsWith('{') ? JSON.parse(line) : { url: line };
    } catch (error) {
      throw new Error(`Invalid queue line: ${line} (${error.message})`);
    }
    let url;
    try {
      url = new URL(item.url).toString();
    } catch {
      throw new Error(`Invalid job URL in queue: ${item.url}`);
    }
    if (seen.has(url)) continue;
    seen.add(url);
    jobs.push({ ...item, url });
  }
  return jobs;
}

export function loadQueue(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`Queue file not found: ${resolved}`);
  return parseQueueText(fs.readFileSync(resolved, 'utf8'));
}

