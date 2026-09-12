import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns, parseCsv, readUtf8Strict, rowsToRecords } from '../csv/csv.mjs';
import {
  INITIAL_CSV_RECORD_LIMIT,
  loadInitialPending,
  saveInitialPending,
  takeInitialPackage
} from './initial-pending.mjs';

const columns = loadColumns(process.cwd());
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-confirmed-csv-'));
const filePath = path.join(tempRoot, 'confirmed', 'confirmed.csv');
const fixture = (index) => ({
  ...Object.fromEntries(columns.map((column) => [column, ''])),
  title_ja: `確定作品${index}`,
  media_type: 'TV',
  external_ids: `fixture::${index}`,
  updated_at: '2026-09-10'
});

assert.equal(INITIAL_CSV_RECORD_LIMIT, 500);
assert.equal(takeInitialPackage(Array.from({ length: 499 }, (_, index) => fixture(index))).selected.length, 0);
const packaged = takeInitialPackage(Array.from({ length: 501 }, (_, index) => fixture(index)));
assert.equal(packaged.selected.length, 500);
assert.equal(packaged.remaining.length, 1);
const geminiStaged = Array.from({ length: 500 }, (_, index) => ({ ...fixture(index), synopsis: index < 499 ? '概要' : '' }));
assert.equal(takeInitialPackage(geminiStaged, { requireSynopsis: true }).selected.length, 0);
assert.deepEqual(loadInitialPending(filePath, columns).records, []);
assert.equal(saveInitialPending(filePath, [fixture(1)], columns), true);
assert.equal(loadInitialPending(filePath, columns).records.length, 1);
assert.equal(saveInitialPending(filePath, [fixture(1)], columns), false);
assert.equal(loadInitialPending(filePath, columns).records[0].id, '');
assert.deepEqual(rowsToRecords(parseCsv(readUtf8Strict(filePath)), columns), loadInitialPending(filePath, columns).records, 'confirmed staging must be an actual common-schema CSV');

const largePath = path.join(tempRoot, 'confirmed', 'large.csv');
const smallColumns = ['id', 'title_ja', 'media_type'];
const largeConfirmed = Array.from({ length: 20001 }, (_, index) => ({ id: '', title_ja: `大量作品${index}`, media_type: 'TV' }));
assert.equal(saveInitialPending(largePath, largeConfirmed, smallColumns), true);
assert.equal(loadInitialPending(largePath, smallColumns).records.length, 20001, 'confirmed records must not silently stop at 20,000');

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('Confirmed CSV staging self-test: PASS');
console.log('public CSV package size: 500');
console.log('confirmed records persist as CSV before public release: PASS');
console.log('confirmed CSV over 20k: PRESERVED');
