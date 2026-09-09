import assert from 'node:assert/strict';
import test from 'node:test';

import { appendTrackingRow, checkNameCollision, hasTrackingRow } from '../src/sheets.js';

test('tracking operations use the first sheet regardless of its localized title', async () => {
  const calls = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async (request) => {
          calls.push(['get', request]);
          return { data: { values: [['filename'], ['2026-Example-Role.pdf']] } };
        },
        append: async (request) => {
          calls.push(['append', request]);
        },
      },
    },
  };

  const collisions = await checkNameCollision(sheets, 'sheet-id', '2026-Example');
  await appendTrackingRow(sheets, 'sheet-id', {
    date: '2026-08-19',
    company: 'Example',
    role: 'Role',
    filename: 'file.pdf',
    docLink: 'doc',
    pdfLink: 'pdf',
    status: 'generated',
  });

  assert.deepEqual(collisions, ['2026-Example-Role.pdf']);
  assert.equal(calls[0][1].range, 'A:G');
  assert.equal(calls[1][1].range, 'A:G');
});

test('hasTrackingRow requires both the filename and document link', async () => {
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({
          data: {
            values: [
              ['date', 'company', 'role', 'filename', 'doc_link', 'pdf_link', 'status'],
              ['2026-09-04', 'Example', 'Engineer', 'resume.pdf', 'https://doc/1', '', 'generated'],
            ],
          },
        }),
      },
    },
  };

  assert.equal(
    await hasTrackingRow(sheets, 'sheet-id', {
      filename: 'resume.pdf',
      docLink: 'https://doc/1',
    }),
    true
  );
  assert.equal(
    await hasTrackingRow(sheets, 'sheet-id', {
      filename: 'resume.pdf',
      docLink: 'https://doc/2',
    }),
    false
  );
});
