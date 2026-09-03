import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { bestFrame, isNoiseFrame } from '../extension/frame-selection.js';

test('Chrome extension is limited to job capture and resume tailoring', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  const source = [
    fs.readFileSync('extension/background.js', 'utf8'),
    fs.readFileSync('extension/sidepanel.js', 'utf8'),
    fs.readFileSync('extension/sidepanel.html', 'utf8'),
    fs.readFileSync('extension/frame-selection.js', 'utf8'),
  ].join('\n');

  assert.equal(manifest.name, 'TailorResume');
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.ok(manifest.permissions.includes('storage'));
  assert.doesNotMatch(source, /autofill|applied|attachDebugger|\.submit\s*\(/i);
  assert.doesNotMatch(source, /inspectButton\.disabled\s*=\s*status/);
  assert.match(source, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(source, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(source, /boundSnapshot:/);
  assert.match(source, /\/api\/company-interest/);
  assert.match(source, /chrome\.tabs\.onCreated\.addListener/);
});

test('frame selection ignores a huge Twitter widget and keeps the real Jobvite posting', () => {
  const twitter = {
    url: 'https://platform.twitter.com/widgets/widget_iframe.html',
    title: 'Twitter Widget Iframe',
    heading: '',
    body: `!function(){${'minifiedJavaScript'.repeat(20000)}}`,
    selected: '',
  };
  const job = {
    url: 'https://jobs.jobvite.com/example/job/123',
    title: 'Example Careers - Junior Algorithm Developer',
    heading: 'Junior Algorithm Developer',
    body: 'Description\nRole and Responsibilities\nBuild software.\nEducation and Experience\nBachelor degree required.',
    selected: '',
  };

  assert.equal(isNoiseFrame(twitter), true);
  assert.equal(bestFrame([{ result: job }, { result: twitter }]), job);
});
