import assert from 'node:assert/strict';
import { emptyDiscoveryState } from './state.mjs';
import { emptyResearchLaneState } from './research-lane-state.mjs';
import { runResearchLane } from './research-runner.mjs';
import { buildInformationDepthPlan, promoteCorroborationFrontier } from './depth-control.mjs';

const at = '2026-09-12T00:00:00.000Z';
const title = '星の旅';
const discoveryUrl = 'https://discovery.example.jp/anime-list';
const officialUrl = 'https://official.example.jp/hoshinotabi/';
const articleUrl = 'https://ja.wikipedia.org/wiki/%E6%98%9F%E3%81%AE%E6%97%85';

const state = emptyDiscoveryState();
state.frontier.push({
  url: discoveryUrl,
  priority: 100,
  depth: 0,
  discoveredFrom: '',
  candidateHints: []
});
state.candidates.push({
  key: title,
  title,
  sources: [officialUrl],
  evidence: [
    { field: 'title_ja', value: title, sourceUrl: officialUrl, sourceClass: 'primary', directness: 100, rule: 'fixture-title', observedAt: at },
    { field: 'title_ja', value: title, sourceUrl: 'https://identity.example.net/title', sourceClass: 'secondary', directness: 80, rule: 'fixture-title-2', observedAt: at },
    { field: 'media_type', value: 'TV', sourceUrl: officialUrl, sourceClass: 'primary', directness: 100, rule: 'fixture-media', observedAt: at },
    { field: 'origin_country', value: 'JP', sourceUrl: officialUrl, sourceClass: 'primary', directness: 100, rule: 'origin-country-labeled-japan', observedAt: at },
    { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://catalog.example.org/work', sourceClass: 'secondary', directness: 80, rule: 'fixture-release', observedAt: at }
  ],
  facts: {
    title_ja: { status: 'confirmed', value: title },
    media_type: { status: 'confirmed', value: 'TV' },
    origin_country: { status: 'confirmed', value: 'JP' },
    release_start: { status: 'observed', value: '2027-04-03' }
  },
  series: {},
  research: {},
  lastSeen: at
});

const depthPlan = buildInformationDepthPlan(state);
assert.equal(depthPlan.pendingCandidates, 1);
assert.equal(depthPlan.pauseBootstrap, false, 'deep-research backlog must never pause broad discovery');
assert.equal(promoteCorroborationFrontier(state).promoted, 0, 'discovery frontier must never receive deep-research focus');

const researchState = emptyResearchLaneState();
let titleApiCalls = 0;
const titleSearchFetchImpl = async (url) => {
  titleApiCalls += 1;
  assert.equal(new URL(url).hostname, 'ja.wikipedia.org');
  assert.equal(new URL(url).searchParams.get('titles'), title);
  return {
    ok: true,
    async json() {
      return {
        query: {
          pages: [{ pageid: 123, ns: 0, title }]
        }
      };
    }
  };
};

const fetched = [];
const fetcher = {
  async fetchPage(url) {
    fetched.push(url);
    if (url !== articleUrl) return { ok: false, skipped: true, reason: 'fixture-miss' };
    return {
      ok: true,
      url,
      contentType: 'text/html; charset=utf-8',
      text: `<!doctype html><html><head><title>${title} - Wikipedia</title></head><body><h1>${title}</h1><p>日本のテレビアニメ。2027年4月3日放送開始。</p></body></html>`,
      sitemaps: []
    };
  }
};

const result = await runResearchLane({
  state,
  researchState,
  fetcher,
  knownWorkSearch: { available: false },
  maxPages: 1,
  maxDepth: 2,
  perHostLimit: 2,
  now: at,
  titleSearchFetchImpl
});

assert.equal(titleApiCalls, 1, 'confirmed title must be used as the research lookup key');
assert.equal(fetched[0], articleUrl, 'title-resolved research root must outrank source-root crawling');
assert.equal(result.state.frontier.some((entry) => entry.url === discoveryUrl), true, 'deep research must not consume discovery frontier');
assert.equal(result.researchState.visited.length, 1, 'deep research must maintain an independent visited set');
assert.equal(result.titleSearch.resolved, 1);
assert.equal(result.titleSearch.pendingCandidates, 1);
assert.equal(result.state.candidates.some((candidate) => candidate.title === title), true);
assert.equal(result.state.engineMode, undefined, 'research-only runtime marker must not leak into persistent discovery state');

console.log('Two-engine architecture self-test: PASS');
console.log('broad discovery pause by research backlog: BLOCKED');
console.log('deep-research key: CONFIRMED TITLE');
console.log('discovery/research frontier: SEPARATE');
console.log('discovery/research visited set: SEPARATE');
console.log('research result merge into candidate evidence: PASS');
