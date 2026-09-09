import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns, parseCsv, recordsToCsv, rowsToRecords, writeManifest, readUtf8Strict } from '../csv/csv.mjs';
import { normalizeSourceItem, hasExactExternalId, isCompositeDuplicateCandidate, splitStructured } from '../normalize/record.mjs';
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
  cast: [{ character: '主人公|A', role: 'MAIN::ALT', actor: '声優\\A' }],
  start: '2027-04-01',
  original: { title: '試験原作' },
  studio: 'Studio Test'
}, source, columns, '2026-09-09');
assert.equal(normalized.external_ids, 'fixture::10');
assert.equal(normalized.aliases, '試験|テスト');
assert.deepEqual(splitStructured(normalized.characters), [['主人公|A', 'MAIN::ALT', '声優\\A']]);

const sameExternal = { ...normalized, title_ja: '別表記' };
assert.equal(hasExactExternalId(normalized, sameExternal), true);
const composite = { ...normalized, external_ids: '', aliases: '' };
assert.equal(isCompositeDuplicateCandidate(normalized, composite), true);

const theatricalA = {
  ...normalized,
  external_ids: '',
  media_type: 'MOVIE',
  release_start: '',
  theatrical_release_date: '2027-08-01',
  title_ja: '劇場テスト',
  aliases: ''
};
const theatricalB = { ...theatricalA, animation_studio: 'Studio Test' };
assert.equal(isCompositeDuplicateCandidate(theatricalA, theatricalB), true);

await assert.rejects(
  () => collectSource({ name: 'bad', url: 'https://example.com', transport: 'html-scrape', policy: {} }),
  /API JSON以外/
);

const approvedPolicy = {
  apiTermsChecked: true,
  commercialUse: true,
  redistribution: true,
  imageUse: true,
  rateLimitChecked: true
};
await assert.rejects(
  () => collectSource({
    name: 'secret-literal',
    url: 'https://example.com/api',
    transport: 'api-json',
    policy: approvedPolicy,
    headers: { Authorization: 'Bearer must-not-be-inline' }
  }),
  /env参照/
);

const originalFetch = globalThis.fetch;
let mockedRequests = 0;
globalThis.fetch = async () => {
  mockedRequests += 1;
  if (mockedRequests === 1) {
    return new Response(JSON.stringify({ items: [{ id: 1, title: '成功分' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  throw new Error('mock network stop');
};
try {
  const partial = await collectSource({
    name: 'safe-stop-fixture',
    url: 'https://fixture.invalid/anime',
    transport: 'api-json',
    policy: approvedPolicy,
    itemsPath: 'items',
    pagination: { type: 'page', param: 'page', start: 1 },
    maxRequests: 3
  });
  assert.equal(partial.items.length, 1);
  assert.equal(partial.stoppedEarly, true);
  assert.match(partial.stopReason, /mock network stop/);
} finally {
  globalThis.fetch = originalFetch;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-data-test-'));
const dataDir = path.join(tempRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const validRecord = Object.fromEntries(columns.map((column) => [column, '']));
Object.assign(validRecord, {
  id: 'A00000001',
  title_ja: '検証作品',
  media_type: 'TV',
  release_start: '2027-04-01',
  characters: normalized.characters,
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
fs.rmSync(path.join(dataDir, 'initial-002.csv'));
writeManifest(dataDir);

const movieA = Object.fromEntries(columns.map((column) => [column, '']));
Object.assign(movieA, {
  id: 'A00000002',
  title_ja: '劇場重複検証',
  media_type: 'MOVIE',
  theatrical_release_date: '2027-08-01',
  animation_studio: 'Studio Movie',
  updated_at: '2026-09-09'
});
const movieB = { ...movieA, id: 'A00000003' };
fs.writeFileSync(path.join(dataDir, 'initial-002.csv'), recordsToCsv([movieA, movieB], columns), 'utf8');
writeManifest(dataDir);
assert.ok(validateDataDirectory(dataDir).failures.some((value) => value.includes('作品重複候補')));

const invalidUtf8 = path.join(tempRoot, 'invalid-utf8.csv');
fs.writeFileSync(invalidUtf8, Buffer.from([0xff, 0xfe, 0xfd]));
assert.throws(() => readUtf8Strict(invalidUtf8), /UTF-8/);
fs.rmSync(tempRoot, { recursive: true, force: true });

const collectorSource = fs.readFileSync(path.join(root, 'tools/collect/run.mjs'), 'utf8');
const collectWorkflow = fs.readFileSync(path.join(root, '.github/workflows/data-collect.yml'), 'utf8');
assert.ok(collectorSource.includes("args.input || 'discovery'"), 'collector default input must be discovery');
assert.ok(collectorSource.includes("path.join(root, 'crawler', 'state.json')"), 'collector must read discovery state');
assert.ok(collectWorkflow.includes('default: discovery'), 'Actions collection input must default to discovery');
assert.ok(collectWorkflow.includes('--input'), 'Actions must pass collection input explicitly');

const integrationSource = [
  collectorSource,
  fs.readFileSync(path.join(root, 'tools/fetch/http-json.mjs'), 'utf8'),
  collectWorkflow
].join('\n');
assert.ok(integrationSource.includes('ANIME_GEMINI_API_KEY'), 'dedicated anime Gemini secret must be wired');
assert.ok(integrationSource.includes('--gemini true'), 'non-dry collection must enable synopsis generation');
assert.ok(integrationSource.includes('--gemini false'), 'dry-run must not spend Gemini quota');
assert.equal(integrationSource.includes('secrets.GEMINI_API_KEY'), false, 'generic Gemini secret must not be used');
assert.equal(integrationSource.includes('@google/generative-ai'), false, 'legacy Google SDK must not be coupled into collector');
assert.equal(integrationSource.includes('generativelanguage.googleapis.com'), false, 'Gemini endpoint must stay isolated in tools/gemini');

console.log('Data collection self-test: PASS');
console.log('discovery input default: PASS');
console.log('theatrical duplicate detection: PASS');
console.log('safe-stop partial collection: PASS');
console.log('dedicated Gemini secret wiring: PASS');
console.log('dry-run Gemini calls: NONE');
