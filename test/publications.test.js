import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPublisher, PublicationInputError } from '../src/publications/publisher.js';
import { PublicationStore } from '../src/publications/store.js';

function createHarness(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-publications-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputRoot = path.join(directory, 'output');
  const store = new PublicationStore(path.join(directory, 'state'));
  const generationId = crypto.randomUUID();
  store.create({ generationId, company: 'Example', role: 'Engineer' });
  const calls = { append: 0, copy: 0, export: 0, replace: 0, trash: 0 };
  let trackingRowExists = false;

  const docsLib = {
    findFileByGenerationId: async () => null,
    listFilesInFolder: async () => [],
    copyTemplate: async () => {
      calls.copy += 1;
      return 'doc-1';
    },
    getDocLink: (id) => `https://docs.example/${id}`,
    replaceTokens: async () => {
      calls.replace += 1;
    },
    exportPdf: async (_drive, _documentId, outPath) => {
      calls.export += 1;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, 'pdf');
      return path.resolve(outPath);
    },
    trashFile: async () => {
      calls.trash += 1;
    },
    ...overrides.docsLib,
  };
  const sheetsLib = {
    checkNameCollision: async () => [],
    hasTrackingRow: async () => trackingRowExists,
    appendTrackingRow: async () => {
      calls.append += 1;
      trackingRowExists = true;
    },
    ...overrides.sheetsLib,
  };
  const naming = {
    buildBaseName: () => '2026-09-04_Example_Engineer',
    resolveCollision: (baseName, existingNames) => {
      const taken = new Set(
        existingNames.map((name) => String(name).replace(/\.pdf$|\.docx?$/i, ''))
      );
      if (!taken.has(baseName)) return baseName;
      let version = 2;
      while (taken.has(`${baseName}_v${version}`)) version += 1;
      return `${baseName}_v${version}`;
    },
    toPdfFilename: (baseName) => `${baseName}.pdf`,
    formatDate: () => '2026-09-04',
  };
  const publish = createPublisher({
    store,
    docsLib,
    sheetsLib,
    naming,
    getGoogleClients: async () => ({ docs: {}, drive: {}, sheets: {} }),
    requireEnv: (name) => `${name}-value`,
    outputRoot,
  });
  const input = {
    generationId,
    company: 'Example',
    role: 'Engineer',
    tokenValues: { SUMMARY: 'Backend engineer' },
  };

  return { calls, generationId, input, outputRoot, publish, store };
}

test('concurrent requests with one generationId publish only once', async (t) => {
  let releaseCopy;
  const copyStarted = new Promise((resolve) => {
    releaseCopy = resolve;
  });
  const harness = createHarness(t, {
    docsLib: {
      copyTemplate: async () => {
        harness.calls.copy += 1;
        await copyStarted;
        return 'doc-1';
      },
    },
  });

  const first = harness.publish(harness.input);
  const second = harness.publish(harness.input);
  releaseCopy();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(harness.calls.copy, 1);
  assert.equal(harness.calls.export, 1);
  assert.equal(harness.calls.append, 1);
  assert.equal(firstResult.reused, false);
  assert.equal(secondResult.reused, true);
});

test('different concurrent publications receive different local filenames', async (t) => {
  const harness = createHarness(t, {
    sheetsLib: {
      hasTrackingRow: async () => false,
    },
  });
  const secondGenerationId = crypto.randomUUID();
  harness.store.create({
    generationId: secondGenerationId,
    company: 'Example',
    role: 'Engineer',
  });

  const [first, second] = await Promise.all([
    harness.publish(harness.input),
    harness.publish({ ...harness.input, generationId: secondGenerationId }),
  ]);

  assert.notEqual(first.pdfFilename, second.pdfFilename);
  assert.deepEqual(
    [first.pdfFilename, second.pdfFilename],
    ['2026-09-04_Example_Engineer.pdf', '2026-09-04_Example_Engineer_v2.pdf']
  );
  assert.equal(harness.calls.copy, 2);
  assert.equal(harness.calls.export, 2);
});

test('token replacement failure trashes the partial document', async (t) => {
  const harness = createHarness(t, {
    docsLib: {
      replaceTokens: async () => {
        harness.calls.replace += 1;
        throw new Error('replace failed');
      },
    },
  });

  await assert.rejects(
    harness.publish(harness.input),
    (error) => error.retryable === true && error.cleanupRequired === false
  );
  assert.equal(harness.calls.trash, 1);
  assert.equal(harness.calls.export, 0);
  assert.equal(harness.store.get(harness.generationId).status, 'failed');
  assert.equal(harness.store.get(harness.generationId).documentId, null);
});

test('cleanup failure preserves the document id for manual recovery', async (t) => {
  const harness = createHarness(t, {
    docsLib: {
      replaceTokens: async () => {
        throw new Error('replace failed');
      },
      trashFile: async () => {
        harness.calls.trash += 1;
        throw new Error('Drive unavailable');
      },
    },
  });

  await assert.rejects(
    harness.publish(harness.input),
    (error) => error.retryable === true &&
      error.cleanupRequired === true &&
      error.message.includes('doc-1')
  );
  const record = harness.store.get(harness.generationId);
  assert.equal(record.status, 'failed');
  assert.equal(record.documentId, 'doc-1');
  assert.equal(record.cleanupRequired, true);
});

test('tracking failure retries only the sheet append', async (t) => {
  let failAppend = true;
  const harness = createHarness(t, {
    sheetsLib: {
      appendTrackingRow: async () => {
        harness.calls.append += 1;
        if (failAppend) {
          failAppend = false;
          throw new Error('sheet unavailable');
        }
      },
    },
  });

  await assert.rejects(harness.publish(harness.input), /tracking sheet was not updated/);
  assert.equal(harness.store.get(harness.generationId).status, 'pdf_exported');
  const result = await harness.publish(harness.input);

  assert.equal(result.reused, false);
  assert.equal(harness.calls.copy, 1);
  assert.equal(harness.calls.export, 1);
  assert.equal(harness.calls.append, 2);
  assert.equal(harness.store.get(harness.generationId).status, 'completed');
});

test('retry detects a tracking row created before a lost response', async (t) => {
  let rowExists = false;
  const harness = createHarness(t, {
    sheetsLib: {
      hasTrackingRow: async () => rowExists,
      appendTrackingRow: async () => {
        harness.calls.append += 1;
        rowExists = true;
        throw new Error('response lost');
      },
    },
  });

  await assert.rejects(harness.publish(harness.input), /tracking sheet was not updated/);
  const result = await harness.publish(harness.input);

  assert.equal(result.pdfFilename, '2026-09-04_Example_Engineer.pdf');
  assert.equal(harness.calls.append, 1);
  assert.equal(harness.store.get(harness.generationId).status, 'completed');
});

test('a generationId cannot be reused with different content', async (t) => {
  const harness = createHarness(t);
  await harness.publish(harness.input);

  await assert.rejects(
    harness.publish({
      ...harness.input,
      tokenValues: { SUMMARY: 'Different content' },
    }),
    (error) => error instanceof PublicationInputError && error.statusCode === 400
  );
  assert.equal(harness.calls.copy, 1);
});
