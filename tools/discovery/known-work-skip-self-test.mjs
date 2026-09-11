import assert from 'node:assert/strict';
import { runDiscovery } from './engine.mjs';
import { emptyDiscoveryState } from './state.mjs';

const knownUrl = 'https://known.test/star';
const unknownUrl = 'https://unknown.test/sea';
const pages = new Map([
  [knownUrl, `<!doctype html><html><head><title>星の旅 | TVアニメ公式サイト</title></head><body>
    <p>日本のTVアニメ「星の旅」は2027年4月3日放送開始。</p>
    <p>アニメーション制作：Studio Star</p>
    <p>関連作品としてTVアニメ「海の灯」も紹介する。</p>
    <a href="${unknownUrl}">海の灯 作品情報</a>
  </body></html>`],
  [unknownUrl, `<!doctype html><html><head><title>海の灯 | TVアニメ公式サイト</title></head><body>
    <p>日本のTVアニメ「海の灯」は2028年1月8日放送開始。</p>
    <p>アニメーション制作：Studio Sea</p>
  </body></html>`]
]);

const fetcher = {
  async fetchPage(url) {
    const text = pages.get(url);
    if (!text) return { ok: false, skipped: true, reason: 'fixture-miss' };
    return { ok: true, url, text, contentType: 'text/html; charset=utf-8', sitemaps: [] };
  }
};

const knownRecord = {
  id: 'A00000001',
  title_ja: '星の旅',
  media_type: 'TV',
  release_start: '',
  animation_studio: '',
  external_ids: 'discovery-key::fixture'
};
const knownWorkSearch = {
  available: true,
  hasExactTitle(title) {
    return String(title) === '星の旅';
  },
  findUniqueExactRecord(title) {
    return String(title) === '星の旅' ? knownRecord : null;
  }
};

const state = emptyDiscoveryState();
state.frontier.push({ url: knownUrl, priority: 100, depth: 0, discoveredFrom: '', candidateHints: ['星の旅'] });
state.candidates.push({
  key: '星の旅',
  title: '星の旅',
  sources: ['https://old.test/star'],
  evidence: [],
  facts: {},
  series: {},
  lastSeen: '2026-09-09T00:00:00.000Z'
});

const result = await runDiscovery({
  state,
  fetcher,
  knownWorkSearch,
  maxPages: 2,
  maxDepth: 2,
  perHostLimit: 2,
  now: '2026-09-10T00:00:00.000Z'
});

const star = result.state.candidates.find((candidate) => candidate.title === '星の旅');
assert.ok(star, 'registered work must remain researchable instead of being pruned');
assert.equal(result.stats.knownStateCandidatesPruned, 0, 'registered discovery state must not be pruned');
assert.equal(result.stats.knownStateCandidatesRetained, 1, 'registered candidate must be retained for enrichment');
assert.ok(result.stats.knownWorkCandidatesSeen >= 1, 'registered work mention must be recognized');
assert.ok(result.stats.knownWorkEvidenceReused >= 1, 'registered work evidence must be retained for blank-field enrichment');
assert.ok(star.evidence.some((item) => item.field === 'release_start' && item.value === '2027-04-03'));
assert.ok(star.evidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Star'));
assert.ok(result.state.visited.length >= 2, 'registered-work page must still allow traversal to new work links');
const sea = result.state.candidates.find((candidate) => candidate.title === '海の灯');
assert.ok(sea, 'new work reached through a registered-work page must still be discovered');
assert.ok(sea.evidence.some((item) => item.field === 'release_start' && item.value === '2028-01-08'), 'new work must receive normal evidence');
assert.ok(sea.evidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Sea'));

console.log('Known-work next-run enrichment self-test: PASS');
console.log('registered work candidate/evidence reuse: PASS');
console.log('registered work page link traversal: PASS');
console.log('new work discovery after registered page: PASS');
