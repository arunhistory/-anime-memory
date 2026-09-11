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
const nearBroadcastUrl = 'https://broadcast-near.example.net/broadcast';
const farBroadcastUrl = 'https://broadcast-far.example.net/broadcast';
const nearCommerceUrl = 'https://catalog-near.example.jp/product/item-1';
const identityEvidence = (title, host, corroboratorHost) => [
  { field: 'title_ja', value: title, sourceUrl: `https://${host}/work`, sourceClass: 'primary', directness: 100, rule: 'fixture-title', observedAt: at },
  { field: 'title_ja', value: title, sourceUrl: `https://${corroboratorHost}/title`, sourceClass: 'secondary', directness: 80, rule: 'fixture-title-corroboration', observedAt: at },
  { field: 'media_type', value: 'TV', sourceUrl: `https://${host}/work`, sourceClass: 'primary', directness: 100, rule: 'fixture-media', observedAt: at },
  { field: 'origin_country', value: 'JP', sourceUrl: `https://${host}/work`, sourceClass: 'primary', directness: 100, rule: 'origin-country-labeled-japan', observedAt: at }
];
focusState.candidates.push(
  {
    key: nearTitle,
    title: nearTitle,
    sources: [],
    evidence: [
      ...identityEvidence(nearTitle, 'catalog-near.example.jp', 'identity-near.example.net'),
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
      ...identityEvidence(farTitle, 'catalog-far.example.jp', 'identity-far.example.net'),
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
    url: nearBroadcastUrl,
    priority: 500,
    depth: 1,
    discoveredFrom: '',
    candidateHints: [nearTitle]
  },
  {
    url: nearCommerceUrl,
    priority: 900,
    depth: 1,
    discoveredFrom: '',
    candidateHints: [nearTitle]
  },
  {
    url: farBroadcastUrl,
    priority: 500,
    depth: 1,
    discoveredFrom: '',
    candidateHints: [farTitle]
  }
);

const focusResult = promoteCorroborationFrontier(focusState);
assert.equal(focusResult.focusCandidate, nearTitle, 'nearest-ready candidate must receive the focused corroboration slot');
assert.ok(focusResult.focusCandidateKey, 'focused corroboration must expose the ephemeral normalized candidate key');
assert.equal(focusResult.promoted, 1, 'only eligible URLs for the selected candidate may enter the focus lane');
assert.equal(focusState.frontier.focusUrls instanceof Set, true, 'focus URL set must exist ephemerally on the frontier');
assert.equal(focusState.frontier.focusUrls.has(nearBroadcastUrl), true, 'eligible independent broadcast URL must enter the focus lane');
assert.equal(focusState.frontier.focusUrls.has(nearCommerceUrl), false, 'same-candidate commerce URL must not enter the focus lane');
assert.equal(focusState.frontier[0].priority, 500, 'focused candidate base priority must not be persisted or mutated');
assert.equal(focusState.frontier[1].priority, 900, 'non-eligible same-candidate base priority must remain unchanged');
assert.equal(focusState.candidates.length, 2, 'focus scheduling must not discard pending candidates');
assert.equal(focusState.frontier.length, 3, 'focus scheduling must not discard frontier work');
assert.equal(JSON.stringify(focusState).includes('focusCandidateKey'), false, 'ephemeral focus key must not serialize into crawler state');
assert.equal(JSON.stringify(focusState).includes('focusUrls'), false, 'ephemeral focus URLs must not serialize into crawler state');

console.log('Information routing integration self-test: PASS');
console.log('missing staff route prioritization: PASS');
console.log('candidate page research accounting: PASS');
console.log('generic verification-hint fanout: BLOCKED');
console.log('nearest-ready corroboration focus: PASS');
console.log('same-candidate non-eligible focus lane: BLOCKED');
console.log('focused priority persistence mutation: NONE');
console.log('non-focused pending work preservation: PASS');
