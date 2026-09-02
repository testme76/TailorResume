import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as docsLib from './docs.js';
import * as naming from './naming.js';
import * as openaiLib from './openai.js';
import * as sheetsLib from './sheets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required .env variable: ${name}`);
  return value;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

export function getTokenLimits() {
  return readJson(path.join('config', 'token-limits.json'));
}

export function getTokenMinimums() {
  return readJson(path.join('config', 'token-minimums.json'));
}

function getOAuthPaths() {
  return {
    clientPath: path.resolve(
      ROOT,
      process.env.GOOGLE_OAUTH_CLIENT_PATH || './config/oauth-client.json'
    ),
    tokenPath: path.resolve(
      ROOT,
      process.env.GOOGLE_OAUTH_TOKEN_PATH || './config/oauth-token.json'
    ),
  };
}

async function getGoogleClients() {
  const { clientPath, tokenPath } = getOAuthPaths();
  if (!fs.existsSync(clientPath)) throw new Error(`OAuth client file not found at ${clientPath}`);
  if (!fs.existsSync(tokenPath)) {
    throw new Error('Google OAuth token not found. Run npm run auth first.');
  }

  const auth = await docsLib.getAuth(clientPath, tokenPath);
  return {
    docs: docsLib.getDocsClient(auth),
    drive: docsLib.getDriveClient(auth),
    sheets: sheetsLib.getSheetsClient(auth),
  };
}

async function loadBulletBank() {
  const spreadsheetId = process.env.BULLET_BANK_SHEET_ID || null;
  if (!spreadsheetId) return readJson(path.join('data', 'bullet-bank.json'));
  const { sheets } = await getGoogleClients();
  return sheetsLib.loadBulletBankFromSheet(sheets, spreadsheetId);
}

function assertText(value, label, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

export async function extractJobMetadata(jd) {
  const normalizedJd = assertText(jd, 'Job description', 40);
  const client = openaiLib.getClient(requireEnv('OPENAI_API_KEY'));
  return openaiLib.extractJobMetadata(client, { jd: normalizedJd });
}

export async function generateCompanyInterest({ job, profile }) {
  if (!job || !profile) throw new Error('An application snapshot is required.');
  const normalizedJob = {
    jd: assertText(job.jd, 'Job description', 40),
    company: assertText(job.company, 'Company'),
    role: assertText(job.role, 'Role'),
  };
  const client = openaiLib.getClient(requireEnv('OPENAI_API_KEY'));
  return openaiLib.generateCompanyInterest(client, { job: normalizedJob, profile });
}

export async function prepareTailor({ jd, company, role }) {
  const normalizedJd = assertText(jd, 'Job description', 40);
  const normalizedCompany = assertText(company, 'Company');
  const normalizedRole = assertText(role, 'Role');
  const tokenLimits = getTokenLimits();
  const tokenMinimums = getTokenMinimums();
  const bulletBank = await loadBulletBank();
  const client = openaiLib.getClient(requireEnv('OPENAI_API_KEY'));

  const tokenValues = await openaiLib.generateTailoredContent(client, {
    jd: normalizedJd,
    bulletBank,
    tokenLimits,
    tokenMinimums,
    company: normalizedCompany,
    role: normalizedRole,
  });

  return {
    company: normalizedCompany,
    role: normalizedRole,
    model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
    tokenLimits,
    tokenMinimums,
    tokenValues,
  };
}

function normalizeAndValidateTokenValues(tokenValues, tokenLimits, tokenMinimums) {
  if (!tokenValues || typeof tokenValues !== 'object' || Array.isArray(tokenValues)) {
    throw new Error('Generated resume fields are required.');
  }

  const normalized = Object.fromEntries(
    Object.keys(tokenLimits).map((token) => [
      token,
      typeof tokenValues[token] === 'string' ? tokenValues[token].trim() : '',
    ])
  );
  const result = openaiLib.validate(normalized, tokenLimits, tokenMinimums);
  if (result.missing.length > 0) {
    throw new Error(`Missing resume field(s): ${result.missing.join(', ')}`);
  }
  if (result.overLimit.length > 0) {
    const detail = result.overLimit
      .map(({ token, length, limit }) => `${token} (${length}/${limit})`)
      .join(', ');
    throw new Error(`Resume field(s) exceed their character limits: ${detail}`);
  }
  if (result.underLimit.length > 0) {
    const detail = result.underLimit
      .map(({ token, length, minimum }) => `${token} (${length}/${minimum})`)
      .join(', ');
    throw new Error(`Resume field(s) are below their minimum lengths: ${detail}`);
  }
  return normalized;
}

export async function publishTailor({ company, role, tokenValues }) {
  const normalizedCompany = assertText(company, 'Company');
  const normalizedRole = assertText(role, 'Role');
  const tokenLimits = getTokenLimits();
  const tokenMinimums = getTokenMinimums();
  const normalizedTokens = normalizeAndValidateTokenValues(
    tokenValues,
    tokenLimits,
    tokenMinimums
  );

  const templateDocId = requireEnv('TEMPLATE_DOC_ID');
  const outputFolderId = requireEnv('OUTPUT_FOLDER_ID');
  const trackingSheetId = requireEnv('TRACKING_SHEET_ID');
  const { docs, drive, sheets } = await getGoogleClients();

  const baseName = naming.buildBaseName({ company: normalizedCompany, role: normalizedRole });
  const [sheetNames, folderNames] = await Promise.all([
    sheetsLib.checkNameCollision(sheets, trackingSheetId, baseName),
    docsLib.listFilesInFolder(drive, outputFolderId),
  ]);
  const finalBaseName = naming.resolveCollision(baseName, [...sheetNames, ...folderNames]);
  const pdfFilename = naming.toPdfFilename(finalBaseName);

  const documentId = await docsLib.copyTemplate(drive, {
    templateDocId,
    outputFolderId,
    name: finalBaseName,
  });
  await docsLib.replaceTokens(docs, documentId, normalizedTokens);

  const pdfPath = await docsLib.exportPdf(
    drive,
    documentId,
    path.join(ROOT, 'output', pdfFilename)
  );
  const docLink = docsLib.getDocLink(documentId);

  await sheetsLib.appendTrackingRow(sheets, trackingSheetId, {
    date: naming.formatDate(),
    company: normalizedCompany,
    role: normalizedRole,
    filename: pdfFilename,
    docLink,
    pdfLink: pdfPath,
    status: 'generated',
  });

  return { documentId, docLink, pdfFilename, pdfPath };
}
