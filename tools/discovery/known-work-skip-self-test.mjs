import assert from 'node:assert/strict';
import { runDiscovery } from './engine.mjs';
import { emptyDiscoveryState } from './state.mjs';

const knownUrl = 'https://known.test/star';
const unknownUrl = 'https://unknown.test/sea';
const pages = new Map([
  [knownUrl, `<!doctype html><html><head><title>星の旅 | TVアニメ公式サイト</title></head><body>
    <p>日本のTVアニメ「星の旅」は2027年4月3日放送開始。</p>
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

const knownWorkSearch = {
  available: true,
  hasExactTitle(title) {
    return String(title) === '星の旅';
  }
};

const state = emptyDiscoveryState();
state.frontier.push({ url: knownUrl, priority: 100, depth: 0, discoveredFrom: '' });
state.candidates.push({
  key: '星の旅',
  title: '星の旅',
  sources: ['https://old.test/star'],
  evidence: [],
  facts: {},
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

assert.equal(result.state.candidates.some((candidate) => candidate.title === '星の旅'), false, 'registered work must be pruned from saved discovery candidates');
assert.equal(result.stats.knownStateCandidatesPruned, 1, 'previous discovery candidate must be pruned after registration');
assert.ok(result.stats.knownWorkCandidatesSkipped >= 1, 'registered work mention must skip new evidence collection');
assert.ok(result.state.visited.length >= 2, 'known work page must still allow traversal to new work links');
const sea = result.state.candidates.find((candidate) => candidate.title === '海の灯');
assert.ok(sea, 'new work reached through a registered-work page must still be discovered');
assert.ok(sea.evidence.some((item) => item.field === 'release_start' && item.value === '2028-01-08'), 'new work must receive normal evidence');
assert.ok(sea.evidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Sea'));

console.log('Known-work next-run skip self-test: PASS');
console.log('registered work candidate/evidence reuse: BLOCKED');
console.log('registered work page link traversal: PASS');
console.log('new work discovery after registered page: PASS');
