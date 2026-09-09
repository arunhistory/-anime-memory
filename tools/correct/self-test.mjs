import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns, recordsToCsv, writeManifest, parseCsv, rowsToRecords, readUtf8Strict } from '../csv/csv.mjs';
import { applyManualCorrection } from './run.mjs';

const repoRoot = process.cwd();
const columns = loadColumns(repoRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-correct-'));
fs.mkdirSync(path.join(temp, 'wasm-src', 'shared'), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, 'wasm-src', 'shared', 'schema.hpp'),
  path.join(temp, 'wasm-src', 'shared', 'schema.hpp')
);
fs.mkdirSync(path.join(temp, 'data'), { recursive: true });

const record = Object.fromEntries(columns.map((column) => [column, '']));
Object.assign(record, {
  id: 'A00000001',
  title_ja: '修正試験作品',
  media_type: 'TV',
  release_start: '2027-04-01',
  genres: '学園',
  original_type: '漫画系',
  synopsis: '既存概要',
  updated_at: '2026-09-08'
});
fs.writeFileSync(path.join(temp, 'data', 'initial-001.csv'), recordsToCsv([record], columns), 'utf8');
writeManifest(path.join(temp, 'data'));

const changed = applyManualCorrection({
  root: temp,
  internalId: 'A00000001',
  field: 'genres',
  operation: 'replace',
  value: '学園|ほのぼの|百合',
  updatedAt: '2026-09-09'
});
assert.equal(changed.changed, true);
assert.equal(changed.fileName, 'initial-001.csv');

let rows = rowsToRecords(parseCsv(readUtf8Strict(path.join(temp, 'data', 'initial-001.csv'))), columns);
assert.equal(rows[0].genres, '学園|ほのぼの|百合');
assert.equal(rows[0].updated_at, '2026-09-09');
assert.equal(rows[0].synopsis, '既存概要', 'unrelated fields must be preserved');

const noChange = applyManualCorrection({
  root: temp,
  internalId: 'A00000001',
  field: 'genres',
  operation: 'replace',
  value: '学園|ほのぼの|百合',
  updatedAt: '2026-09-10'
});
assert.equal(noChange.changed, false, 'same-value correction must not churn updated_at');
rows = rowsToRecords(parseCsv(readUtf8Strict(path.join(temp, 'data', 'initial-001.csv'))), columns);
assert.equal(rows[0].updated_at, '2026-09-09');

const beforeInvalid = fs.readFileSync(path.join(temp, 'data', 'initial-001.csv'));
assert.throws(() => applyManualCorrection({
  root: temp,
  internalId: 'A00000001',
  field: 'original_type',
  operation: 'replace',
  value: 'なろう系|ライトノベル系',
  updatedAt: '2026-09-10'
}), /全CSV検証に失敗/);
assert.deepEqual(fs.readFileSync(path.join(temp, 'data', 'initial-001.csv')), beforeInvalid, 'failed correction must roll back bytes');

assert.throws(() => applyManualCorrection({
  root: temp,
  internalId: 'A00000001',
  field: 'id',
  operation: 'replace',
  value: 'A00000002'
}), /手動修正できません/);
assert.throws(() => applyManualCorrection({
  root: temp,
  internalId: 'A00000001',
  field: 'updated_at',
  operation: 'replace',
  value: '2026-09-10'
}), /手動修正できません/);

const cleared = applyManualCorrection({
  root: temp,
  internalId: 'A00000001',
  field: 'synopsis',
  operation: 'clear',
  updatedAt: '2026-09-10'
});
assert.equal(cleared.changed, true);
rows = rowsToRecords(parseCsv(readUtf8Strict(path.join(temp, 'data', 'initial-001.csv'))), columns);
assert.equal(rows[0].synopsis, '');
assert.equal(rows[0].updated_at, '2026-09-10');

assert.throws(() => applyManualCorrection({
  root: temp,
  internalId: 'A99999999',
  field: 'genres',
  value: '学園'
}), /見つかりません/);

fs.rmSync(temp, { recursive: true, force: true });
console.log('Manual correction self-test: PASS');
console.log('single-field replacement: PASS');
console.log('same-value no-op: PASS');
console.log('invalid correction rollback: PASS');
console.log('protected id/updated_at: PASS');
console.log('clear optional field: PASS');
