import assert from 'node:assert/strict';
import test from 'node:test';

import { detectAdapter } from '../src/apply/ats/index.js';
import { answerValues, findAnswerRule, normalizeText } from '../src/apply/forms/answers.js';
import { parseQueueText } from '../src/apply/queue.js';

test('detectAdapter recognizes supported ATS job URLs', () => {
  assert.equal(
    detectAdapter('https://jobs.smartrecruiters.com/AECOM2/744000-job')?.id,
    'smartrecruiters'
  );
  assert.equal(
    detectAdapter('https://jobs.workable.com/view/id/software-developer')?.id,
    'workable'
  );
  assert.equal(detectAdapter('https://example.com/jobs/1'), null);
});

test('answer rules match normalized question text deterministically', () => {
  const rules = [
    { match: 'Require sponsorship?', value: 'No' },
    { match: 'Ethnicity / Race', value: ['Decline to self-identify'] },
  ];
  assert.equal(normalizeText('  Ethnicity/Race* '), 'ethnicity race');
  assert.equal(findAnswerRule(rules, 'Will you now or later Require Sponsorship?'), rules[0]);
  assert.deepEqual(answerValues(rules[1]), ['Decline to self-identify']);
});

test('parseQueueText accepts URLs and JSON Lines while removing duplicates', () => {
  const jobs = parseQueueText([
    '# selected jobs',
    'https://jobs.workable.com/view/abc/role',
    '{"url":"https://jobs.smartrecruiters.com/Acme/123-role","note":"priority"}',
    'https://jobs.workable.com/view/abc/role',
  ].join('\n'));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].note, 'priority');
});

test('parseQueueText rejects malformed job URLs', () => {
  assert.throws(() => parseQueueText('not a url'), /Invalid job URL/);
});

