import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Chrome extension is limited to job capture and resume tailoring', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  const source = [
    fs.readFileSync('extension/background.js', 'utf8'),
    fs.readFileSync('extension/sidepanel.js', 'utf8'),
    fs.readFileSync('extension/sidepanel.html', 'utf8'),
  ].join('\n');

  assert.equal(manifest.name, 'TailorResume');
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.doesNotMatch(source, /autofill|applied|attachDebugger|\.submit\s*\(/i);
  assert.doesNotMatch(source, /inspectButton\.disabled\s*=\s*status/);
  assert.match(source, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(source, /chrome\.tabs\.onUpdated\.addListener/);
});
