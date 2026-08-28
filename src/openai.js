// openai.js — calls the OpenAI Responses API and returns validated JSON.
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
const MAX_REVISION_ROUNDS = 3;

export function getClient(apiKey) {
  return new OpenAI({ apiKey });
}

/** Extract the employer and title from pasted job-page text. */
export async function extractJobMetadata(client, { jd }) {
  const response = await client.responses.create({
    model: MODEL,
    instructions: [
      'Extract the hiring company and job title from the supplied job posting.',
      'Use only information explicitly present in the text.',
      'Return concise names without location, requisition ID, or surrounding labels.',
      'If either value is genuinely unavailable, return an empty string for it.',
    ].join(' '),
    input: jd,
    max_output_tokens: 300,
    reasoning: { effort: 'low' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'job_metadata',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            company: { type: 'string' },
            role: { type: 'string' },
          },
          required: ['company', 'role'],
          additionalProperties: false,
        },
      },
    },
  });

  if (!response.output_text) {
    throw new Error(`OpenAI returned no job metadata (status: ${response.status}).`);
  }
  return parseJsonResponse(response.output_text);
}

function buildInstructions() {
  return [
    'You are a precise resume-writing assistant.',
    'Write concrete resume content grounded only in the supplied bullet bank.',
    'Quantify claims only when the source material supports them.',
    'Never invent employers, titles, numbers, or skills.',
    'Treat bullet-bank variants as evidence notes, never as writing templates. Rewrite every experience and project bullet from scratch for the target job.',
    'Every rewritten bullet must differ substantially from the source variants in sentence structure, opening phrase, emphasis, and professional framing; do not merely swap a few words.',
    'Within the same role or project, you may combine, split, and redistribute supported facts across its output bullets. Do not preserve a one-source-item-to-one-output-bullet mapping.',
    'Omit low-value domain details when they distract from the target role, and translate adjacent experience into the target function it demonstrates. Keep the underlying action, technology, scope, and result accurate.',
    'Treat the job description as the guide for framing, terminology, emphasis, and ordering, but never as evidence that the candidate performed an activity.',
    'When a source fact supports the target function, express it through that function: for infrastructure roles emphasize deployment, scalability, reliability, observability, performance, and operational ownership; apply the equivalent job-specific framing for other roles.',
    'Front-load each bullet with the target competency it demonstrates, then explain the grounded implementation and measurable result.',
    'Use three to five exact or closely equivalent job-description terms in each bullet whenever the source facts support them; never force unsupported terms.',
    'A recruiter must be able to identify the target job function from the first half of every bullet without relying on the section title.',
    'Avoid reusing any six-word sequence from a source variant except unavoidable technology names, metrics, and fixed technical phrases.',
    'Across the resume, explicitly cover the six most important supported requirements from the job description and avoid repeating the same positioning in every bullet.',
    'Mirror job-description terminology when it is a truthful equivalent of a supplied fact or skill, and preserve supported metrics and outcomes.',
    'The SUMMARY must name the target job family and foreground four to six of its most important supported technical or functional requirements.',
    'Keep facts within their original Role 1, Role 2, Project 1, or Project 2 section, and order bullets within each section by relevance to the job.',
    'For SKILLS, use only verified items from skillsProfile; never copy a skill from the job description unless it is already present there.',
    'Format SKILLS as exactly four newline-separated lines, in this order: "Languages: ...", "Frameworks & Runtime: ...", "APIs & Data: ...", and "Cloud & Tools: ...".',
    'Categorize each verified skill under the most accurate heading, use canonical names, separate items with commas, and reorder items within each line by relevance to the job description.',
    'Do not use bullets, proficiency ratings, soft skills, or explanatory prose in SKILLS.',
    'Every other value must be plain text with no Markdown, bullet characters, or line breaks.',
  ].join(' ');
}

