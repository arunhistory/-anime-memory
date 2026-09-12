import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, readUtf8Strict, recordsToCsv, rowsToRecords } from '../csv/csv.mjs';
import { hasExactExternalId } from '../normalize/record.mjs';
import { deduplicateIncoming } from './deduplicate.mjs';

function cleanRecord(input, columns) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('confirmed-record-invalid');
  const record = Object.fromEntries(columns.map((column) => [column, String(input[column] || '')]));
  if (!record.title_ja || !record.media_type) throw new Error('confirmed-required-field-missing');
  if (record.id && !/^A\d{8}$/.test(record.id)) throw new Error(`confirmed-id-invalid:${record.id}`);
  return record;
}

function nextIdFactory(records) {
  let max = 0;
  const used = new Set();
  for (const record of records) {
    const id = String(record?.id || '');
    if (!id) continue;
    if (!/^A\d{8}$/.test(id)) throw new Error(`confirmed-id-invalid:${id}`);
    if (used.has(id)) throw new Error(`confirmed-id-duplicate:${id}`);
    used.add(id);
    max = Math.max(max, Number(id.slice(1)));
  }
  return () => {
    max += 1;
    if (max > 99999999) throw new Error('内部IDの8桁上限に到達しました。');
    const id = `A${String(max).padStart(8, '0')}`;
    if (used.has(id)) throw new Error(`confirmed-id-duplicate:${id}`);
    used.add(id);
    return id;
  };
}

function mergeIntoMaster(masterRecords, incomingRecords, columns, fileName) {
  const existing = masterRecords.map((record) => ({ fileName: 'confirmed.csv', record }));
  const result = deduplicateIncoming(incomingRecords, existing, columns, { warn: () => {} });
  return {
    records: [
      ...result.workingExisting.map((entry) => entry.record),
      ...result.accepted
    ],
    stats: result.stats,
    source: fileName
  };
}

export function loadConfirmedCsv(filePath, columns) {
  if (!fs.existsSync(filePath)) return [];
  return rowsToRecords(parseCsv(readUtf8Strict(filePath)), columns).map((record) => cleanRecord(record, columns));
}

export function saveConfirmedCsv(filePath, records, columns) {
  if (!Array.isArray(records)) throw new Error('confirmed-records-invalid');
  const cleanRecords = records.map((record) => cleanRecord(record, columns));
  const text = recordsToCsv(cleanRecords, columns);
  if (fs.existsSync(filePath) && readUtf8Strict(filePath) === text) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tempPath, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  return true;
}

export function syncConfirmedMaster({
  current = [],
  identityRecords = [],
  publicEntries = [],
  columns
} = {}) {
  if (!Array.isArray(columns) || !columns.length) throw new Error('confirmed-columns-required');
  let master = (Array.isArray(current) ? current : []).map((record) => cleanRecord(record, columns));

  // Existing public rows are also confirmed works. This makes migration from an older
  // repository state lossless if public data exists before confirmed/confirmed.csv.
  const publicRecords = (Array.isArray(publicEntries) ? publicEntries : [])
    .map((entry) => entry?.record)
    .filter(Boolean)
    .map((record) => cleanRecord(record, columns));
  const publicMerge = mergeIntoMaster(master, publicRecords, columns, 'public');
  master = publicMerge.records;

  const identityMerge = mergeIntoMaster(
    master,
    (Array.isArray(identityRecords) ? identityRecords : []).map((record) => cleanRecord(record, columns)),
    columns,
    'identity'
  );
  master = identityMerge.records;

  const nextId = nextIdFactory(master);
  for (const record of master) {
    if (!record.id) record.id = nextId();
  }

  // Re-run ID validation after assignment and preserve deterministic insertion order.
  nextIdFactory(master);
  return {
    records: master,
    publicMergeStats: publicMerge.stats,
    identityMergeStats: identityMerge.stats
  };
}

export function attachConfirmedIds(records, confirmedRecords) {
  const master = Array.isArray(confirmedRecords) ? confirmedRecords : [];
  return (Array.isArray(records) ? records : []).map((record) => {
    const match = master.find((confirmed) => hasExactExternalId(confirmed, record));
    if (!match?.id) {
      throw new Error(`公開候補に対応する作品確定CSVのIDがありません: ${record?.title_ja || '(empty)'}`);
    }
    return { ...record, id: match.id };
  });
}
