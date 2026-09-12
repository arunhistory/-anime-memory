import assert from 'node:assert/strict';
import { runDiscovery } from './engine.mjs';
import { runDeepResearch } from './deep-research-engine.mjs';
import { IndexedFetcher } from './indexed-fetcher.mjs';
import { prepareResearchFrontierFromOwnIndex } from './research-search.mjs';

function confirmed(value) {
  return { status: 'confirmed', value, sourceCount: 2, hostCount: 2, confidence: 90 };
}

function evidenceSignatures(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item?.field || ''}\u0000${item?.value || ''}\u0000${item?.sourceUrl || ''}`)
    .sort();
}

const title = '星の旅';
const identityEvidence = [
  { field: 'title_ja', value: title, sourceUrl: 'https://official.identity.example.jp/work', sourceClass: 'secondary', directness: 95, rule: 'page-title' },
  { field: 'title_ja', value: title, sourceUrl: 'https://network.identity.example.net/work', sourceClass: 'secondary', directness: 95, rule: 'page-title' },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://official.identity.example.jp/work', sourceClass: 'secondary', directness: 95, rule: 'media-type-labeled' },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://network.identity.example.net/work', sourceClass: 'secondary', directness: 95, rule: 'media-type-labeled' },
  { field: 'origin_country', value: 'JP', sourceUrl: 'https://official.identity.example.jp/work', sourceClass: 'secondary', directness: 100, rule: 'origin-country-labeled-japan' }
];
const candidate = {
  key: title,
  title,
  sources: ['https://official.identity.example.jp/work', 'https://network.identity.example.net/work'],
  evidence: structuredClone(identityEvidence),
  facts: {
    title_ja: confirmed(title),
    media_type: confirmed('TV'),
    origin_country: confirmed('JP')
  },
  series: {},
  research: {},
  lastSeen: '2026-09-12T00:00:00.000Z'
};

const pages = new Map([
  ['https://source-a.example.net/staff', `
    <html><head><title>星の旅 スタッフ情報</title><meta name="description" content="スタッフと音楽の資料"></head>
    <body>星の旅 スタッフ\n監督：山田太郎\n音楽：佐藤花子\nアニメーション制作：Studio Star</body></html>`],
  ['https://source-b.example.org/production', `
    <html><head><title>星の旅 制作・スタッフ資料</title><meta name="description" content="監督・音楽・制作会社"></head>
    <body>星の旅 制作資料\n監督：山田太郎\n音楽：佐藤花子\nアニメーション制作：Studio Star</body></html>`]
]);
const rawFetcher = {
  isHostAllowed() { return true; },
  async fetchPage(url) {
    if (!pages.has(url)) return { ok: false, skipped: true, reason: 'fixture-missing' };
    return {
      ok: true,
      url,
      contentType: 'text/html; charset=utf-8',
      text: pages.get(url),
      sitemaps: []
    };
  }
};

const state = {
  version: 1,
  frontier: [...pages.keys()].map((url) => ({ url, priority: 100, depth: 0, discoveredFrom: '', candidateHints: [] })),
  researchFrontier: [],
  visited: [],
  documents: [],
  candidates: [structuredClone(candidate)],
  webSearchIndex: [],
  researchSearchCursor: 0,
  researchStrategy: { version: 1, operations: {}, trust: {}, updatedAt: '' },
  calibrationSeen: [],
  wikidataBootstrap: { version: 1, offset: 0, completed: false, retryAfter: '', lastRunAt: '' },
  wikidataSeriesExpansion: { version: 1, expandedRefs: [], deferredRefs: [], retryAfter: '', lastRunAt: '' },
  updatedAt: ''
};

const evidenceBeforeDiscovery = evidenceSignatures(state.candidates[0].evidence);
const discoveryFetcher = new IndexedFetcher(rawFetcher, state, { now: () => '2026-09-12T00:01:00.000Z' });
const discovery = await runDiscovery({
  state,
  fetcher: discoveryFetcher,
  maxPages: 10,
  maxDepth: 2,
  perHostLimit: 10,
  now: '2026-09-12T00:01:00.000Z'
});
assert.equal(discovery.stats.fetched, 2);
assert.equal(discovery.state.webSearchIndex.length, 2, 'discovery crawl must populate the own Web index');
assert.deepEqual(
  evidenceSignatures(discovery.state.candidates[0].evidence),
  evidenceBeforeDiscovery,
  'ordinary discovery crawl must not use generic indexed pages as deep-research Evidence'
);
assert.ok(
  discovery.state.candidates[0].evidence.every((item) => !String(item.sourceUrl || '').startsWith('https://source-')),
  'generic pages must not contribute work Evidence until dedicated deep research re-fetches them'
);
assert.ok(discovery.state.webSearchIndex.every((entry) => entry.candidateKeys.includes('星の旅')), 'confirmed-title matcher must make generic work-name pages searchable');

const searchStats = prepareResearchFrontierFromOwnIndex(discovery.state, {
  maxCandidates: 10,
  maxQueriesPerCandidate: 64,
  resultsPerQuery: 20
});
assert.equal(searchStats.candidatesConsidered, 1);
assert.equal(discovery.state.researchFrontier.length, 2, 'own search must return the two independent source URLs to the dedicated research frontier');
const discoveryFrontierBeforeResearch = JSON.stringify(discovery.state.frontier);

const researchFetcher = new IndexedFetcher(rawFetcher, discovery.state, { now: () => '2026-09-12T00:02:00.000Z' });
const researched = await runDeepResearch({
  state: discovery.state,
  fetcher: researchFetcher,
  maxPages: 10,
  perHostLimit: 10,
  now: '2026-09-12T00:02:00.000Z'
});
const researchedCandidate = researched.state.candidates.find((item) => item.title === title);
assert.ok(researchedCandidate);
assert.equal(researched.stats.attempted, 2, 'deep research must receive its own page budget');
assert.equal(researched.stats.fetched, 2, 'deep research must fetch research URLs directly');
assert.equal(researched.stats.matchedPages, 2, 'both research pages must be matched to the confirmed work');
assert.equal(researched.state.researchFrontier.length, 0, 'processed research URLs must leave the research frontier');
assert.equal(JSON.stringify(researched.state.frontier), discoveryFrontierBeforeResearch, 'deep research must not merge its queue into the discovery frontier');
assert.equal(researchedCandidate.facts.director?.status, 'confirmed');
assert.equal(researchedCandidate.facts.director?.value, '山田太郎');
assert.equal(researchedCandidate.facts.music?.status, 'confirmed');
assert.equal(researchedCandidate.facts.music?.value, '佐藤花子');
assert.equal(researchedCandidate.facts.animation_studio?.status, 'confirmed');
assert.equal(researchedCandidate.facts.animation_studio?.value, 'Studio Star');
assert.ok(researchedCandidate.sources.includes('https://source-a.example.net/staff'));
assert.ok(researchedCandidate.sources.includes('https://source-b.example.org/production'));

const boundedState = structuredClone(researched.state);
boundedState.researchFrontier = [0, 1, 2].map((index) => ({
  url: `https://missing-${index}.example.net/research`,
  priority: 300 - index,
  depth: 0,
  discoveredFrom: '',
  candidateHints: [title]
}));
const skippedFetcher = {
  isHostAllowed() { return true; },
  async fetchPage() { return { ok: false, skipped: true, reason: 'http-404' }; }
};
const bounded = await runDeepResearch({
  state: boundedState,
  fetcher: skippedFetcher,
  maxPages: 1,
  perHostLimit: 10,
  now: '2026-09-12T00:03:00.000Z'
});
assert.equal(bounded.stats.attempted, 1, 'deep-research budget must be independent and exact');
assert.equal(bounded.stats.permanentSkipped, 1);
assert.equal(bounded.stats.skipReasons['http-404'], 1, 'skip reasons must remain visible instead of collapsing into other-skipped');
assert.equal(bounded.state.researchFrontier.length, 2, 'only the attempted permanent skip may leave the research queue');

console.log('Title-driven research integration self-test: PASS');
console.log('crawler -> own Web index: PASS');
console.log('confirmed title -> own-index URL search: PASS');
console.log('search result metadata -> Evidence: BLOCKED');
console.log('discovery frontier / research frontier execution: SEPARATE');
console.log('deep-research independent page budget: PASS');
console.log('research frontier consumption: PASS');
console.log('skip reason visibility: PASS');
console.log('two independent source families -> confirmed facts: PASS');
