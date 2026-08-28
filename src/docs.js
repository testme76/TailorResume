// docs.js — Drive/Docs API operations: copy template, fill tokens, export PDF.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

function openBrowser(url) {
  const commands = {
    win32: ['rundll32.exe', ['url.dll,FileProtocolHandler', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const [command, args] = commands[process.platform] || commands.linux;
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function loadOAuthClient(clientFilePath) {
  const credential = JSON.parse(fs.readFileSync(clientFilePath, 'utf8'));
  const client = credential.installed || credential.web;
  if (!client?.client_id || !client?.client_secret) {
    throw new Error(
      `Invalid OAuth client file: ${clientFilePath}. Download a Desktop app OAuth client JSON.`
    );
  }
  return client;
}

async function authorizeInteractively(client, tokenFilePath) {
  const state = crypto.randomBytes(24).toString('hex');
  const server = http.createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const oauth2Client = new google.auth.OAuth2(
    client.client_id,
    client.client_secret,
    redirectUri
  );

  const codePromise = new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end('Not found');
        return;
      }

      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end('Invalid OAuth state. You may close this window.');
        reject(new Error('OAuth state validation failed.'));
        return;
      }

      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        res.writeHead(400).end('Authorization was not completed. You may close this window.');
        reject(new Error(`Google authorization failed: ${oauthError}`));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400).end('Missing authorization code. You may close this window.');
        reject(new Error('Google did not return an authorization code.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Authorization complete</h2><p>You can close this window and return to the terminal.</p>');
      resolve(code);
    });
  });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

  console.log('\nGoogle authorization is required.');
  console.log('Opening your browser. If it does not open, visit this URL:');
  console.log(authUrl);
  openBrowser(authUrl);

  let timeout;
  try {
    const code = await Promise.race([
      codePromise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Google authorization timed out after 5 minutes.')),
          5 * 60 * 1000
        );
      }),
    ]);
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Revoke the app grant and authorize again.'
      );
    }
    oauth2Client.setCredentials(tokens);
    await fs.promises.mkdir(path.dirname(tokenFilePath), { recursive: true });
    await fs.promises.writeFile(tokenFilePath, JSON.stringify(tokens, null, 2), {
      mode: 0o600,
    });
    console.log(`OAuth token saved to ${tokenFilePath}`);
    return oauth2Client;
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

/** Build an OAuth client, prompting in the browser only on the first run. */
export async function getAuth(clientFilePath, tokenFilePath) {
  const client = loadOAuthClient(clientFilePath);

  if (fs.existsSync(tokenFilePath)) {
    const oauth2Client = new google.auth.OAuth2(
      client.client_id,
      client.client_secret,
      client.redirect_uris?.[0]
    );
    oauth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenFilePath, 'utf8')));
    return oauth2Client;
  }

  return authorizeInteractively(client, tokenFilePath);
}

export function getDriveClient(auth) {
  return google.drive({ version: 'v3', auth });
}

export function getDocsClient(auth) {
  return google.docs({ version: 'v1', auth });
}

/**
 * Copy TEMPLATE_DOC_ID into OUTPUT_FOLDER_ID under `name`.
 * Returns the new file's id.
 */
export async function copyTemplate(drive, { templateDocId, outputFolderId, name }) {
  const res = await drive.files.copy({
    fileId: templateDocId,
    requestBody: {
      name,
      parents: [outputFolderId],
    },
  });
  return res.data.id;
}

/**
 * Replace every {{TOKEN}} occurrence in the doc with its value via a single
 * batchUpdate of replaceAllText requests. Only swaps the text run's
 * characters — inherited formatting (bold, size, bullet) is untouched.
 */
export async function replaceTokens(docs, documentId, tokenValues) {
  const requests = Object.entries(tokenValues).map(([token, value]) => ({
    replaceAllText: {
      containsText: {
        text: `{{${token}}}`,
        matchCase: true,
      },
      replaceText: String(value),
    },
  }));

  if (requests.length === 0) return;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });
}

/**
 * Export the filled doc to PDF and write it to `outPath`.
 * Returns the absolute path written.
 */
export async function exportPdf(drive, documentId, outPath) {
  const res = await drive.files.export(
    { fileId: documentId, mimeType: 'application/pdf' },
    { responseType: 'stream' }
  );

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(outPath);
    res.data.on('error', reject);
    dest.on('error', reject);
    dest.on('finish', resolve);
    res.data.pipe(dest);
  });

  return path.resolve(outPath);
}

/** List file names currently in the output folder, for collision checking. */
export async function listFilesInFolder(drive, folderId) {
  const names = [];
  let pageToken;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(name)',
      pageToken,
    });
    for (const f of res.data.files || []) names.push(f.name);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return names;
}

export function getDocLink(documentId) {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}
