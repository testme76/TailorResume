import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ApplicationStore, buildJobKey, canonicalizeJobUrl } from '../src/applications/store.js';
import { buildProfileSnapshot, createApplicationSnapshot } from '../src/applications/snapshot.js';

test('canonicalizeJobUrl removes tracking parameters before building a stable key', () => {
  const clean = canonicalizeJobUrl('https://example.com/job/1?utm_source=x&department=eng#apply');
  assert.equal(clean, 'https://example.com/job/1?department=eng');
  assert.equal(
    buildJobKey(clean),
    buildJobKey('https://example.com/job/1?department=eng&utm_campaign=y')
  );
});

test('ApplicationStore restores the latest snapshot for a job URL', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-restore-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ApplicationStore(directory);
  const url = 'https://jobs.example.com/role/1?department=engineering';

  const first = store.save({ url, job: { company: 'Example', role: 'Engineer' } });
  const second = store.save({ url, job: { company: 'Example', role: 'Senior Engineer' } });

  assert.equal(store.latest(`${url}&utm_source=email`).applicationId, second.applicationId);
  assert.equal(store.latest(url).version, 2);
  assert.notEqual(first.applicationId, second.applicationId);
  assert.equal(store.latest('https://jobs.example.com/role/unknown'), null);
});

test('buildProfileSnapshot binds tailored bullets to their stable role metadata', () => {
  const profile = {
    personal: { firstName: 'Ada' },
    experience: [
      { section: 'Role 1', company: 'Example', title: 'Engineer' },
      { section: 'Role 2', company: 'Other', title: 'Developer' },
    ],
    answers: [{ match: 'salary expectations', valueFrom: 'job.salaryHighEnd' }],
  };
  const snapshot = buildProfileSnapshot(profile, {
    SUMMARY: 'Backend engineer',
    ROLE1_BULLET2: 'Second relevant result',
    ROLE1_BULLET1: 'First relevant result',
    ROLE2_BULLET1: 'Other result',
    SKILLS: 'Languages: JavaScript',
  }, { jd: 'Salary range: $100,000-$130,000/year' });

  assert.deepEqual(snapshot.experience[0].bullets, [
    'First relevant result',
    'Second relevant result',
  ]);
  assert.deepEqual(snapshot.experience[1].bullets, ['Other result']);
  assert.deepEqual(snapshot.answers[0].values, ['$130,000/year']);
});

test('createApplicationSnapshot saves immutable per-job versions', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-snapshots-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const profilePath = path.join(directory, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify({
    personal: { firstName: 'Ada' },
    experience: [{ section: 'Role 1', company: 'Example', title: 'Engineer' }],
    answers: [],
  }));
  const store = new ApplicationStore(path.join(directory, 'applications'));
  const tailor = async () => ({
    tokenValues: { SUMMARY: 'Summary', ROLE1_BULLET1: 'Bound bullet', SKILLS: 'Skills' },
  });
  const publish = async () => ({
    pdfFilename: 'resume.pdf', pdfPath: 'C:/resume.pdf', documentId: 'doc', docLink: 'https://doc',
  });
  const input = {
    url: 'https://jobs.example.com/1?utm_source=test',
    jd: 'A complete job description that is comfortably longer than forty characters.',
    company: 'Example',
    role: 'Engineer',
    profilePath,
    store,
    tailor,
    publish,
  };

  const first = await createApplicationSnapshot(input);
  const second = await createApplicationSnapshot(input);
  assert.match(first.applicationId, /-v1$/);
  assert.match(second.applicationId, /-v2$/);
  assert.equal(store.get(first.applicationId).profile.experience[0].bullets[0], 'Bound bullet');
  assert.equal(first.resume.url, '/output/resume.pdf');
});

test('createApplicationSnapshot rejects configured citizenship requirements before tailoring', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const profilePath = path.join(directory, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify({
    personal: {}, answers: [], skipIfUsCitizenshipRequired: true,
  }));
  let tailorCalled = false;
  await assert.rejects(
    createApplicationSnapshot({
      url: 'https://jobs.example.com/citizen-only',
      jd: 'Due to the nature of this work, U.S. citizenship is required for every applicant.',
      company: 'Example',
      role: 'Engineer',
      profilePath,
      store: new ApplicationStore(path.join(directory, 'applications')),
      tailor: async () => {
        tailorCalled = true;
        return { tokenValues: {} };
      },
      publish: async () => ({}),
    }),
    /Skipped: job requires U\.S\. citizenship/
  );
  assert.equal(tailorCalled, false);
});
