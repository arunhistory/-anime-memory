import assert from 'node:assert/strict';
import {
  buildWebSearchLookup,
  indexWebDocument,
  sanitizeWebSearchIndex,
  searchOwnWebIndex
} from './web-search-index.mjs';

const manyCandidates = Array.from({ length: 80 }, (_, index) => ({
  key: `作品${index}`,
  title: `作品${index}`
}));
const index = [];
indexWebDocument(index, {
  url: 'https://catalog.example.jp/work',
  canonical: '',
  title: 'アニメ作品一覧と主題歌情報',
  ogTitle: '',
  description: '',
  keywords: '',
  text: '主題歌 オープニング エンディング 音楽',
  subjectCandidate: null,
  candidates: manyCandidates,
  noindex: false
}, '2026-09-12T00:00:00.000Z');

assert.equal(index.length, 1);
assert.equal(index[0].candidateKeys.length, 80, 'candidate keys must not be silently truncated by the search index');
const lookup = buildWebSearchLookup(index);
const last = searchOwnWebIndex(lookup, {
  title: '作品79',
  fields: ['opening_themes'],
  topic: 'music',
  limit: 10
});
assert.equal(last.length, 1, 'a candidate beyond the old key cap must remain searchable');
assert.equal(last[0].url, 'https://catalog.example.jp/work');

indexWebDocument(index, {
  url: 'https://noindex.example.jp/work',
  canonical: '',
  title: '作品79',
  ogTitle: '',
  description: '',
  keywords: '',
  text: '主題歌',
  subjectCandidate: { key: '作品79', title: '作品79' },
  candidates: [{ key: '作品79', title: '作品79' }],
  noindex: true
}, '2026-09-12T00:00:00.000Z');
assert.equal(index.length, 1, 'noindex pages must never enter the persisted search corpus');

const sanitized = sanitizeWebSearchIndex([
  ...index,
  { ...index[0] },
  { url: 'javascript:alert(1)', candidateKeys: ['作品79'], topics: ['music'] }
]);
assert.equal(sanitized.length, 1, 'index sanitizer must deduplicate URLs and reject non-HTTP(S) URLs');

const familyIndex = [];
for (const url of ['https://a.example.jp/oddtaxi/music', 'https://b.example.jp/oddtaxi/music']) {
  indexWebDocument(familyIndex, {
    url,
    canonical: '',
    title: 'オッドタクシー 主題歌',
    ogTitle: '',
    description: '',
    keywords: '',
    text: '主題歌 オープニング エンディング',
    subjectCandidate: { key: 'オッドタクシー', title: 'オッドタクシー' },
    candidates: [{ key: 'オッドタクシー', title: 'オッドタクシー' }],
    noindex: false
  }, '2026-09-12T00:00:00.000Z');
}
const familyLookup = buildWebSearchLookup(familyIndex);
const diversified = searchOwnWebIndex(familyLookup, {
  title: 'オッドタクシー',
  topic: 'music',
  fields: ['opening_themes'],
  seenFamilies: [familyIndex[0].sourceFamily],
  limit: 10
});
assert.equal(diversified.length, 2);
assert.equal(diversified[0].sourceFamily, familyIndex[1].sourceFamily, 'unseen source family must receive the diversity bonus');

console.log('In-house Web search index self-test: PASS');
console.log('candidate-key completeness: PASS');
console.log('inverted title lookup: PASS');
console.log('noindex exclusion: PASS');
console.log('URL sanitization/deduplication: PASS');
console.log('source-family diversification: PASS');
