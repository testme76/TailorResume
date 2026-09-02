import assert from 'node:assert/strict';
import test from 'node:test';

import { detectAdapter } from '../src/apply/ats/index.js';
import { answerValues, findAnswerRule, normalizeText } from '../src/apply/forms/answers.js';
import { parseQueueText } from '../src/apply/queue.js';
import { detectAccessRestrictionText } from '../src/apply/forms/dom.js';
import { findRequiredSkipQuestion } from '../src/apply/policies/questions.js';
import { extractSalaryHighEnd, resolveRuleValues } from '../src/apply/policies/salary.js';
import {
  findSecurityClearanceRequirement,
  findUsCitizenshipRequirement,
} from '../src/apply/policies/job.js';

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

test('extractSalaryHighEnd returns the top of a posted annual range', () => {
  assert.equal(
    extractSalaryHighEnd('Compensation: USD 65,000 - USD 80,000 - yearly'),
    '$80,000/year'
  );
  assert.equal(extractSalaryHighEnd('Salary range: $42.50-$55/hr'), '$55/hour');
  assert.equal(extractSalaryHighEnd('Compensation: $63,065.60/yr'), '$63,065.60/year');
});

test('resolveRuleValues can source salary from the job description', () => {
  assert.deepEqual(
    resolveRuleValues(
      { valueFrom: 'job.salaryHighEnd' },
      { job: { jd: 'Base pay range: $100k - $135k annually' } }
    ),
    ['$135,000/year']
  );
});

test('reference skip policy only matches required questions', () => {
  const fields = [
    { required: false, question: 'Professional references (optional)' },
    { required: true, question: 'Please provide three professional references' },
  ];
  assert.equal(
    findRequiredSkipQuestion(fields, ['professional references']),
    fields[1]
  );
  assert.equal(findRequiredSkipQuestion(fields.slice(0, 1), ['professional references']), null);
});

test('security-clearance policy detects requirements but ignores explicit negatives', () => {
  assert.equal(
    findSecurityClearanceRequirement('Candidates must be eligible to obtain a Secret security clearance.'),
    'Candidates must be eligible to obtain a Secret security clearance.'
  );
  assert.equal(
    findSecurityClearanceRequirement('Security clearance: None required for this role.'),
    null
  );
  assert.equal(findSecurityClearanceRequirement('Standard background check required.'), null);
});

test('citizenship policy skips citizen-only jobs but permits permanent residents', () => {
  assert.equal(
    findUsCitizenshipRequirement('Due to the nature of the work, U.S. Citizenship is required.'),
    'Due to the nature of the work, U.S. Citizenship is required.'
  );
  assert.equal(
    findUsCitizenshipRequirement('Applicants must be U.S. citizens or lawful permanent residents.'),
    null
  );
  assert.equal(
    findUsCitizenshipRequirement('U.S. citizenship is not required for this role.'),
    null
  );
});

test('SmartRecruiters temporary restriction text is recognized', () => {
  assert.equal(
    detectAccessRestrictionText('Your access is temporarily restricted. Please try again later.'),
    'access is temporarily restricted'
  );
  assert.equal(detectAccessRestrictionText('Continue to application'), null);
});
