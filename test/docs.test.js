import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getAuth } from '../src/docs.js';

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
