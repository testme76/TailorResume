import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isValidGenerationId } from './store.js';

export class PublicationInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublicationInputError';
    this.statusCode = 400;
    this.retryable = false;
    this.cleanupRequired = false;
  }
}

function requestHash({ company, role, tokenValues }) {
  const orderedTokens = Object.fromEntries(
    Object.keys(tokenValues).sort().map((key) => [key, tokenValues[key]])
  );
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ company, role, tokenValues: orderedTokens }))
    .digest('hex');
}

function resultFrom(record, reused = false) {
  return {
    generationId: record.generationId,
    documentId: record.documentId,
    docLink: record.docLink,
    pdfFilename: record.pdfFilename,
    pdfPath: record.pdfPath,
    reused,
  };
}

function publicationError(message, cause, { cleanupRequired = false } = {}) {
  const error = new Error(`${message}: ${cause.message}`);
  error.cause = cause;
  error.retryable = true;
  error.cleanupRequired = cleanupRequired;
  return error;
}

async function cleanupIncomplete({ record, drive, docsLib }) {
  const failures = [];
  const ids = new Set(record.documentId ? [record.documentId] : []);

  try {
    const discovered = await docsLib.findFileByGenerationId(drive, record.generationId);
    if (discovered?.id) ids.add(discovered.id);
  } catch (error) {
    failures.push(`could not search Drive: ${error.message}`);
  }

  for (const fileId of ids) {
    try {
      await docsLib.trashFile(drive, fileId);
    } catch (error) {
      failures.push(`could not trash Google Doc ${fileId}: ${error.message}`);
    }
  }

  if (record.pdfPath) {
    try {
      await fs.promises.rm(record.pdfPath, { force: true });
    } catch (error) {
      failures.push(`could not remove PDF ${record.pdfPath}: ${error.message}`);
    }
  }

  if (failures.length > 0) throw new Error(failures.join('; '));
}

