#!/usr/bin/env node
// index.js — CLI entry point; orchestrates the 10-step tailoring workflow.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as naming from './naming.js';
import * as docsLib from './docs.js';
import * as sheetsLib from './sheets.js';
import * as openaiLib from './openai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { jd: null, company: null, role: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--jd') args.jd = argv[++i];
    else if (arg === '--company') args.company = argv[++i];
    else if (arg === '--role') args.role = argv[++i];
  }
  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/** Step 1: resolve the JD from a file path, pasted text, or stdin. */
async function resolveJobDescription(jdArg) {
  if (jdArg) {
    const asPath = path.resolve(process.cwd(), jdArg);
    if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
      return fs.readFileSync(asPath, 'utf8');
    }
    return jdArg; // treat as pasted text
  }
  const stdinText = await readStdin();
  if (!stdinText.trim()) {
    throw new Error('No job description provided. Use --jd <path|text> or pipe it via stdin.');
  }
  return stdinText;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required .env variable: ${name}`);
  return value;
}

async function main() {
  const { jd: jdArg, company, role } = parseArgs(process.argv.slice(2));
  if (!company || !role) {
    console.error('Usage: npm run tailor -- --jd <path|text> --company "Name" --role "Title"');
    process.exit(1);
  }

  const jd = await resolveJobDescription(jdArg);

  // --- Step 2: load bullet bank + token limits ---
  const tokenLimits = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config', 'token-limits.json'), 'utf8')
  );

  const openaiApiKey = requireEnv('OPENAI_API_KEY');
  const serviceAccountPath = path.resolve(
    ROOT,
    requireEnv('GOOGLE_SERVICE_ACCOUNT_PATH')
  );
  const templateDocId = requireEnv('TEMPLATE_DOC_ID');
  const outputFolderId = requireEnv('OUTPUT_FOLDER_ID');
  const trackingSheetId = requireEnv('TRACKING_SHEET_ID');
  const bulletBankSheetId = process.env.BULLET_BANK_SHEET_ID || null;

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Service account key not found at ${serviceAccountPath}. See README "One-time Google Cloud setup".`
    );
  }

  const auth = docsLib.getAuth(serviceAccountPath);
  const drive = docsLib.getDriveClient(auth);
  const docs = docsLib.getDocsClient(auth);
  const sheets = sheetsLib.getSheetsClient(auth);

  let bulletBank;
  if (bulletBankSheetId) {
    bulletBank = await sheetsLib.loadBulletBankFromSheet(sheets, bulletBankSheetId);
  } else {
    bulletBank = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data', 'bullet-bank.json'), 'utf8')
    );
  }

  // --- Step 3 & 4: call OpenAI, validate, retry-shorten as needed ---
  console.log('Calling OpenAI to tailor content...');
  const openaiClient = openaiLib.getClient(openaiApiKey);
  const tokenValues = await openaiLib.generateTailoredContent(openaiClient, {
    jd,
    bulletBank,
    tokenLimits,
    company,
    role,
  });

  // --- Step 5: build filename, check collisions ---
  const baseName = naming.buildBaseName({ company, role });
  const [sheetNames, folderNames] = await Promise.all([
    sheetsLib.checkNameCollision(sheets, trackingSheetId, baseName),
    docsLib.listFilesInFolder(drive, outputFolderId),
  ]);
  const finalBaseName = naming.resolveCollision(baseName, [...sheetNames, ...folderNames]);
  const pdfFilename = naming.toPdfFilename(finalBaseName);

  // --- Step 6: copy template into output folder, renamed ---
  console.log(`Copying template as "${finalBaseName}"...`);
  const documentId = await docsLib.copyTemplate(drive, {
    templateDocId,
    outputFolderId,
    name: finalBaseName,
  });

  // --- Step 7: replace {{TOKEN}} placeholders, formatting untouched ---
  console.log('Filling template tokens...');
  await docsLib.replaceTokens(docs, documentId, tokenValues);

  // --- Step 8: export to PDF ---
  console.log('Exporting PDF...');
  const outPath = path.join(ROOT, 'output', pdfFilename);
  const pdfPath = await docsLib.exportPdf(drive, documentId, outPath);

  // --- Step 9: log a row in the tracking sheet ---
  const docLink = docsLib.getDocLink(documentId);
  await sheetsLib.appendTrackingRow(sheets, trackingSheetId, {
    date: naming.formatDate(),
    company,
    role,
    filename: pdfFilename,
    docLink,
    pdfLink: pdfPath,
    status: 'generated',
  });

  // --- Step 10: print results ---
  console.log('\nDone.');
  console.log(`Doc:  ${docLink}`);
  console.log(`PDF:  ${pdfPath}`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
