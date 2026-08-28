import assert from 'node:assert/strict';
import test from 'node:test';

import { appendTrackingRow, checkNameCollision } from '../src/sheets.js';

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
