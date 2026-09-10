import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns } from '../csv/csv.mjs';
import {
  INITIAL_CSV_RECORD_LIMIT,
  loadInitialPending,
  saveInitialPending,
  takeInitialPackage
} from './initial-pending.mjs';

const columns = loadColumns(process.cwd());
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-initial-pending-'));
const filePath = path.join(tempRoot, 'crawler', 'pending-initial.json');
const fixture = (index) => ({
  ...Object.fromEntries(columns.map((column) => [column, ''])),
  title_ja: `途中作品${index}`,
  media_type: 'TV',
  external_ids: `fixture::${index}`,
  updated_at: '2026-09-10'
});

assert.equal(INITIAL_CSV_RECORD_LIMIT, 450);
assert.equal(takeInitialPackage(Array.from({ length: 449 }, (_, index) => fixture(index))).selected.length, 0);
const packaged = takeInitialPackage(Array.from({ length: 451 }, (_, index) => fixture(index)));
assert.equal(packaged.selected.length, 450);
assert.equal(packaged.remaining.length, 1);
const geminiStaged = Array.from({ length: 450 }, (_, index) => ({ ...fixture(index), synopsis: index < 449 ? '概要' : '' }));
assert.equal(takeInitialPackage(geminiStaged, { requireSynopsis: true }).selected.length, 0);
assert.deepEqual(loadInitialPending(filePath, columns).records, []);
assert.equal(saveInitialPending(filePath, [fixture(1)], columns, new Date('2026-09-10T00:00:00Z')), true);
assert.equal(loadInitialPending(filePath, columns).records.length, 1);
assert.equal(saveInitialPending(filePath, [fixture(1)], columns, new Date('2026-09-10T01:00:00Z')), false);
assert.equal(loadInitialPending(filePath, columns).records[0].id, '');

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('Initial pending self-test: PASS');
console.log('CSV package size: 450');
console.log('partial records persist without public CSV: PASS');
