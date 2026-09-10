import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEvidenceWithTrust } from './trust-resolution.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { emptyDiscoveryState, loadDiscoveryState, saveDiscoveryState } from './state.mjs';

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

const oneFamily = evidence.filter((item) => item.sourceUrl.includes('catalog.example.jp'));
assert.equal(discoveryCandidateReadiness({ title: '星の旅', evidence: oneFamily, facts }).reason, 'independent-source-family-not-confirmed');

const conflicting = [...evidence, { field: 'origin_country', value: 'OTHER', sourceUrl: 'https://official.example.org/work/1', sourceClass: 'primary', directness: 100, rule: 'origin-country-labeled-other', observedAt: at }];
assert.equal(resolveEvidenceWithTrust(conflicting).origin_country.status, 'conflict');
assert.equal(discoveryCandidateReadiness({ title: '星の旅', evidence: conflicting, facts: resolveEvidenceWithTrust(conflicting) }).reason, 'origin-country-conflict');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-frontier-balance-'));
const state = emptyDiscoveryState();
for (let index = 0; index < 6000; index += 1) {
  state.frontier.push({ url: `https://dominant.example.jp/${index}`, priority: 200, depth: 1, discoveredFrom: '', candidateHints: [] });
  state.frontier.push({ url: `https://independent.example.net/${index}`, priority: 150, depth: 1, discoveredFrom: '', candidateHints: [] });
}
const statePath = path.join(temp, 'state.json');
saveDiscoveryState(statePath, state);
const balanced = loadDiscoveryState(statePath);
assert.equal(balanced.frontier.filter((item) => item.url.includes('dominant.example.jp')).length, 5000);
assert.equal(balanced.frontier.filter((item) => item.url.includes('independent.example.net')).length, 5000);
fs.rmSync(temp, { recursive: true, force: true });

console.log('Cold-start trust bootstrap: PASS');
console.log('single-family CSV admission: BLOCKED');
console.log('credible origin conflict: BLOCKED');
console.log('frontier per-host domination: CAPPED');
