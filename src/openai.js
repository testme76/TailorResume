// openai.js — calls the OpenAI Responses API and returns validated JSON.
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
const MAX_SHORTEN_ROUNDS = 3;

export function getClient(apiKey) {
  return new OpenAI({ apiKey });
}

function buildInstructions() {
  return [
    'You are a precise resume-writing assistant.',
    'Write concrete resume content grounded only in the supplied bullet bank.',
    'Quantify claims only when the source material supports them.',
    'Never invent employers, titles, numbers, or skills.',
    'Every value must be plain text with no Markdown, bullet characters, or line breaks.',
  ].join(' ');
}

function buildUserPrompt({ jd, bulletBank, tokenLimits, company, role }) {
  const tokenSpec = Object.entries(tokenLimits)
    .map(([token, limit]) => `- "${token}": at most ${limit} characters`)
    .join('\n');

  return [
    `Company: ${company}`,
    `Role: ${role}`,
    '',
    'Job description:',
    jd,
    '',
    'Bullet bank:',
    JSON.stringify(bulletBank, null, 2),
    '',
    'Tailor the resume to the job description. Fill every requested field using only',
    'facts grounded in the bullet bank. Prefer the shortest supplied variant that',
    'fits comfortably, and tighten wording instead of truncating a sentence.',
    '',
    'Character limits:',
    tokenSpec,
  ].join('\n');
}

function buildShortenPrompt(overLimit) {
  const lines = overLimit.map(
    ({ token, limit, length, value }) =>
      `- "${token}": limit ${limit}, current ${length}: "${value}"`
  );

  return [
    'Rewrite only the fields below so each fits its character limit.',
    'Preserve meaning and do not add facts that were absent from the original context.',
    ...lines,
  ].join('\n');
}

function buildJsonSchema(tokens) {
  return {
    type: 'object',
    properties: Object.fromEntries(tokens.map((token) => [token, { type: 'string' }])),
    required: tokens,
    additionalProperties: false,
  };
}

async function callOpenAI(client, { input, tokens, previousResponseId }) {
  const response = await client.responses.create({
    model: MODEL,
    instructions: buildInstructions(),
    input,
    previous_response_id: previousResponseId,
    max_output_tokens: 4096,
    reasoning: { effort: 'medium' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'resume_content',
        strict: true,
        schema: buildJsonSchema(tokens),
      },
    },
  });

  if (!response.output_text) {
    throw new Error(`OpenAI returned no text (response status: ${response.status}).`);
  }

  return { id: response.id, text: response.output_text };
}

/** Parse the JSON text returned by Structured Outputs. */
export function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`OpenAI did not return valid JSON: ${err.message}\n---\n${text}`);
  }
}

/** Validate all required tokens and report values over their character limit. */
export function validate(data, tokenLimits) {
  const requiredTokens = Object.keys(tokenLimits);
  const missing = requiredTokens.filter(
    (token) => typeof data[token] !== 'string' || data[token].length === 0
  );

  const overLimit = requiredTokens
    .filter((token) => typeof data[token] === 'string')
    .map((token) => ({
      token,
      limit: tokenLimits[token],
      length: data[token].length,
      value: data[token],
    }))
    .filter(({ limit, length }) => length > limit);

  return { valid: missing.length === 0 && overLimit.length === 0, missing, overLimit };
}

/** Generate every resume token and retry any values that exceed their limits. */
export async function generateTailoredContent(
  client,
  { jd, bulletBank, tokenLimits, company, role }
) {
  let response = await callOpenAI(client, {
    input: buildUserPrompt({ jd, bulletBank, tokenLimits, company, role }),
    tokens: Object.keys(tokenLimits),
  });
  let data = parseJsonResponse(response.text);
  let result = validate(data, tokenLimits);

  if (result.missing.length > 0) {
    throw new Error(`OpenAI JSON is missing required token(s): ${result.missing.join(', ')}`);
  }

  let round = 0;
  while (!result.valid && round < MAX_SHORTEN_ROUNDS) {
    round += 1;
    response = await callOpenAI(client, {
      input: buildShortenPrompt(result.overLimit),
      tokens: result.overLimit.map(({ token }) => token),
      previousResponseId: response.id,
    });

    data = { ...data, ...parseJsonResponse(response.text) };
    result = validate(data, tokenLimits);
  }

  if (!result.valid) {
    const details = result.overLimit
      .map(({ token, limit, length }) => `${token} (${length}/${limit} chars)`)
      .join(', ');
    throw new Error(
      `OpenAI could not shorten the following field(s) after ${MAX_SHORTEN_ROUNDS} attempts: ${details}`
    );
  }

  return data;
}
