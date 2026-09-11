import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEvidenceWithTrust } from './trust-resolution.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { emptyDiscoveryState, loadDiscoveryState, saveDiscoveryState } from './state.mjs';
import { runDiscovery } from './engine.mjs';
import { buildInformationDepthPlan, promoteCorroborationFrontier } from './depth-control.mjs';

const at = '2026-09-10T00:00:00.000Z';
const evidence = [
  { field: 'title_ja', value: '星の旅', sourceUrl: 'https://catalog.example.jp/work/1', sourceClass: 'secondary', directness: 88, rule: 'anime-title-candidate', observedAt: at },
  { field: 'origin_country', value: 'JP', sourceUrl: 'https://catalog.example.jp/work/1', sourceClass: 'secondary', directness: 88, rule: 'origin-country-labeled-japan', observedAt: at },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://catalog.example.jp/work/1', sourceClass: 'secondary', directness: 88, rule: 'media-tv', observedAt: at },
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://catalog.example.jp/work/1', sourceClass: 'secondary', directness: 88, rule: 'event-date-release', observedAt: at },
  { field: 'title_ja', value: '星の旅', sourceUrl: 'https://news.example.net/anime/1', sourceClass: 'secondary', directness: 88, rule: 'anime-title-candidate', observedAt: at },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://news.example.net/anime/1', sourceClass: 'secondary', directness: 88, rule: 'media-tv', observedAt: at },
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://news.example.net/anime/1', sourceClass: 'secondary', directness: 88, rule: 'event-date-release', observedAt: at }
];

const facts = resolveEvidenceWithTrust(evidence, { strategy: { version: 1, operations: {}, trust: {}, updatedAt: '' } });
for (const field of ['title_ja', 'origin_country', 'media_type', 'release_start']) assert.equal(facts[field].status, 'confirmed', `${field} must bootstrap from direct/corroborated evidence`);
assert.equal(discoveryCandidateReadiness({ title: '星の旅', evidence, facts }).ready, true);

const coreOnlyEvidence = evidence.filter((item) => item.field !== 'release_start');
const coreOnlyFacts = resolveEvidenceWithTrust(coreOnlyEvidence);
assert.equal(discoveryCandidateReadiness({ title: '星の旅', evidence: coreOnlyEvidence, facts: coreOnlyFacts }).ready, true, 'independent title and media agreement may identify a work without exporting an unconfirmed date');

const recordLevelEvidence = [
  { field: 'title_ja', value: '星の旅', sourceUrl: 'https://www.wikidata.org/wiki/Q123', sourceClass: 'secondary', directness: 96, rule: 'wikidata-item-label', observedAt: at },
  { field: 'origin_country', value: 'JP', sourceUrl: 'https://www.wikidata.org/wiki/Q123', sourceClass: 'secondary', directness: 98, rule: 'origin-country-labeled-japan', observedAt: at },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://www.wikidata.org/wiki/Q123', sourceClass: 'secondary', directness: 96, rule: 'wikidata-instance-class', observedAt: at },
  { field: 'title_ja', value: '星の旅', sourceUrl: 'https://news.example.net/anime/1', sourceClass: 'secondary', directness: 88, rule: 'anime-title-candidate', observedAt: at }
];
const recordLevelFacts = resolveEvidenceWithTrust(recordLevelEvidence);
const recordLevelResult = discoveryCandidateReadiness({ key: '星の旅', title: '星の旅', evidence: recordLevelEvidence, facts: recordLevelFacts });
assert.equal(recordLevelResult.ready, true, 'two independent title sources plus direct structured origin/media may admit the work');
assert.equal(recordLevelResult.recordLevelCore, true);

const searchOnlyEvidence = recordLevelEvidence.map((item) => item.sourceUrl.includes('news.example.net') ? { ...item, sourceUrl: 'https://google.com/search?q=hoshi' } : item);
assert.equal(discoveryCandidateReadiness({ key: '星の旅', title: '星の旅', evidence: searchOnlyEvidence, facts: resolveEvidenceWithTrust(searchOnlyEvidence) }).ready, false, 'search result pages must not count as an independent confirming family');

const oneFamily = evidence.filter((item) => item.sourceUrl.includes('catalog.example.jp'));
assert.equal(discoveryCandidateReadiness({ title: '星の旅', evidence: oneFamily, facts }).reason, 'independent-source-family-not-confirmed');

const conflicting = [...evidence, { field: 'origin_country', value: 'OTHER', sourceUrl: 'https://official.example.org/work/1', sourceClass: 'primary', directness: 100, rule: 'origin-country-labeled-other', observedAt: at }];
assert.equal(resolveEvidenceWithTrust(conflicting).origin_country.status, 'conflict');
assert.equal(discoveryCandidateReadiness({ title: '星の旅', evidence: conflicting, facts: resolveEvidenceWithTrust(conflicting) }).reason, 'origin-country-conflict');

