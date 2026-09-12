import assert from 'node:assert/strict';
import {
  buildResearchSearchPlan,
  enqueueResearchSearchResults,
  prepareResearchFrontierFromOwnIndex,
  runOwnResearchSearchForCandidate
} from './research-search.mjs';
import { recordCandidateSearchQuery } from './research-completion.mjs';
import { buildWebSearchLookup, indexWebDocument, searchOwnWebIndex } from './web-search-index.mjs';
import { urlHash } from './url.mjs';

function fact(status, value, extra = {}) {
  return { status, value, sourceCount: 2, hostCount: 2, confidence: 90, ...extra };
}

const title = 'オッドタクシー';
const evidence = [
  { field: 'title_ja', value: title, sourceUrl: 'https://oddtaxi.jp/', directness: 100, rule: 'page-title' },
  { field: 'title_ja', value: title, sourceUrl: 'https://www.tv-tokyo.co.jp/oddtaxi/', directness: 95, rule: 'page-title' },
  { field: 'origin_country', value: 'JP', sourceUrl: 'https://oddtaxi.jp/', directness: 100, rule: 'origin-country-labeled-japan' },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://oddtaxi.jp/', directness: 95, rule: 'media-type-labeled' }
];
const candidate = {
  key: 'オッドタクシー',
  title,
  sources: ['https://oddtaxi.jp/', 'https://www.tv-tokyo.co.jp/oddtaxi/'],
  evidence: structuredClone(evidence),
  facts: {
    title_ja: fact('confirmed', title),
    media_type: fact('confirmed', 'TV'),
    origin_country: fact('confirmed', 'JP'),
    director: fact('confirmed', '木下麦'),
    animation_studio: fact('confirmed', 'P.I.C.S.|OLM'),
    opening_themes: fact('observed', 'OP::ODDTAXI::スカートとPUNPEE::::::', { hostCount: 1 })
  },
  research: {}
};

const plan = buildResearchSearchPlan(candidate, { maxQueries: 64 });
assert.ok(plan.length > 3, 'identity-ready incomplete work must receive a deep-research search plan');
assert.equal(plan[0].kind, 'broad');
assert.equal(plan[0].query, title, 'the confirmed work title itself must be the first broad query');
for (const item of plan.slice(1)) {
  assert.ok(item.query.startsWith(`${title} `), `targeted query must start with confirmed title: ${item.query}`);
}
assert.ok(plan.every((item) => !item.fields.includes('director')), 'confirmed director must not be targeted again');
assert.ok(plan.every((item) => !item.fields.includes('animation_studio')), 'confirmed animation studio must not be targeted again');
assert.ok(plan.some((item) => item.fields.includes('opening_themes')), 'observed theme-song information must remain a confirmation target');
assert.ok(plan.some((item) => item.fields.includes('streaming_services')), 'unknown streaming information must be targeted');
const music = plan.find((item) => item.fields.includes('opening_themes'));
const official = plan.find((item) => item.fields.includes('official_url'));
assert.ok(music.priority > official.priority, 'observed information should be confirmed before untouched low-signal fields');

const remembered = structuredClone(candidate);
remembered.research = recordCandidateSearchQuery(remembered.research, title);
const nextPlan = buildResearchSearchPlan(remembered, { maxQueries: 64 });
assert.ok(nextPlan.some((item) => item.query === title), 'local own-index search must remain refreshable while information is incomplete');

const notIdentityReady = structuredClone(candidate);
notIdentityReady.facts.origin_country = fact('observed', 'JP', { hostCount: 1 });
notIdentityReady.evidence = notIdentityReady.evidence.filter((item) => item.field !== 'origin_country');
assert.deepEqual(buildResearchSearchPlan(notIdentityReady, { maxQueries: 64 }), [], 'deep research must not begin before identity is confirmed');

const ownIndex = [];
indexWebDocument(ownIndex, {
  url: 'https://source.example.net/oddtaxi/music',
  canonical: '',
  title: 'TVアニメ「オッドタクシー」主題歌・音楽',
  ogTitle: 'オッドタクシー MUSIC',
  description: '主題歌と音楽情報',
  keywords: 'オッドタクシー,主題歌',
  text: 'TVアニメ「オッドタクシー」の主題歌、オープニング、エンディング、劇伴音楽を紹介する。',
  subjectCandidate: { key: 'オッドタクシー', title },
  candidates: [{ key: 'オッドタクシー', title }],
  noindex: false
}, '2026-09-12T00:00:00.000Z');
indexWebDocument(ownIndex, {
  url: 'https://source.example.org/oddtaxi/streaming',
  canonical: '',
  title: 'オッドタクシー 配信情報',
  ogTitle: '',
  description: '見放題と配信サービス',
  keywords: '',
  text: 'オッドタクシーの配信、見放題、先行配信情報。',
  subjectCandidate: { key: 'オッドタクシー', title },
  candidates: [{ key: 'オッドタクシー', title }],
  noindex: false
}, '2026-09-12T00:00:00.000Z');
indexWebDocument(ownIndex, {
  url: 'https://source.example.com/oddtaxi-movie/news',
  canonical: '',
  title: '映画 オッドタクシー イン・ザ・ウッズ',
  ogTitle: '',
  description: '劇場版ニュース',
  keywords: '',
  text: '映画 オッドタクシー イン・ザ・ウッズについて。',
  subjectCandidate: { key: '映画オッドタクシーインザウッズ', title: '映画 オッドタクシー イン・ザ・ウッズ' },
  candidates: [{ key: '映画オッドタクシーインザウッズ', title: '映画 オッドタクシー イン・ザ・ウッズ' }],
  noindex: false
}, '2026-09-12T00:00:00.000Z');

