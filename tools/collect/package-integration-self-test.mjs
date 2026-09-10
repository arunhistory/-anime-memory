import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadColumns, parseCsv, readUtf8Strict, rowsToRecords } from '../csv/csv.mjs';
import { emptyDiscoveryState } from '../discovery/state.mjs';
import { loadInitialPending, saveInitialPending } from './initial-pending.mjs';

const root = process.cwd();
const columns = loadColumns(root);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-package-integration-'));
fs.mkdirSync(path.join(tempRoot, 'wasm-src', 'shared'), { recursive: true });
fs.mkdirSync(path.join(tempRoot, 'crawler'), { recursive: true });
fs.copyFileSync(path.join(root, 'wasm-src', 'shared', 'schema.hpp'), path.join(tempRoot, 'wasm-src', 'shared', 'schema.hpp'));
fs.writeFileSync(path.join(tempRoot, 'crawler', 'state.json'), `${JSON.stringify(emptyDiscoveryState(), null, 2)}\n`, 'utf8');

const records = Array.from({ length: 501 }, (_, index) => ({
  ...Object.fromEntries(columns.map((column) => [column, ''])),
  title_ja: `統合試験作品${index + 1}`,
  media_type: 'TV',
  release_start: `2027-${String((index % 12) + 1).padStart(2, '0')}-01`,
  animation_studio: `試験スタジオ${index + 1}`,
  external_ids: `fixture::${index + 1}`,
  updated_at: '2026-09-10'
}));
saveInitialPending(path.join(tempRoot, 'crawler', 'pending-initial.json'), records, columns, new Date('2026-09-10T00:00:00Z'));

function runCollector() {
  return spawnSync(process.execPath, [path.join(root, 'tools', 'collect', 'run.mjs'), '--input', 'discovery', '--mode', 'initial', '--gemini', 'false'], {
    cwd: tempRoot,
    encoding: 'utf8'
  });
}

const first = runCollector();
assert.equal(first.status, 0, first.stderr || first.stdout);
const csvPath = path.join(tempRoot, 'data', 'initial-001.csv');
const csvRecords = rowsToRecords(parseCsv(readUtf8Strict(csvPath)), columns);
assert.equal(csvRecords.length, 500);
assert.equal(loadInitialPending(path.join(tempRoot, 'crawler', 'pending-initial.json'), columns).records.length, 1);
assert.equal(readUtf8Strict(path.join(tempRoot, 'data', 'manifest.csv')), 'file_name\r\ninitial-001.csv\r\n');

const second = runCollector();
assert.equal(second.status, 0, second.stderr || second.stdout);
assert.equal(fs.existsSync(path.join(tempRoot, 'data', 'initial-002.csv')), false);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('Initial package integration self-test: PASS');
console.log('501 pending -> 500 CSV + 1 pending: PASS');
console.log('manifest connection: PASS');