function buildUserPrompt({ jd, bulletBank, tokenLimits, tokenMinimums, company, role }) {
  const tokenSpec = Object.entries(tokenLimits)
    .map(([token, limit]) => {
      const minimum = tokenMinimums[token] || 1;
      return `- "${token}": ${minimum}-${limit} characters`;
    })
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
    'Aggressively tailor every field to the job description using only facts grounded in',
    'the bullet bank. Before writing, identify the target role\'s six most important',
    'requirements that the candidate can genuinely support. Assign each bullet a distinct',
    'requirement or competency, then write the target-role bullet first and use source facts',
    'as evidence for it. Do not begin from a source sentence and edit it.',
    'Make the first clause immediately sound relevant to the target function. Prefer the',
    'job description\'s verbs, nouns, and technical vocabulary whenever they truthfully',
    'describe the source fact. The output should read as if it was deliberately written',
    'for this exact vacancy, not adapted from a general resume. You may combine and',
    'redistribute facts within the same role or project, remove distracting domain context,',
    'and change the narrative angle aggressively. Preserve the strongest technical detail,',
    'scope, actions, and measured outcomes, but do not preserve source wording or sentence',
    'structure. Produce a substantive bullet within each allowed range',
    'without adding filler, unsupported tools, responsibilities, or results.',
    '',
    'Character limits:',
    tokenSpec,
  ].join('\n');
}

function buildRevisionPrompt(overLimit, underLimit) {
  const shortenLines = overLimit.map(
    ({ token, limit, length, value }) =>
      `- SHORTEN "${token}" to at most ${limit} characters (currently ${length}): "${value}"`
  );
  const expandLines = underLimit.map(
    ({ token, minimum, length, value }) =>
      `- EXPAND "${token}" to at least ${minimum} characters (currently ${length}): "${value}"`
  );

  return [
    'Rewrite only the fields below so each fits its stated character range.',
    'For expansions, restore relevant technical detail, scope, actions, and outcomes',
    'from the supplied context while preserving alignment with the target job description.',
    'Never add filler or facts absent from the context, and do not revert to verbatim source text.',
    ...shortenLines,
    ...expandLines,
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
export function validate(data, tokenLimits, tokenMinimums = {}) {
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

  const underLimit = requiredTokens
    .filter((token) => typeof data[token] === 'string' && data[token].length > 0)
    .map((token) => ({
      token,
      minimum: tokenMinimums[token] || 1,
      length: data[token].length,
      value: data[token],
    }))
    .filter(({ minimum, length }) => length < minimum);

  return {
    valid: missing.length === 0 && overLimit.length === 0 && underLimit.length === 0,
    missing,
    overLimit,
    underLimit,
  };
}

/** Generate every resume token and retry any values that exceed their limits. */
export async function generateTailoredContent(
  client,
  { jd, bulletBank, tokenLimits, tokenMinimums = {}, company, role }
) {
  let response = await callOpenAI(client, {
    input: buildUserPrompt({
      jd,
      bulletBank,
      tokenLimits,
      tokenMinimums,
      company,
      role,
    }),
    tokens: Object.keys(tokenLimits),
  });
  let data = parseJsonResponse(response.text);
  let result = validate(data, tokenLimits, tokenMinimums);

  if (result.missing.length > 0) {
    throw new Error(`OpenAI JSON is missing required token(s): ${result.missing.join(', ')}`);
  }

  let round = 0;
  while (!result.valid && round < MAX_REVISION_ROUNDS) {
    round += 1;
    const revisionTokens = [
      ...result.overLimit.map(({ token }) => token),
      ...result.underLimit.map(({ token }) => token),
    ];
    response = await callOpenAI(client, {
      input: buildRevisionPrompt(result.overLimit, result.underLimit),
      tokens: revisionTokens,
      previousResponseId: response.id,
    });

    data = { ...data, ...parseJsonResponse(response.text) };
    result = validate(data, tokenLimits, tokenMinimums);
  }

  if (!result.valid) {
    const details = [
      ...result.overLimit.map(
        ({ token, limit, length }) => `${token} (${length} chars, max ${limit})`
      ),
      ...result.underLimit.map(
        ({ token, minimum, length }) => `${token} (${length} chars, min ${minimum})`
      ),
    ].join(', ');
    throw new Error(
      `OpenAI could not fit the following field(s) after ${MAX_REVISION_ROUNDS} attempts: ${details}`
    );
  }

  return data;
}
