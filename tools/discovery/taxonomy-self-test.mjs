import assert from 'node:assert/strict';
import { loadColumns } from '../csv/csv.mjs';
import { validateRecords } from '../validate/data-validator.mjs';
import { extractCandidateEvidence, resolveEvidence } from './evidence.mjs';
import { candidateToCommonRecord } from './to-record.mjs';
import {
  ANIME_GENRES,
  ORIGINAL_TYPES,
  detectOriginalType,
  normalizeGenresFromText
} from './taxonomy.mjs';

for (const required of ['学園', 'ほのぼの', '百合', 'BL', '異世界', '魔法少女', 'ロボット', 'ラブコメ']) {
  assert.ok(ANIME_GENRES.includes(required), `required genre missing: ${required}`);
}
for (const forbidden of ['深夜アニメ', '朝アニメ', '夕方アニメ', 'ゴールデン帯']) {
  assert.equal(ANIME_GENRES.includes(forbidden), false, `broadcast-time label leaked into genres: ${forbidden}`);
}

const normalizedGenres = normalizeGenresFromText('ジャンル：学園モノ / ほのぼの系 / 百合系 / BL系 / ラブコメ');
for (const expected of ['学園', 'ほのぼの', '百合', 'BL', 'ラブコメ', '恋愛', 'コメディ']) {
  assert.ok(normalizedGenres.includes(expected), `genre normalization missing: ${expected}`);
}
assert.deepEqual(normalizeGenresFromText('深夜アニメ 朝アニメ 夕方アニメ ゴールデン帯'), []);

for (const required of ['なろう系', 'ライトノベル系', 'Web小説系', '漫画系', 'ゲーム系', 'オリジナル']) {
  assert.ok(ORIGINAL_TYPES.includes(required), `required original type missing: ${required}`);
}
assert.equal(detectOriginalType('小説家になろう発。書籍版はライトノベル。'), 'なろう系');
assert.equal(detectOriginalType('ライトノベル原作のTVアニメ'), 'ライトノベル系');
assert.equal(detectOriginalType('Web小説を原作とする作品'), 'Web小説系');
assert.equal(detectOriginalType('原作タグ：ゲーム系'), 'ゲーム系');
assert.equal(detectOriginalType('原作：漫画「分類検証」'), '漫画系');

function fixtureDocument(url) {
  return {
    url,
    canonical: null,
    title: 'TVアニメ「花の教室」作品情報',
    ogTitle: '',
    description: '',
    keywords: '',
    text: [
      '日本のTVアニメ「花の教室」は2027年4月3日放送開始。',
      'ジャンル：学園モノ、ほのぼの系、百合系',
      '小説家になろう発の作品で、書籍版はライトノベル。',
      'アニメーション制作：Studio Flower'
    ].join('\n')
  };
}

const candidate = { key: '花の教室', title: '花の教室' };
const evidence = [
  ...extractCandidateEvidence(fixtureDocument('https://source-a.test/anime'), candidate, '2026-09-09T00:00:00.000Z'),
  ...extractCandidateEvidence(fixtureDocument('https://source-b.test/article'), candidate, '2026-09-09T00:00:00.000Z')
];
const facts = resolveEvidence(evidence);
assert.equal(facts.title_ja.status, 'confirmed');
assert.equal(facts.media_type.status, 'confirmed');
assert.equal(facts.origin_country.status, 'confirmed');
assert.equal(facts.origin_country.value, 'JP');
assert.equal(facts.release_start.value, '2027-04-03');
assert.equal(facts.original_type.status, 'confirmed');
assert.equal(facts.original_type.value, 'なろう系');
assert.equal(facts.genres.status, 'confirmed');
for (const expected of ['学園', 'ほのぼの', '百合']) {
  assert.ok(facts.genres.value.split('|').includes(expected), `confirmed genres missing: ${expected}`);
}
assert.equal(facts.genres.value.includes('深夜アニメ'), false);

const originalOnlyDocument = {
  url: 'https://origin-only.test/anime',
  canonical: null,
  title: 'TVアニメ「原作分類」作品情報',
  ogTitle: '',
  description: '',
  keywords: '',
  text: [
    '日本のTVアニメ「原作分類」は2027年4月3日放送開始。',
    '原作タグ：ゲーム系',
    'アニメーション制作：Studio Origin'
  ].join('\n')
};
const originalOnlyEvidence = extractCandidateEvidence(
  originalOnlyDocument,
  { key: '原作分類', title: '原作分類' },
  '2026-09-09T00:00:00.000Z'
);
assert.ok(originalOnlyEvidence.some((item) => item.field === 'original_type' && item.value === 'ゲーム系'));
assert.equal(originalOnlyEvidence.some((item) => item.field === 'genres' && item.value === 'ゲーム'), false);

const columns = loadColumns(process.cwd());
const commonRecord = candidateToCommonRecord({
  key: candidate.key,
  title: candidate.title,
  facts
}, columns, '2026-09-09');
assert.ok(commonRecord);
assert.equal(commonRecord.original_type, 'なろう系');
assert.ok(commonRecord.genres.split('|').includes('学園'));
assert.ok(commonRecord.genres.split('|').includes('ほのぼの'));
assert.ok(commonRecord.genres.split('|').includes('百合'));

const baseRecord = Object.fromEntries(columns.map((column) => [column, '']));
Object.assign(baseRecord, {
  id: 'A00000001',
  title_ja: '分類検証',
  media_type: 'TV',
  release_start: '2027-04-03',
  genres: '学園|ほのぼの|百合',
  original_type: 'なろう系',
  updated_at: '2026-09-09'
});
assert.deepEqual(validateRecords([{ fileName: 'initial-001.csv', record: baseRecord }], columns), []);

const multipleOriginal = { ...baseRecord, original_type: 'なろう系|ライトノベル系' };
assert.ok(validateRecords([{ fileName: 'initial-001.csv', record: multipleOriginal }], columns)
  .some((failure) => failure.includes('原作タグ1つのみ')));

const timeAsGenre = { ...baseRecord, genres: '学園|深夜アニメ' };
assert.ok(validateRecords([{ fileName: 'initial-001.csv', record: timeAsGenre }], columns)
  .some((failure) => failure.includes('genres 定義値外')));

console.log('Anime taxonomy self-test: PASS');
console.log('genre multi-select: PASS');
console.log('original type single-select: PASS');
console.log('original tags isolated from genres: PASS');
console.log('broadcast-time labels excluded from genres: PASS');
console.log('Japanese-origin gate retained in taxonomy fixture: PASS');
console.log('multi-source taxonomy evidence: PASS');