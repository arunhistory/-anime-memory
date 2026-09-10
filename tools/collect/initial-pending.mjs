import fs from 'node:fs';
import path from 'node:path';

export const INITIAL_CSV_RECORD_LIMIT = 500;
export const INITIAL_PENDING_RECORD_LIMIT = 20000;

function cleanRecord(input, columns) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('initial-pending-record-invalid');
  const record = Object.fromEntries(columns.map((column) => [column, String(input[column] || '')]));
  record.id = '';
  if (!record.title_ja || !record.media_type) throw new Error('initial-pending-required-field-missing');
  return record;
}

export function emptyInitialPending() {
  return { version: 1, records: [], updatedAt: '' };
}

export function takeInitialPackage(records, { requireSynopsis = false } = {}) {
  const source = Array.isArray(records) ? records : [];
  const publishable = requireSynopsis
    ? source.filter((record) => String(record?.synopsis || '').trim())
    : source;
  if (publishable.length < INITIAL_CSV_RECORD_LIMIT) return { selected: [], remaining: source };
  const selected = publishable.slice(0, INITIAL_CSV_RECORD_LIMIT);
  const selectedSet = new Set(selected);
  return {
    selected,
    remaining: source.filter((record) => !selectedSet.has(record))
  };
}

export function loadInitialPending(filePath, columns) {
  if (!fs.existsSync(filePath)) return emptyInitialPending();
  const input = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!input || input.version !== 1 || !Array.isArray(input.records)) throw new Error('initial-pending-state-invalid');
  if (input.records.length > INITIAL_PENDING_RECORD_LIMIT) throw new Error('initial-pending-record-limit-exceeded');
  return {
    version: 1,
    records: input.records.map((record) => cleanRecord(record, columns)),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : ''
  };
}

export function saveInitialPending(filePath, records, columns, now = new Date()) {
  if (!Array.isArray(records) || records.length > INITIAL_PENDING_RECORD_LIMIT) {
    throw new Error('initial-pending-record-limit-exceeded');
  }
  const cleanRecords = records.map((record) => cleanRecord(record, columns));
  if (fs.existsSync(filePath)) {
    const current = loadInitialPending(filePath, columns);
    if (JSON.stringify(current.records) === JSON.stringify(cleanRecords)) return false;
  } else if (cleanRecords.length === 0) {
    return false;
  }
  const output = {
    version: 1,
    records: cleanRecords,
    updatedAt: now.toISOString()
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  return true;
}
