import assert from 'node:assert/strict';
import { runDiscovery } from './engine.mjs';
import { emptyDiscoveryState } from './state.mjs';
import { recordCandidateResearch } from './research-completion.mjs';

const workUrl = 'https://anime.example/work';
const staffUrl = 'https://anime.example/staff';
const newsUrl = 'https://anime.example/news';
const pages = new Map([
  [workUrl, `<!doctype html><html><head><title>星の旅 | TVアニメ公式サイト</title></head><body>
    <h1>星の旅</h1><p>日本のTVアニメ「星の旅」は2027年4月3日放送開始。</p>
    <a href="${staffUrl}">スタッフ・キャスト</a>
    <a href="${newsUrl}">ニュース</a>
  </body></html>`],
  [staffUrl, '<!doctype html><html><head><title>星の旅 スタッフ | TVアニメ公式サイト</title></head><body><h1>星の旅</h1><p>監督：山田太郎</p></body></html>'],
  [newsUrl, '<!doctype html><html><head><title>星の旅 ニュース | TVアニメ公式サイト</title></head><body><h1>星の旅</h1><p>ニュース</p></body></html>']
]);

const state = emptyDiscoveryState();
state.frontier.push({ url: workUrl, priority: 100, depth: 0, discoveredFrom: '', candidateHints: ['星の旅'] });
let research = {};
research = recordCandidateResearch(research, {
  url: 'https://other.example/general',
  evidence: [{ field: 'release_start', value: '2027-04-03' }],
  observedAt: '2026-09-10T00:00:00.000Z'
});
state.candidates.push({
  key: '星の旅',
  title: '星の旅',
  sources: [],
  evidence: [],
  facts: {},
  series: {},
  research,
  lastSeen: '2026-09-10T00:00:00.000Z'
});

const order = [];
const fetcher = {
  async fetchPage(url) {
    order.push(url);
    const text = pages.get(url);
    if (!text) return { ok: false, skipped: true, reason: 'fixture-miss' };
    return { ok: true, url, text, contentType: 'text/html; charset=utf-8', sitemaps: [] };
  }
};

const result = await runDiscovery({
  state,
  fetcher,
  maxPages: 2,
  maxDepth: 2,
  perHostLimit: 3,
  now: '2026-09-11T00:00:00.000Z'
});

assert.equal(order[0], workUrl);
assert.equal(order[1], staffUrl, 'missing staff information route must outrank generic news route');
assert.ok(result.stats.informationPriorityLinks >= 1, 'missing-information link boost must be observed');
const candidate = result.state.candidates.find((item) => item.title === '星の旅');
assert.ok(candidate?.research?.pageUrls?.includes(workUrl), 'fetched focused work page must be recorded as candidate research');

console.log('Information routing integration self-test: PASS');
console.log('missing staff route prioritization: PASS');
console.log('candidate page research accounting: PASS');
