import fs from 'node:fs';
import path from 'node:path';

import { prepareTailor, publishTailor, ROOT } from '../pipeline.js';
import { resolveRuleValues } from '../apply/policies/salary.js';
import {
  findSecurityClearanceRequirement,
  findUsCitizenshipRequirement,
} from '../apply/policies/job.js';
import { ApplicationStore } from './store.js';

function readCandidateProfile(profilePath = './config/candidate-profile.json') {
  const resolved = path.resolve(ROOT, profilePath);
  if (!fs.existsSync(resolved)) throw new Error(`Candidate profile not found at ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function tokensForSection(tokenValues, section) {
  const prefix = String(section || '').replace(/\s+/g, '').toUpperCase();
  return Object.entries(tokenValues)
    .filter(([token]) => token.startsWith(`${prefix}_BULLET`))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, value]) => value)
    .filter(Boolean);
}

export function buildProfileSnapshot(profile, tokenValues, job) {
  const mapSection = (item) => ({
    ...item,
    bullets: tokensForSection(tokenValues, item.section),
  });
  const answers = (profile.answers || []).map((rule) => ({
    match: rule.match,
    values: resolveRuleValues(rule, { job }),
  }));

  return {
    personal: profile.personal || {},
    links: profile.links || {},
    education: profile.education || [],
    experience: (profile.experience || []).map(mapSection),
    projects: (profile.projects || []).map(mapSection),
    summary: tokenValues.SUMMARY || '',
    skills: tokenValues.SKILLS || '',
    answers,
    policies: {
      skipIfRequiredQuestions: profile.skipIfRequiredQuestions || [],
    },
  };
}

export async function createApplicationSnapshot({
  url,
  jd,
  company,
  role,
  profilePath,
  store = new ApplicationStore(),
  tailor = prepareTailor,
  publish = publishTailor,
}) {
  if (!url) throw new Error('Job URL is required.');
  if (!jd || jd.trim().length < 40) throw new Error('A complete job description is required.');
  if (!company?.trim() || !role?.trim()) throw new Error('Company and role are required.');

  const job = { jd: jd.trim(), company: company.trim(), role: role.trim() };
  const profile = readCandidateProfile(profilePath);
  if (profile.skipIfSecurityClearanceRequired === true) {
    const requirement = findSecurityClearanceRequirement(job.jd);
    if (requirement) throw new Error(`Skipped: job requires a security clearance. ${requirement}`);
  }
  if (profile.skipIfUsCitizenshipRequired === true) {
    const requirement = findUsCitizenshipRequirement(job.jd);
    if (requirement) throw new Error(`Skipped: job requires U.S. citizenship. ${requirement}`);
  }
  const prepared = await tailor(job);
  const published = await publish(prepared);

  return store.save({
    url,
    job: { company: job.company, role: job.role, jd: job.jd },
    resume: {
      filename: published.pdfFilename,
      path: published.pdfPath,
      url: `/output/${encodeURIComponent(published.pdfFilename)}`,
      documentId: published.documentId,
      docLink: published.docLink,
    },
    profile: buildProfileSnapshot(profile, prepared.tokenValues, job),
    tokenValues: prepared.tokenValues,
  });
}