const depthState = emptyDiscoveryState();
depthState.candidates.push({
  key: '星の旅',
  title: '星の旅',
  sources: ['https://catalog.example.jp/work/1', 'https://news.example.net/anime/1'],
  evidence,
  facts,
  series: {},
  research: {},
  lastSeen: at
});
depthState.frontier.push({
  url: 'https://official.example.org/staff',
  priority: 900,
  depth: 0,
  discoveredFrom: 'https://catalog.example.jp/work/1',
  candidateHints: ['星の旅']
});
const depthPlan = buildInformationDepthPlan(depthState);
assert.equal(depthPlan.pendingCandidates, 1, 'identity-ready but information-incomplete work must enter depth backlog');
assert.equal(depthPlan.actionableFrontier, 1, 'candidate-linked frontier must be recognized as actionable depth work');
assert.equal(depthPlan.pauseBootstrap, true, 'new horizontal bootstrap must pause while actionable depth work exists');
depthState.frontier[0].candidateHints = ['別作品'];
assert.equal(buildInformationDepthPlan(depthState).pauseBootstrap, false, 'bootstrap must resume when no actionable depth frontier remains');

const corroborationEvidence = [
  ...coreOnlyEvidence,
  evidence.find((item) => item.field === 'release_start' && item.sourceUrl.includes('catalog.example.jp'))
];
const corroborationFacts = resolveEvidenceWithTrust(corroborationEvidence);
assert.equal(corroborationFacts.release_start.status, 'observed');
const corroborationState = emptyDiscoveryState();
corroborationState.candidates.push({
  key: '星の旅',
  title: '星の旅',
  sources: ['https://catalog.example.jp/work/1', 'https://news.example.net/anime/1'],
  evidence: corroborationEvidence,
  facts: corroborationFacts,
  series: {},
  research: {},
  lastSeen: at
});
corroborationState.frontier.push(
  { url: 'https://broadcast.example.org/broadcast', priority: 500, depth: 1, discoveredFrom: '', candidateHints: ['星の旅'] },
  { url: 'https://catalog.example.jp/broadcast', priority: 500, depth: 1, discoveredFrom: '', candidateHints: ['星の旅'] },
  { url: 'https://other.example.com/broadcast', priority: 500, depth: 1, discoveredFrom: '', candidateHints: [] }
);
const corroborationPromotion = promoteCorroborationFrontier(corroborationState);
assert.equal(corroborationPromotion.examined, 2, 'only candidate-scoped frontier entries should be examined for corroboration');
assert.equal(corroborationPromotion.promoted, 1, 'only a new-family corroboration route should be promoted');
assert.equal(corroborationState.frontier[0].priority, 1000);
assert.equal(corroborationState.frontier[1].priority, 500, 'same-family route must not be promoted as independent corroboration');
assert.equal(corroborationState.frontier[2].priority, 500, 'unscoped route must not be promoted');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-frontier-balance-'));
const state = emptyDiscoveryState();
for (let index = 0; index < 6000; index += 1) {
  state.frontier.push({ url: `https://dominant.example.jp/${index}`, priority: 200, depth: 1, discoveredFrom: '', candidateHints: [] });
  state.frontier.push({ url: `https://independent.example.net/${index}`, priority: 150, depth: 1, discoveredFrom: '', candidateHints: [] });
}
const statePath = path.join(temp, 'state.json');
saveDiscoveryState(statePath, state);
const persisted = loadDiscoveryState(statePath);
assert.equal(persisted.frontier.filter((item) => item.url.includes('dominant.example.jp')).length, 6000);
assert.equal(persisted.frontier.filter((item) => item.url.includes('independent.example.net')).length, 6000);
fs.rmSync(temp, { recursive: true, force: true });

const boundedState = emptyDiscoveryState();
boundedState.frontier.push(
  { url: 'https://one-host.example/1', priority: 300, depth: 0, discoveredFrom: '', candidateHints: [] },
  { url: 'https://one-host.example/2', priority: 290, depth: 0, discoveredFrom: '', candidateHints: [] },
  { url: 'https://one-host.example/3', priority: 280, depth: 0, discoveredFrom: '', candidateHints: [] },
  { url: 'https://other-host.example/1', priority: 200, depth: 0, discoveredFrom: '', candidateHints: [] }
);
const fetchedUrls = [];
const boundedResult = await runDiscovery({
  state: boundedState,
  fetcher: {
    async fetchPage(url) {
      fetchedUrls.push(url);
      return { ok: true, url, contentType: 'text/html; charset=utf-8', text: '<html><head><title>情報ページ</title></head><body>情報</body></html>', sitemaps: [] };
    }
  },
  maxPages: 4,
  maxDepth: 1,
  perHostLimit: 1,
  now: at
});
assert.equal(boundedResult.stats.attempted, 2, 'one batch may fetch at most one page from each host when perHostLimit=1');
assert.equal(fetchedUrls.filter((url) => url.includes('one-host.example')).length, 1);
assert.equal(fetchedUrls.filter((url) => url.includes('other-host.example')).length, 1);
assert.equal(boundedResult.state.frontier.filter((item) => item.url.includes('one-host.example')).length, 2, 'host-limited URLs must remain queued for the next batch');

console.log('Cold-start trust bootstrap: PASS');
console.log('single-family CSV admission: BLOCKED');
console.log('credible origin conflict: BLOCKED');
console.log('actionable information-depth bootstrap pause: PASS');
console.log('independent corroboration frontier promotion: PASS');
console.log('same-family corroboration promotion: BLOCKED');
console.log('frontier persistence per-host truncation: NONE');
console.log('per-batch host limit without requeue loop: PASS');
