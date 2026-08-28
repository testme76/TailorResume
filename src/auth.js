#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAuth } from './docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const clientPath = path.resolve(
  root,
  process.env.GOOGLE_OAUTH_CLIENT_PATH || './config/oauth-client.json'
);
const tokenPath = path.resolve(
  root,
  process.env.GOOGLE_OAUTH_TOKEN_PATH || './config/oauth-token.json'
);

if (!fs.existsSync(clientPath)) {
  console.error(`OAuth client file not found at ${clientPath}`);
  process.exit(1);
}

getAuth(clientPath, tokenPath)
  .then(() => console.log('\nGoogle authorization is ready.'))
  .catch((error) => {
    console.error(`\nAuthorization failed: ${error.message}`);
    process.exit(1);
  });
