import assert from 'node:assert/strict';
import test from 'node:test';

import { generateTailoredContent, parseJsonResponse, validate } from '../src/openai.js';

test('parseJsonResponse parses valid structured output', () => {
  assert.deepEqual(parseJsonResponse('{"SUMMARY":"Focused"}'), { SUMMARY: 'Focused' });
});

test('validate reports missing and over-limit fields', () => {
  assert.deepEqual(validate({ SUMMARY: 'too long' }, { SUMMARY: 3, SKILLS: 10 }), {
    valid: false,
    missing: ['SKILLS'],
    overLimit: [{ token: 'SUMMARY', limit: 3, length: 8, value: 'too long' }],
  });
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
  assert.equal(requests[1].previous_response_id, 'resp_1');
  assert.deepEqual(requests[1].text.format.schema.required, ['SUMMARY']);
});
