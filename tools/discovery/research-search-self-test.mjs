import assert from 'node:assert/strict';
import {
  buildResearchSearchPlan,
  enqueueResearchSearchResults,
  executeResearchSearchPlan,
  normalizeResearchSearchResults
} from './research-search.mjs';
import { recordCandidateSearchQuery } from './research-completion.mjs';
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
assert.ok(!nextPlan.some((item) => item.query === title), 'a completed broad search query must not be repeated every cycle');

const notIdentityReady = structuredClone(candidate);
notIdentityReady.facts.origin_country = fact('observed', 'JP', { hostCount: 1 });
notIdentityReady.evidence = notIdentityReady.evidence.filter((item) => item.field !== 'origin_country');
assert.deepEqual(buildResearchSearchPlan(notIdentityReady, { maxQueries: 64 }), [], 'deep research must not begin before identity is confirmed');

const sanitized = normalizeResearchSearchResults([
  { url: 'https://oddtaxi.jp/staff/', title: 'スタッフ', snippet: '検索スニペットは事実ではない' },
  { link: 'https://oddtaxi.jp/staff/', snippet: 'duplicate' },
  { href: 'javascript:alert(1)' },
  'https://www.tv-tokyo.co.jp/oddtaxi/'
]);
assert.deepEqual(sanitized, [
  { url: 'https://oddtaxi.jp/staff/' },
  { url: 'https://www.tv-tokyo.co.jp/oddtaxi/' }
], 'search ingestion must preserve URLs only and discard result titles/snippets');

const state = { frontier: [], visited: [], candidates: [candidate] };
const evidenceBefore = JSON.stringify(candidate.evidence);
const added = enqueueResearchSearchResults(state, candidate, { priority: 220 }, [
  { url: 'https://oddtaxi.jp/staff/', title: '映画 オッドタクシー イン・ザ・ウッズ', snippet: '監督は架空人物' },
  { url: 'https://oddtaxi.jp/staff/', snippet: 'duplicate' }
]);
assert.equal(added, 1);
assert.equal(state.frontier.length, 1);
assert.deepEqual(state.frontier[0].candidateHints, [title], 'search-found URL must enter frontier scoped to the confirmed work title');
assert.equal(JSON.stringify(candidate.evidence), evidenceBefore, 'search results must never mutate evidence');
assert.equal(state.candidates.length, 1, 'a related title visible only in search metadata must not become a new work candidate');

state.visited.push(urlHash('https://visited.example.jp/work'));
assert.equal(enqueueResearchSearchResults(state, candidate, { priority: 220 }, [
  { url: 'https://visited.example.jp/work' }
]), 0, 'visited URLs must not be requeued from search');

const executionCandidate = structuredClone(candidate);
executionCandidate.research = {};
const executionState = { frontier: [], visited: [], candidates: [executionCandidate] };
const calls = [];
const provider = {
  async search(query, { limit }) {
    calls.push({ query, limit });
    return [{
      url: 'https://source.example.net/oddtaxi/music',
      title: '映画 オッドタクシー イン・ザ・ウッズ',
      snippet: 'この文字列からEvidenceを作ってはいけない'
    }];
  }
};
const singlePlan = [{ kind: 'targeted', topic: 'music', query: `${title} 主題歌`, fields: ['opening_themes'], priority: 220 }];
const executionStats = await executeResearchSearchPlan({
  state: executionState,
  candidate: executionCandidate,
  searchProvider: provider,
  plan: singlePlan,
  resultsPerQuery: 7
});
assert.deepEqual(calls, [{ query: `${title} 主題歌`, limit: 7 }]);
assert.equal(executionStats.searched, 1);
assert.equal(executionStats.urlsQueued, 1);
assert.ok(executionCandidate.research.searchQueries.includes(`${title} 主題歌`));
assert.equal(executionState.candidates.length, 1, 'deep search must return URLs to discovery instead of researching a related work inline');
assert.equal(JSON.stringify(executionCandidate.evidence), evidenceBefore, 'provider metadata must not enter candidate evidence');

console.log('Title-driven research search self-test: PASS');
console.log('confirmed-title root: PASS');
console.log('missing-field query targeting: PASS');
console.log('search snippets excluded from evidence: PASS');
console.log('search URLs -> research frontier: PASS');
console.log('related-work metadata does not bypass discovery identity: PASS');
