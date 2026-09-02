import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractJobMetadata,
  generateCompanyInterest,
  generateTailoredContent,
  parseJsonResponse,
  validate,
} from '../src/openai.js';

test('generateCompanyInterest grounds a structured answer in the job and profile', async () => {
  let request;
  const client = {
    responses: {
      create: async (value) => {
        request = value;
        return { status: 'completed', output_text: '{"answer":"I am interested in Acme."}' };
      },
    },
  };
  const answer = await generateCompanyInterest(client, {
    job: { company: 'Acme', role: 'Engineer', jd: 'Build reliable distributed systems.' },
    profile: { summary: 'Backend engineer', skills: 'Go', experience: [] },
  });
  assert.equal(answer, 'I am interested in Acme.');
  assert.equal(request.text.format.name, 'company_interest');
  assert.match(request.instructions, /never invent company facts/i);
  assert.match(request.instructions, /plain, direct language and short sentences/i);
  assert.match(request.instructions, /I am particularly excited/);
  assert.match(request.instructions, /60 to 90 words/);
  assert.match(request.input, /Build reliable distributed systems/);
  assert.match(request.input, /Backend engineer/);
});

test('parseJsonResponse parses valid structured output', () => {
  assert.deepEqual(parseJsonResponse('{"SUMMARY":"Focused"}'), { SUMMARY: 'Focused' });
});

test('validate reports missing and over-limit fields', () => {
  assert.deepEqual(validate({ SUMMARY: 'too long' }, { SUMMARY: 3, SKILLS: 10 }), {
    valid: false,
    missing: ['SKILLS'],
    overLimit: [{ token: 'SUMMARY', limit: 3, length: 8, value: 'too long' }],
    underLimit: [],
  });
});

test('validate reports fields below configured minimum lengths', () => {
  assert.deepEqual(validate({ SUMMARY: 'short' }, { SUMMARY: 20 }, { SUMMARY: 10 }), {
    valid: false,
    missing: [],
    overLimit: [],
    underLimit: [
      { token: 'SUMMARY', minimum: 10, length: 5, value: 'short' },
    ],
  });
});

test('extractJobMetadata requests strict company and role JSON', async () => {
  let request;
  const client = {
    responses: {
      create: async (value) => {
        request = value;
        return { status: 'completed', output_text: '{"company":"Acme","role":"Engineer"}' };
      },
    },
  };

  const result = await extractJobMetadata(client, { jd: 'Acme is hiring an Engineer.' });
  assert.deepEqual(result, { company: 'Acme', role: 'Engineer' });
  assert.equal(request.reasoning.effort, 'low');
  assert.equal(request.text.format.type, 'json_schema');
  assert.deepEqual(request.text.format.schema.required, ['company', 'role']);
});

test('generateTailoredContent uses strict JSON output and retries long fields', async () => {
  const requests = [];
  const responses = [
    { id: 'resp_1', status: 'completed', output_text: '{"SUMMARY":"too long","SKILLS":"SQL"}' },
    { id: 'resp_2', status: 'completed', output_text: '{"SUMMARY":"fit"}' },
  ];
  const client = {
    responses: {
      create: async (request) => {
        requests.push(request);
        return responses.shift();
      },
    },
  };

  const result = await generateTailoredContent(client, {
    jd: 'Build products',
    bulletBank: { bullets: [] },
    tokenLimits: { SUMMARY: 3, SKILLS: 10 },
    company: 'Example',
    role: 'PM',
  });

  assert.deepEqual(result, { SUMMARY: 'fit', SKILLS: 'SQL' });
  assert.equal(requests[0].model, process.env.OPENAI_MODEL || 'gpt-5.6-sol');
  assert.equal(requests[0].text.format.type, 'json_schema');
  assert.equal(requests[0].text.format.strict, true);
  assert.deepEqual(requests[0].text.format.schema.required, ['SUMMARY', 'SKILLS']);
  assert.match(requests[0].instructions, /exactly four newline-separated lines/);
  assert.match(requests[0].instructions, /Frameworks & Runtime/);
  assert.match(requests[0].instructions, /never copy a skill from the job description/);
  assert.match(requests[0].instructions, /Treat bullet-bank variants as evidence notes/);
  assert.match(requests[0].instructions, /three to five exact or closely equivalent job-description terms/);
  assert.match(requests[0].instructions, /combine, split, and redistribute supported facts/);
  assert.match(requests[0].instructions, /Avoid reusing any six-word sequence/);
  assert.match(requests[0].instructions, /for infrastructure roles emphasize deployment, scalability, reliability/);
  assert.match(requests[0].instructions, /SUMMARY must name the target job family/);
  assert.match(requests[0].input, /write the target-role bullet first/);
  assert.match(requests[0].input, /change the narrative angle aggressively/);
  assert.match(requests[0].input, /deliberately written\s+for this exact vacancy/);
  assert.doesNotMatch(requests[0].input, /Prefer the longest relevant supplied variant/);
  assert.equal(requests[1].previous_response_id, 'resp_1');
  assert.deepEqual(requests[1].text.format.schema.required, ['SUMMARY']);
});

test('generateTailoredContent expands fields below their minimum length', async () => {
  const requests = [];
  const responses = [
    { id: 'resp_1', status: 'completed', output_text: '{"SUMMARY":"short"}' },
    { id: 'resp_2', status: 'completed', output_text: '{"SUMMARY":"long enough"}' },
  ];
  const client = {
    responses: {
      create: async (request) => {
        requests.push(request);
        return responses.shift();
      },
    },
  };

  const result = await generateTailoredContent(client, {
    jd: 'Build products',
    bulletBank: { bullets: [] },
    tokenLimits: { SUMMARY: 20 },
    tokenMinimums: { SUMMARY: 10 },
    company: 'Example',
    role: 'PM',
  });

  assert.deepEqual(result, { SUMMARY: 'long enough' });
  assert.match(requests[0].input, /"SUMMARY": 10-20 characters/);
  assert.match(requests[1].input, /EXPAND "SUMMARY" to at least 10 characters/);
  assert.equal(requests[1].previous_response_id, 'resp_1');
});