const lookup = buildWebSearchLookup(ownIndex);
const ownMusicResults = searchOwnWebIndex(lookup, {
  title,
  fields: ['opening_themes'],
  topic: 'music',
  limit: 10
});
assert.deepEqual(ownMusicResults.map((item) => item.url), ['https://source.example.net/oddtaxi/music'], 'built-in inverted index must retrieve the matching work/topic URL');
assert.ok(!ownMusicResults.some((item) => item.url.includes('movie')), 'a related work must not match the confirmed work title as the same identity');

const state = { researchFrontier: [], visited: [], candidates: [candidate], webSearchIndex: ownIndex };
const evidenceBefore = JSON.stringify(candidate.evidence);
const added = enqueueResearchSearchResults(state, candidate, { priority: 220 }, ownMusicResults);
assert.equal(added, 1);
assert.equal(state.researchFrontier.length, 1);
assert.deepEqual(state.researchFrontier[0].candidateHints, [title], 'own-search URL must enter the dedicated research frontier scoped to the confirmed work title');
assert.equal(JSON.stringify(candidate.evidence), evidenceBefore, 'search-index retrieval must never mutate evidence');
assert.equal(state.candidates.length, 1, 'a related work found in the same web corpus must not bypass discovery identity handling');

state.visited.push(urlHash('https://visited.example.jp/work'));
assert.equal(enqueueResearchSearchResults(state, candidate, { priority: 220 }, [
  { url: 'https://visited.example.jp/work' }
]), 1, 'research must be allowed to re-fetch a URL previously visited by discovery');

const executionCandidate = structuredClone(candidate);
executionCandidate.research = {};
const executionState = { researchFrontier: [], visited: [], candidates: [executionCandidate], webSearchIndex: ownIndex };
const executionStats = runOwnResearchSearchForCandidate(executionState, executionCandidate, {
  maxQueries: 64,
  resultsPerQuery: 10,
  lookup
});
assert.ok(executionStats.searched > 0, 'built-in search must execute the generated title-driven queries');
assert.ok(executionStats.urlsQueued >= 2, 'built-in search must queue matching source URLs from its own corpus');
assert.ok(executionCandidate.research.searchQueries.some((query) => query === title), 'broad title query must be recorded for audit');
assert.ok(executionCandidate.research.searchQueries.some((query) => query.startsWith(`${title} `)), 'targeted incomplete-field queries must be recorded for audit');
assert.equal(executionState.candidates.length, 1, 'deep search returns URLs to research; it must not inline-create another work');
assert.equal(JSON.stringify(executionCandidate.evidence), evidenceBefore, 'own search index metadata must not enter candidate evidence');

const rotatingCandidates = [0, 1, 2].map((index) => {
  const cloned = structuredClone(candidate);
  cloned.title = `巡回作品${index}`;
  cloned.key = `巡回作品${index}`;
  cloned.facts.title_ja = fact('confirmed', `巡回作品${index}`);
  cloned.evidence = cloned.evidence.map((item) => item.field === 'title_ja' ? { ...item, value: `巡回作品${index}` } : item);
  cloned.research = {};
  return cloned;
});
const rotatingState = {
  researchFrontier: [],
  visited: [],
  candidates: rotatingCandidates,
  webSearchIndex: [],
  researchSearchCursor: 0
};
const rotation1 = prepareResearchFrontierFromOwnIndex(rotatingState, { maxCandidates: 1, maxQueriesPerCandidate: 1, resultsPerQuery: 1 });
assert.equal(rotation1.candidatesConsidered, 1);
assert.equal(rotation1.nextCursor, 1);
const rotation2 = prepareResearchFrontierFromOwnIndex(rotatingState, { maxCandidates: 1, maxQueriesPerCandidate: 1, resultsPerQuery: 1 });
assert.equal(rotation2.candidatesConsidered, 1);
assert.equal(rotation2.nextCursor, 2, 'bounded batches must rotate instead of restarting from the first candidate forever');

console.log('Title-driven own-web-search self-test: PASS');
console.log('confirmed-title root: PASS');
console.log('missing-field query targeting: PASS');
console.log('external search provider dependency: NONE');
console.log('inverted own-Web index lookup: PASS');
console.log('research re-fetch after discovery visit: PASS');
console.log('bounded candidate rotation: PASS');
console.log('related work does not bypass discovery identity: PASS');
