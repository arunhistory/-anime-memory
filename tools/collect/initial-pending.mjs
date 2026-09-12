import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, readUtf8Strict, recordsToCsv, rowsToRecords } from '../csv/csv.mjs';

export const INITIAL_CSV_RECORD_LIMIT = 500;

function cleanRecord(input, columns) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('confirmed-record-invalid');
  const record = Object.fromEntries(columns.map((column) => [column, String(input[column] || '')]));
  record.id = '';
  if (!record.title_ja || !record.media_type) throw new Error('confirmed-required-field-missing');
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
  const records = rowsToRecords(parseCsv(readUtf8Strict(filePath)), columns).map((record) => cleanRecord(record, columns));
  return { version: 1, records, updatedAt: '' };
}

export function saveInitialPending(filePath, records, columns) {
  if (!Array.isArray(records)) throw new Error('confirmed-state-invalid');
  const cleanRecords = records.map((record) => cleanRecord(record, columns));
  const nextText = recordsToCsv(cleanRecords, columns);
  if (fs.existsSync(filePath) && readUtf8Strict(filePath) === nextText) return false;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, nextText, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  return true;
}
