import assert from 'node:assert/strict';
import { runDiscovery } from './engine.mjs';
import { emptyDiscoveryState } from './state.mjs';
import { recordCandidateResearch } from './research-completion.mjs';
import { promoteCorroborationFrontier } from './depth-control.mjs';

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
assert.equal(
  result.state.frontier.some((item) => item.url === newsUrl && item.candidateHints?.includes('星の旅')),
  false,
  'generic same-site links must not inherit candidate verification hints'
);

const focusState = emptyDiscoveryState();
const at = '2026-09-11T00:00:00.000Z';
const nearTitle = '近い作品';
const farTitle = '遠い作品';
focusState.candidates.push(
  {
    key: nearTitle,
    title: nearTitle,
    sources: [],
    evidence: [
      { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://catalog-near.example.jp/work', sourceClass: 'secondary', rule: 'fixture', observedAt: at }
    ],
    facts: {
      title_ja: { status: 'confirmed', value: nearTitle },
      media_type: { status: 'confirmed', value: 'TV' },
      origin_country: { status: 'confirmed', value: 'JP' },
      release_start: { status: 'observed', value: '2027-04-03' },
      genres: { status: 'confirmed', value: 'SF' },
      director: { status: 'confirmed', value: '監督A' },
      animation_studio: { status: 'confirmed', value: 'Studio A' },
      opening_themes: { status: 'confirmed', value: '主題歌A' }
    },
    series: {},
    research: {
      pageUrls: ['https://catalog-near.example.jp/work', 'https://official-near.example.org/staff'],
      routes: ['works', 'staff'],
      sourceFamilies: ['example.jp', 'example.org'],
      evidenceFields: ['release_start', 'genres', 'director', 'animation_studio', 'opening_themes'],
      noGainPages: 0,
      lastEvidenceAt: at
    },
    lastSeen: at
  },
  {
    key: farTitle,
    title: farTitle,
    sources: [],
    evidence: [
      { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://catalog-far.example.jp/work', sourceClass: 'secondary', rule: 'fixture', observedAt: at }
    ],
    facts: {
      title_ja: { status: 'confirmed', value: farTitle },
      media_type: { status: 'confirmed', value: 'TV' },
      origin_country: { status: 'confirmed', value: 'JP' },
      release_start: { status: 'observed', value: '2027-04-03' }
    },
    series: {},
    research: {
      pageUrls: ['https://catalog-far.example.jp/work'],
      routes: ['works'],
      sourceFamilies: ['example.jp'],
      evidenceFields: ['release_start'],
      noGainPages: 0,
      lastEvidenceAt: at
    },
    lastSeen: at
  }
);
focusState.frontier.push(
  {
    url: 'https://broadcast-near.example.net/broadcast',
    priority: 500,
    depth: 1,
    discoveredFrom: '',
    candidateHints: [nearTitle]
  },
  {
    url: 'https://broadcast-far.example.net/broadcast',
    priority: 500,
    depth: 1,
    discoveredFrom: '',
    candidateHints: [farTitle]
  }
);

const focusResult = promoteCorroborationFrontier(focusState);
assert.equal(focusResult.focusCandidate, nearTitle, 'nearest-ready candidate must receive the focused corroboration slot');
assert.equal(focusState.frontier[0].priority, 1000, 'focused candidate corroboration route must be promoted');
assert.equal(focusState.frontier[1].priority, 500, 'other pending candidate must remain queued without same-batch priority promotion');
assert.equal(focusState.candidates.length, 2, 'focus scheduling must not discard pending candidates');
assert.equal(focusState.frontier.length, 2, 'focus scheduling must not discard frontier work');

console.log('Information routing integration self-test: PASS');
console.log('missing staff route prioritization: PASS');
console.log('candidate page research accounting: PASS');
console.log('generic verification-hint fanout: BLOCKED');
console.log('nearest-ready corroboration focus: PASS');
console.log('non-focused pending work preservation: PASS');