export function createPublisher({
  store,
  docsLib,
  sheetsLib,
  naming,
  getGoogleClients,
  requireEnv,
  outputRoot,
}) {
  const inFlight = new Map();
  let publicationQueue = Promise.resolve();

  async function completeTracking(record, sheets, trackingSheetId) {
    try {
      const exists = await sheetsLib.hasTrackingRow(sheets, trackingSheetId, {
        filename: record.pdfFilename,
        docLink: record.docLink,
      });
      if (!exists) {
        await sheetsLib.appendTrackingRow(sheets, trackingSheetId, {
          date: record.trackingDate,
          company: record.company,
          role: record.role,
          filename: record.pdfFilename,
          docLink: record.docLink,
          pdfLink: record.pdfPath,
          status: 'generated',
        });
      }
      const completed = store.save({
        ...record,
        status: 'completed',
        error: null,
        cleanupRequired: false,
      });
      return resultFrom(completed);
    } catch (error) {
      store.save({
        ...record,
        status: 'pdf_exported',
        error: error.message,
        cleanupRequired: false,
      });
      throw publicationError('Resume files were created, but the tracking sheet was not updated', error);
    }
  }

  async function perform(input) {
    const { generationId, company, role, tokenValues } = input;
    if (!isValidGenerationId(generationId)) {
      throw new PublicationInputError('A valid generationId from /api/prepare is required.');
    }

    let record = store.get(generationId);
    if (!record) {
      throw new PublicationInputError('Unknown generationId. Prepare the resume again.');
    }
    if (record.company !== company || record.role !== role) {
      throw new PublicationInputError('Company or role changed after preparation. Prepare the resume again.');
    }

    const hash = requestHash({ company, role, tokenValues });
    if (record.requestHash && record.requestHash !== hash) {
      throw new PublicationInputError(
        'This generationId was already used with different resume content. Prepare the resume again.'
      );
    }
    if (!record.requestHash) record = store.save({ ...record, requestHash: hash });
    if (record.status === 'completed') return resultFrom(record, true);

    const templateDocId = requireEnv('TEMPLATE_DOC_ID');
    const outputFolderId = requireEnv('OUTPUT_FOLDER_ID');
    const trackingSheetId = requireEnv('TRACKING_SHEET_ID');
    const { docs, drive, sheets } = await getGoogleClients();

    if (record.status === 'pdf_exported') {
      if (!record.pdfPath || !fs.existsSync(record.pdfPath)) {
        try {
          const pdfPath = await docsLib.exportPdf(
            drive,
            record.documentId,
            path.join(outputRoot, record.pdfFilename)
          );
          record = store.save({ ...record, pdfPath, error: null });
        } catch (error) {
          store.save({ ...record, error: error.message });
          throw publicationError('The published PDF is missing and could not be restored', error);
        }
      }
      return completeTracking(record, sheets, trackingSheetId);
    }

    if (record.status === 'doc_created' || record.status === 'failed') {
      try {
        await cleanupIncomplete({ record, drive, docsLib });
        record = store.save({
          ...record,
          status: 'prepared',
          documentId: null,
          docLink: null,
          error: null,
          cleanupRequired: false,
        });
      } catch (error) {
        store.save({ ...record, status: 'failed', error: error.message, cleanupRequired: true });
        throw publicationError('The previous incomplete publication could not be cleaned up', error, {
          cleanupRequired: true,
        });
      }
    }

    if (!record.finalBaseName) {
      const baseName = naming.buildBaseName({ company, role });
      const [sheetNames, folderNames, localNames] = await Promise.all([
        sheetsLib.checkNameCollision(sheets, trackingSheetId, baseName),
        docsLib.listFilesInFolder(drive, outputFolderId),
        fs.promises.readdir(outputRoot).catch((error) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        }),
      ]);
      const finalBaseName = naming.resolveCollision(
        baseName,
        [...sheetNames, ...folderNames, ...localNames]
      );
      const pdfFilename = naming.toPdfFilename(finalBaseName);
      record = store.save({
        ...record,
        finalBaseName,
        pdfFilename,
        pdfPath: path.resolve(outputRoot, pdfFilename),
        trackingDate: naming.formatDate(),
      });
    }

    let documentId = record.documentId;
    try {
      const interruptedCopy = await docsLib.findFileByGenerationId(drive, generationId);
      if (interruptedCopy?.id) await docsLib.trashFile(drive, interruptedCopy.id);

      documentId = await docsLib.copyTemplate(drive, {
        templateDocId,
        outputFolderId,
        name: record.finalBaseName,
        generationId,
      });
      const docLink = docsLib.getDocLink(documentId);
      record = store.save({
        ...record,
        status: 'doc_created',
        documentId,
        docLink,
        error: null,
      });

      await docsLib.replaceTokens(docs, documentId, tokenValues);
      const pdfPath = await docsLib.exportPdf(drive, documentId, record.pdfPath);
      record = store.save({
        ...record,
        status: 'pdf_exported',
        pdfPath,
        error: null,
        cleanupRequired: false,
      });
    } catch (error) {
      const incomplete = { ...record, documentId: documentId || record.documentId };
      let cleanupError = null;
      try {
        await cleanupIncomplete({ record: incomplete, drive, docsLib });
      } catch (caught) {
        cleanupError = caught;
      }

      if (cleanupError) {
        store.save({
          ...incomplete,
          status: 'failed',
          error: `${error.message}; cleanup failed: ${cleanupError.message}`,
          cleanupRequired: true,
        });
        throw publicationError(
          'Resume publication failed and some partial files require cleanup',
          cleanupError,
          { cleanupRequired: true }
        );
      }

      store.save({
        ...incomplete,
        status: 'failed',
        documentId: null,
        docLink: null,
        error: error.message,
        cleanupRequired: false,
      });
      throw publicationError('Resume publication failed and its partial files were cleaned up', error);
    }

    return completeTracking(record, sheets, trackingSheetId);
  }

  return async function publish(input) {
    const generationId = input?.generationId;
    if (inFlight.has(generationId)) {
      const result = await inFlight.get(generationId);
      return { ...result, reused: true };
    }
    const operation = publicationQueue
      .then(() => perform(input))
      .finally(() => inFlight.delete(generationId));
    publicationQueue = operation.catch(() => {});
    inFlight.set(generationId, operation);
    return operation;
  };
}
