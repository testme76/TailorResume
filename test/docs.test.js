import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { exportPdf, getAuth } from '../src/docs.js';

test('getAuth restores an existing OAuth token without interactive login', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-oauth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const clientPath = path.join(dir, 'client.json');
  const tokenPath = path.join(dir, 'token.json');
  fs.writeFileSync(
    clientPath,
    JSON.stringify({
      installed: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        redirect_uris: ['http://localhost'],
      },
    })
  );
  fs.writeFileSync(
    tokenPath,
    JSON.stringify({ refresh_token: 'refresh-token', expiry_date: 0 })
  );

  const auth = await getAuth(clientPath, tokenPath);
  assert.equal(auth.credentials.refresh_token, 'refresh-token');
});

test('exportPdf atomically promotes a completed temporary file', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-pdf-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'resume.pdf');
  const drive = {
    files: {
      export: async () => ({ data: Readable.from([Buffer.from('complete-pdf')]) }),
    },
  };

  assert.equal(await exportPdf(drive, 'doc-1', destination), path.resolve(destination));
  assert.equal(fs.readFileSync(destination, 'utf8'), 'complete-pdf');
  assert.deepEqual(fs.readdirSync(directory), ['resume.pdf']);
});

test('exportPdf removes its temporary file when the stream fails', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-pdf-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'resume.pdf');
  const stream = new Readable({
    read() {
      this.push('partial');
      this.destroy(new Error('download interrupted'));
    },
  });
  const drive = { files: { export: async () => ({ data: stream }) } };

  await assert.rejects(exportPdf(drive, 'doc-1', destination), /download interrupted/);
  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});
