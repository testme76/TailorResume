// docs.js — Drive/Docs API operations: copy template, fill tokens, export PDF.
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

/** Build a shared google-auth-library auth client from the service-account key file. */
export function getAuth(keyFilePath) {
  return new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: SCOPES,
  });
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
