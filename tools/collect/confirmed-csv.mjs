import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, readUtf8Strict, recordsToCsv, rowsToRecords } from '../csv/csv.mjs';
import {
  externalIdSet,
  mergeOnlyBlank,
  normalizeText,
  releaseIdentitySet,
  titleSet
} from '../normalize/record.mjs';

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

function compositeKeys(record) {
  const media = String(record?.media_type || '');
  if (!media) return [];
  const titles = [...titleSet(record)];
  const releases = [...releaseIdentitySet(record)];
  if (!titles.length || !releases.length) return [];
  const corroborators = [
    ['original_title', normalizeText(record?.original_title)],
    ['original_author', normalizeText(record?.original_author)],
    ['animation_studio', normalizeText(record?.animation_studio)]
  ].filter(([, value]) => value);
  const keys = [];
  for (const title of titles) {
    for (const release of releases) {
      for (const [field, value] of corroborators) keys.push(`${title}\u0000${media}\u0000${release}\u0000${field}\u0000${value}`);
    }
  }
  return keys;
}

function addIndexValue(map, key, index) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(index);
}

function buildLookup(records) {
  const byExternalId = new Map();
  const byComposite = new Map();
  for (let index = 0; index < records.length; index += 1) {
    for (const id of externalIdSet(records[index])) addIndexValue(byExternalId, id, index);
    for (const key of compositeKeys(records[index])) addIndexValue(byComposite, key, index);
  }
  return { byExternalId, byComposite };
}

function lookupIndices(map, keys) {
  const found = new Set();
  for (const key of keys) {
    for (const index of map.get(key) || []) found.add(index);
  }
  return [...found];
}

function indexRecord(lookup, record, index) {
  for (const id of externalIdSet(record)) addIndexValue(lookup.byExternalId, id, index);
  for (const key of compositeKeys(record)) addIndexValue(lookup.byComposite, key, index);
}

function mergeRecords(master, incoming, columns) {
  const lookup = buildLookup(master);
  const stats = { exactMerged: 0, compositeSkipped: 0, added: 0 };

  for (const raw of incoming) {
    const record = cleanRecord(raw, columns);
    const exact = lookupIndices(lookup.byExternalId, externalIdSet(record));
    if (exact.length > 1) throw new Error(`confirmed-external-id-ambiguous:${record.title_ja}`);
    if (exact.length === 1) {
      const index = exact[0];
      master[index] = mergeOnlyBlank(master[index], record, columns);
      indexRecord(lookup, master[index], index);
      stats.exactMerged += 1;
      continue;
    }

    const composite = lookupIndices(lookup.byComposite, compositeKeys(record));
    if (composite.length) {
      // Composite identity is deliberately not enough to merge or add a second row.
      stats.compositeSkipped += 1;
      continue;
    }

    const index = master.length;
    master.push(record);
    indexRecord(lookup, record, index);
    stats.added += 1;
  }
  return { records: master, stats };
}

export function loadConfirmedCsv(filePath, columns) {
  if (!fs.existsSync(filePath)) return [];
  const records = rowsToRecords(parseCsv(readUtf8Strict(filePath)), columns).map((record) => cleanRecord(record, columns));
  nextIdFactory(records);
  return records;
}

export function saveConfirmedCsv(filePath, records, columns) {
  if (!Array.isArray(records)) throw new Error('confirmed-records-invalid');
  const cleanRecords = records.map((record) => cleanRecord(record, columns));
  nextIdFactory(cleanRecords);
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

  const publicRecords = (Array.isArray(publicEntries) ? publicEntries : [])
    .map((entry) => entry?.record)
    .filter(Boolean)
    .map((record) => cleanRecord(record, columns));
  const publicMerge = mergeRecords(master, publicRecords, columns);
  master = publicMerge.records;

  const identityMerge = mergeRecords(
    master,
    (Array.isArray(identityRecords) ? identityRecords : []).map((record) => cleanRecord(record, columns)),
    columns
  );
  master = identityMerge.records;

  const nextId = nextIdFactory(master);
  for (const record of master) {
    if (!record.id) record.id = nextId();
  }
  nextIdFactory(master);

  return {
    records: master,
    publicMergeStats: publicMerge.stats,
    identityMergeStats: identityMerge.stats
  };
}

function resolveConfirmedIndex(lookup, record) {
  const exact = lookupIndices(lookup.byExternalId, externalIdSet(record));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`作品確定CSVで外部IDが重複しています: ${record?.title_ja || '(empty)'}`);

  const composite = lookupIndices(lookup.byComposite, compositeKeys(record));
  if (composite.length === 1) return composite[0];
  if (composite.length > 1) throw new Error(`作品確定CSVで公開候補の対応先が一意ではありません: ${record?.title_ja || '(empty)'}`);
  return -1;
}

export function attachConfirmedIds(records, confirmedRecords) {
  const master = Array.isArray(confirmedRecords) ? confirmedRecords : [];
  const lookup = buildLookup(master);
  return (Array.isArray(records) ? records : []).map((record) => {
    const index = resolveConfirmedIndex(lookup, record);
    const match = index >= 0 ? master[index] : null;
    if (!match?.id) {
      throw new Error(`公開候補に対応する作品確定CSVのIDがありません: ${record?.title_ja || '(empty)'}`);
    }
    return { ...record, id: match.id };
  });
}
