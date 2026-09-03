import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isUsableInspection, JobStatusStore } from '../src/applications/status-store.js';

test('JobStatusStore recognizes tracking variants and keeps one inspection', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-job-status-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'job-status.json');
  const store = new JobStatusStore(filePath);
  const url = 'https://jobs.example.com/engineer?department=software&utm_source=email';

  assert.equal(store.get(url).status, 'new');
  const first = store.markInspected({
    url,
    company: 'Example',
    role: 'Engineer',
    jd: 'A complete job description that is comfortably longer than forty characters.',
    at: '2026-09-01T10:00:00.000Z',
  });
  assert.equal(first.status, 'inspected');

  const duplicate = store.markInspected({
    url: 'https://jobs.example.com/engineer?utm_campaign=fall&department=software',
    at: '2026-09-02T10:00:00.000Z',
  });
  assert.equal(duplicate.jobKey, first.jobKey);
  assert.equal(duplicate.inspectedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(duplicate.company, 'Example');
  assert.match(duplicate.jd, /complete job description/);

  const restored = new JobStatusStore(filePath).get(url);
  assert.equal(restored.status, 'inspected');
  assert.equal(restored.role, 'Engineer');
});

test('JobStatusStore only accepts inspected status', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-job-status-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new JobStatusStore(path.join(directory, 'job-status.json'));

  assert.throws(
    () => store.update({ url: 'https://jobs.example.com/1', status: 'applied' }),
    /must be inspected/
  );
});

test('JobStatusStore ignores historical social-widget inspections', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-job-status-noise-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'job-status.json');
  const store = new JobStatusStore(filePath);
  const url = 'https://jobs.jobvite.com/example/job/123';

  store.markInspected({
    url,
    company: '',
    role: 'Twitter Widget Iframe',
    jd: `!function(){${'minifiedJavaScript'.repeat(100)}}`,
  });

  assert.equal(store.get(url).status, 'new');
  assert.equal(isUsableInspection({
    role: 'Junior Algorithm Developer',
    jd: 'Description: Build software and algorithms for mission requirements.',
  }), true);
});
