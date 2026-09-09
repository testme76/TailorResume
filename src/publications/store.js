import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIRECTORY = path.resolve(__dirname, '..', '..', 'data', 'publications');
const GENERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidGenerationId(value) {
  return typeof value === 'string' && GENERATION_ID_PATTERN.test(value);
}

export class PublicationStore {
  constructor(directory = DEFAULT_DIRECTORY) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
  }

  filePath(generationId) {
    if (!isValidGenerationId(generationId)) throw new Error('Invalid generationId.');
    return path.join(this.directory, `${generationId}.json`);
  }

  get(generationId) {
    const filePath = this.filePath(generationId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  create({ generationId, company, role }) {
    if (this.get(generationId)) throw new Error(`Publication already exists: ${generationId}`);
    const now = new Date().toISOString();
    return this.save({
      generationId,
      status: 'prepared',
      company,
      role,
      createdAt: now,
      updatedAt: now,
    });
  }

  save(record) {
    const destination = this.filePath(record.generationId);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    const value = { ...record, updatedAt: new Date().toISOString() };
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
      fs.renameSync(temporary, destination);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    return value;
  }
}
