// sheets.js — tracking-sheet + (optional) bullet-bank-sheet reads/writes.
import { google } from 'googleapis';

const TRACKING_RANGE = 'A:G'; // date | company | role | filename | doc_link | pdf_link | status

/** Build an authenticated Sheets API client from a shared google-auth-library auth. */
export function getSheetsClient(auth) {
  return google.sheets({ version: 'v4', auth });
}

/**
 * Read the tracking sheet's filename column and return every filename
 * (with or without extension) that starts with `baseName`. Used to detect
 * collisions before naming a new file.
 */
export async function checkNameCollision(sheets, spreadsheetId, baseName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Sheet1!${TRACKING_RANGE}`,
  });

  const rows = res.data.values || [];
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  const filenameCol = header.findIndex(
    (h) => String(h).trim().toLowerCase() === 'filename'
  );
  if (filenameCol === -1) return [];

  return dataRows
    .map((row) => row[filenameCol])
    .filter((name) => name && name.startsWith(baseName));
}

/**
 * Append one row to the tracking sheet.
 * row: { date, company, role, filename, docLink, pdfLink, status }
 */
export async function appendTrackingRow(sheets, spreadsheetId, row) {
  const values = [
    [
      row.date,
      row.company,
      row.role,
      row.filename,
      row.docLink,
      row.pdfLink,
      row.status,
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `Sheet1!${TRACKING_RANGE}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

/**
 * Optional: load the bullet bank from a Google Sheet instead of
 * data/bullet-bank.json, when BULLET_BANK_SHEET_ID is set.
 * Expects columns: id | role | skills (comma-separated) | short | medium | long
 */
export async function loadBulletBankFromSheet(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A:F',
  });

  const rows = res.data.values || [];
  if (rows.length === 0) return { bullets: [] };

  const [, ...dataRows] = rows; // skip header
  const bullets = dataRows
    .filter((r) => r[0])
    .map((r) => ({
      id: r[0],
      role: r[1] || '',
      skills: (r[2] || '').split(',').map((s) => s.trim()).filter(Boolean),
      variants: {
        short: r[3] || '',
        medium: r[4] || '',
        long: r[5] || '',
      },
    }));

  return { bullets };
}
