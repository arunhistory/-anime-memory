import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns } from '../csv/csv.mjs';
import { attachConfirmedIds, loadConfirmedCsv, saveConfirmedCsv, syncConfirmedMaster } from './confirmed-csv.mjs';

const columns = loadColumns(process.cwd());
const blank = () => Object.fromEntries(columns.map((column) => [column, '']));
const identity = (index, extra = {}) => ({
  ...blank(),
  title_ja: `作品${index}`,
  media_type: 'TV',
  release_start: `2027-01-${String((index % 28) + 1).padStart(2, '0')}`,
  external_ids: `discovery::work-${index}`,
  updated_at: '2026-09-12',
  ...extra
});

const first = syncConfirmedMaster({
  current: [],
  identityRecords: [identity(1), identity(2)],
  publicEntries: [],
  columns
});
assert.equal(first.records.length, 2);
assert.deepEqual(first.records.map((record) => record.id), ['A00000001', 'A00000002']);

const second = syncConfirmedMaster({
  current: first.records,
  identityRecords: [identity(1, { director: '監督A' }), identity(3)],
  publicEntries: [],
  columns
});
assert.equal(second.records.length, 3);
assert.equal(second.records.find((record) => record.title_ja === '作品1').id, 'A00000001', 'confirmed ID must stay fixed');
assert.equal(second.records.find((record) => record.title_ja === '作品1').director, '監督A', 'later confirmed fields may fill blanks');
assert.equal(second.records.find((record) => record.title_ja === '作品3').id, 'A00000003');

const attached = attachConfirmedIds([identity(2)], second.records);
assert.equal(attached[0].id, 'A00000002', 'public candidate must reuse confirmed master ID');

const publicOnly = { ...identity(9), id: 'A00000009' };
const migrated = syncConfirmedMaster({ current: [], identityRecords: [], publicEntries: [{ fileName: 'initial-001.csv', record: publicOnly }], columns });
assert.equal(migrated.records.length, 1);
assert.equal(migrated.records[0].id, 'A00000009', 'pre-existing public records must migrate into confirmed master without ID change');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-confirmed-master-'));
const filePath = path.join(temp, 'confirmed', 'confirmed.csv');
assert.equal(saveConfirmedCsv(filePath, second.records, columns), true);
assert.equal(saveConfirmedCsv(filePath, second.records, columns), false, 'unchanged confirmed CSV must not churn');
assert.deepEqual(loadConfirmedCsv(filePath, columns), second.records);

const large = syncConfirmedMaster({
  current: [],
  identityRecords: Array.from({ length: 20001 }, (_, index) => identity(index + 100)),
  publicEntries: [],
  columns
});
assert.equal(large.records.length, 20001, 'confirmed master must not silently truncate at 20k');
assert.equal(large.records.at(-1).id, 'A00020001');

fs.rmSync(temp, { recursive: true, force: true });
console.log('Confirmed CSV master self-test: PASS');
console.log('identity-confirmed work -> confirmed/confirmed.csv: PASS');
console.log('stable internal ID before publication: PASS');
console.log('blank-only enrichment: PASS');
console.log('public copy reuses confirmed ID: PASS');
console.log('20k+ confirmed works: PRESERVED');
