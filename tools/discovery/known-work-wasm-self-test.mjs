import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns, recordsToCsv } from '../csv/csv.mjs';
import { loadKnownWorkWasmSearch } from './known-work-wasm.mjs';

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-known-work-wasm-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const columns = loadColumns(root);
const blankRecord = () => Object.fromEntries(columns.map((column) => [column, '']));

const first = blankRecord();
first.id = 'A00000001';
first.title_ja = '星の旅';
first.title_kana = 'ほしのたび';
first.title_romaji = 'Hoshi no Tabi';
first.title_en = 'Star Journey';
first.aliases = 'スター・ジャーニー|星旅';
first.media_type = 'TV';
first.release_start = '2027-04-03';
first.animation_studio = 'Studio Star';
first.director = '星野監督';
first.updated_at = '2026-09-10';

const second = blankRecord();
second.id = 'A00000002';
second.title_ja = '海の灯';
second.media_type = 'MOVIE';
second.theatrical_release_date = '2028-01-01';
second.updated_at = '2026-09-10';

fs.writeFileSync(path.join(dataDir, 'initial-001.csv'), recordsToCsv([first, second], columns), 'utf8');

try {
  const search = await loadKnownWorkWasmSearch({ root, dataDir });
  assert.equal(search.available, true);
  assert.equal(search.fileCount, 1);
  assert.equal(search.hasExactTitle('星の旅'), true, 'title_ja must be found by search.wasm title group');
  assert.equal(search.hasExactTitle('ほしのたび'), true, 'title_kana must be found by search.wasm title group');
  assert.equal(search.hasExactTitle('Hoshi no Tabi'), true, 'title_romaji must be found by search.wasm title group');
  assert.equal(search.hasExactTitle('Star Journey'), true, 'title_en must be found by search.wasm title group');
  assert.equal(search.hasExactTitle('スター・ジャーニー'), true, 'aliases must be token-matched by search.wasm');
  assert.equal(search.hasExactTitle('星旅'), true, 'second alias must be token-matched by search.wasm');
  assert.equal(search.hasExactTitle('星'), false, 'partial title must not be treated as an existing work');
  assert.equal(search.hasExactTitle('未知の作品'), false);
  const match = search.findExactTitle('海の灯', 5);
  assert.equal(match.length, 1);
  assert.equal(match[0].id, 'A00000002');

  const record = search.findUniqueExactRecord('スター・ジャーニー');
  assert.ok(record, 'unique alias must resolve back to its full registered record');
  assert.equal(record.id, 'A00000001');
  assert.equal(record.title_ja, '星の旅');
  assert.equal(record.animation_studio, 'Studio Star');
  assert.equal(record.director, '星野監督');
  assert.equal(search.getRecordById('A00000002')?.title_ja, '海の灯');
  assert.equal(search.getRecordById('invalid'), null);

  const emptyDir = path.join(temp, 'empty');
  fs.mkdirSync(emptyDir, { recursive: true });
  const emptySearch = await loadKnownWorkWasmSearch({ root, dataDir: emptyDir });
  assert.equal(emptySearch.available, false);
  assert.equal(emptySearch.hasExactTitle('星の旅'), false);
  assert.equal(emptySearch.findUniqueExactRecord('星の旅'), null);

  console.log('Known-work search WASM self-test: PASS');
  console.log('existing title lookup: search.wasm');
  console.log('full registered-record teacher lookup: PASS');
  console.log('title_ja/kana/romaji/en/aliases exact reuse: PASS');
  console.log('partial-title false positive: BLOCKED');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
