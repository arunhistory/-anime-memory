import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns, parseCsv, recordsToCsv, rowsToRecords, writeManifest } from '../csv/csv.mjs';
import { normalizeSourceItem, hasExactExternalId, isCompositeDuplicateCandidate } from '../normalize/record.mjs';
import { validateDataDirectory } from '../validate/data-validator.mjs';
import { collectSource } from '../fetch/http-json.mjs';

const root = process.cwd();
const columns = loadColumns(root);
assert.equal(columns.length, 70);

const roundTripRecord = Object.fromEntries(columns.map((column) => [column, '']));
roundTripRecord.id = 'A00000001';
roundTripRecord.title_ja = 'テスト,作品\n改行';
roundTripRecord.media_type = 'TV';
roundTripRecord.updated_at = '2026-09-09';
const roundTripCsv = recordsToCsv([roundTripRecord], columns);
const parsed = rowsToRecords(parseCsv(roundTripCsv), columns);
assert.equal(parsed[0].title_ja, roundTripRecord.title_ja);

const source = {
  name: 'fixture',
  externalIdNamespace: 'fixture',
  externalIdPath: 'id',
  mapping: {
    title_ja: 'title.native',
    media_type: { path: 'format', mapValues: { TV: 'TV' } },
    aliases: { path: 'aliases' },
    characters: { path: 'cast', fields: ['character', 'role', 'actor'] },
    release_start: 'start',
    original_title: 'original.title',
    animation_studio: 'studio'
  }
};
const normalized = normalizeSourceItem({
  id: 10,
  title: { native: '試験アニメ' },
  format: 'TV',
  aliases: ['試験', 'テスト'],
  cast: [{ character: '主人公', role: 'MAIN', actor: '声優A' }],
  start: '2027-04-01',
  original: { title: '試験原作' },
  studio: 'Studio Test'
}, source, columns, '2026-09-09');
assert.equal(normalized.external_ids, 'fixture::10');
assert.equal(normalized.aliases, '試験|テスト');
assert.equal(normalized.characters, '主人公::MAIN::声優A');

const sameExternal = { ...normalized, title_ja: '別表記' };
assert.equal(hasExactExternalId(normalized, sameExternal), true);
const composite = { ...normalized, external_ids: '', aliases: '' };
assert.equal(isCompositeDuplicateCandidate(normalized, composite), true);

await assert.rejects(
  () => collectSource({ name: 'bad', url: 'https://example.com', transport: 'html-scrape', policy: {} }),
  /API JSON以外/
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-data-test-'));
const dataDir = path.join(tempRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const validRecord = Object.fromEntries(columns.map((column) => [column, '']));
Object.assign(validRecord, {
  id: 'A00000001',
  title_ja: '検証作品',
  media_type: 'TV',
  release_start: '2027-04-01',
  external_ids: 'fixture::1',
  updated_at: '2026-09-09'
});
fs.writeFileSync(path.join(dataDir, 'initial-001.csv'), recordsToCsv([validRecord], columns), 'utf8');
writeManifest(dataDir);
assert.deepEqual(validateDataDirectory(dataDir).failures, []);

const badRecord = { ...validRecord, id: 'A00000002', media_type: 'INVALID', external_ids: 'fixture::2' };
fs.writeFileSync(path.join(dataDir, 'initial-002.csv'), recordsToCsv([badRecord], columns), 'utf8');
writeManifest(dataDir);
assert.ok(validateDataDirectory(dataDir).failures.some((value) => value.includes('media_type')));
fs.rmSync(tempRoot, { recursive: true, force: true });

const collectorSource = fs.readFileSync(path.join(root, 'tools/collect/run.mjs'), 'utf8');
for (const forbidden of ['GEMINI_API_KEY', 'generativelanguage.googleapis.com', '@google/generative-ai']) {
  assert.equal(collectorSource.includes(forbidden), false, `Gemini connection found: ${forbidden}`);
}

console.log('Data collection self-test: PASS');
console.log('Gemini connection: NONE');
