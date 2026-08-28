#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { prepareTailor, publishTailor } from './pipeline.js';

function parseArgs(argv) {
  const args = { jd: null, company: null, role: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--jd') args.jd = argv[++i];
    else if (argv[i] === '--company') args.company = argv[++i];
    else if (argv[i] === '--role') args.role = argv[++i];
  }
  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function resolveJobDescription(jdArg) {
  if (jdArg) {
    const possiblePath = path.resolve(process.cwd(), jdArg);
    if (fs.existsSync(possiblePath) && fs.statSync(possiblePath).isFile()) {
      return fs.readFileSync(possiblePath, 'utf8');
    }
    return jdArg;
  }
  const stdin = await readStdin();
  if (!stdin.trim()) {
    throw new Error('No job description provided. Use --jd <path|text> or pipe stdin.');
  }
  return stdin;
}

async function main() {
  const { jd: jdArg, company, role } = parseArgs(process.argv.slice(2));
  if (!company || !role) {
    throw new Error('Usage: npm run tailor -- --jd <path|text> --company "Name" --role "Title"');
  }

  const jd = await resolveJobDescription(jdArg);
  console.log('Calling OpenAI to tailor content...');
  const prepared = await prepareTailor({ jd, company, role });

  console.log('Publishing Google Doc and PDF...');
  const result = await publishTailor(prepared);
  console.log('\nDone.');
  console.log(`Doc:  ${result.docLink}`);
  console.log(`PDF:  ${result.pdfPath}`);
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
