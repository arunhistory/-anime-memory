import assert from 'node:assert/strict';
import { resolveCandidateEntities, areCandidatesMergeable } from './entity-resolution.mjs';

function fact(value, status = 'confirmed') {
  return { status, value, sourceCount: status === 'confirmed' ? 2 : 1, hostCount: status === 'confirmed' ? 2 : 1, alternatives: [] };
}

function candidate(title, aliases, release, studio, extra = {}) {
  const sources = [`https://${title.length}.example.test/a`, `https://${title.length + 1}.example.net/b`];
  const evidence = [
    { field: 'title_ja', value: title, sourceUrl: sources[0], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    { field: 'title_ja', value: title, sourceUrl: sources[1], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    { field: 'media_type', value: 'TV', sourceUrl: sources[0], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    { field: 'media_type', value: 'TV', sourceUrl: sources[1], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    ...(release ? [
      { field: 'release_start', value: release, sourceUrl: sources[0], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
      { field: 'release_start', value: release, sourceUrl: sources[1], sourceClass: 'secondary', rule: 'fixture', observedAt: '' }
    ] : []),
    { field: 'animation_studio', value: studio, sourceUrl: sources[0], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    { field: 'animation_studio', value: studio, sourceUrl: sources[1], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    { field: 'origin_country', value: 'JP', sourceUrl: sources[0], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    { field: 'origin_country', value: 'JP', sourceUrl: sources[1], sourceClass: 'secondary', rule: 'fixture', observedAt: '' }
  ];
  if (aliases) {
    evidence.push(
      { field: 'aliases', value: aliases, sourceUrl: sources[0], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
      { field: 'aliases', value: aliases, sourceUrl: sources[1], sourceClass: 'secondary', rule: 'fixture', observedAt: '' }
    );
  }
  return {
    key: title,
    title,
    sources,
    evidence,
    facts: {
      title_ja: fact(title),
      aliases: aliases ? fact(aliases) : undefined,
      media_type: fact('TV'),
      release_start: release ? fact(release) : undefined,
      animation_studio: fact(studio),
      origin_country: fact('JP'),
      ...extra
    },
    lastSeen: '2026-09-10T00:00:00.000Z'
  };
}

const canonical = candidate('星の旅', 'Star Journey', '2027-04-03', 'Studio Star');
canonical.research = {
  pageUrls: ['https://official.example.jp/work'],
  routes: ['official'],
  sourceFamilies: ['official.example.jp'],
  evidenceFields: ['official_url'],
  noGainPages: 3,
  lastEvidenceAt: '2026-09-09T00:00:00.000Z'
};
const alias = candidate('Star Journey', '', '2027-04-03', 'Studio Star');
alias.research = {
  pageUrls: ['https://database.example.net/work'],
  routes: ['staff'],
  sourceFamilies: ['database.example.net'],
  evidenceFields: ['director'],
  noGainPages: 1,
  lastEvidenceAt: '2026-09-10T00:00:00.000Z'
};
assert.equal(areCandidatesMergeable(canonical, alias), true);
const merged = resolveCandidateEntities([canonical, alias]);
assert.equal(merged.merges, 1);
assert.equal(merged.candidates.length, 1);
assert.equal(merged.candidates[0].title, '星の旅');
assert.equal(merged.candidates[0].facts.title_ja.status, 'confirmed');
assert.equal(merged.candidates[0].facts.title_ja.value, '星の旅');
assert.equal(merged.candidates[0].facts.aliases.status, 'confirmed');
assert.ok(merged.candidates[0].facts.aliases.value.includes('Star Journey'));
assert.equal(merged.candidates[0].facts.release_start.value, '2027-04-03');
assert.equal(merged.candidates[0].research.pageUrls.length, 2);
assert.equal(merged.candidates[0].research.sourceFamilies.length, 2);
assert.equal(merged.candidates[0].research.noGainPages, 1, 'entity merge must not inflate research exhaustion');
assert.equal(merged.candidates[0].research.lastEvidenceAt, '2026-09-10T00:00:00.000Z');

const differentRelease = candidate('Star Journey', '', '2028-04-03', 'Studio Star');
assert.equal(areCandidatesMergeable(canonical, differentRelease), false, 'alias alone must not merge different releases');

const noAlias = candidate('星旅', '', '2027-04-03', 'Studio Star');
assert.equal(areCandidatesMergeable(canonical, noAlias), false, 'similar identity without explicit alias relation must stay separate');

const foreign = candidate('Star Journey', '', '2027-04-03', 'Studio Star', {
  origin_country: fact('OTHER')
});
assert.equal(areCandidatesMergeable(canonical, foreign), false, 'Japanese/non-Japanese candidates must never merge');

const chainA = candidate('Chain A', 'Chain B', '2027-01-01', 'Chain Studio');
const chainB = candidate('Chain B', 'Chain C', '', 'Chain Studio');
const chainC = candidate('Chain C', '', '2028-01-01', 'Chain Studio');
const conservativeChain = resolveCandidateEntities([chainA, chainB, chainC]);
assert.equal(conservativeChain.candidates.length, 2, 'transitive aliases must not bypass a confirmed release conflict');
assert.equal(conservativeChain.merges, 1);

const scaleCandidates = Array.from({ length: 25000 }, (_, index) => ({
  key: `scale-${index}`,
  title: `Scale Work ${index}`,
  sources: [],
  evidence: [],
  facts: {},
  series: {},
  research: {},
  lastSeen: ''
}));
const scale = resolveCandidateEntities(scaleCandidates);
assert.equal(scale.candidates.length, 25000);
assert.equal(scale.merges, 0);
assert.equal(scale.pairChecks, 0, 'unlinked candidates must not be compared pairwise');

console.log('Entity resolution self-test: PASS');
console.log('explicit alias + identity merge: PASS');
console.log('alternate title retained as alias: PASS');
console.log('research progress retained conservatively: PASS');
console.log('different release protection: PASS');
console.log('no-alias conservative separation: PASS');
console.log('origin conflict protection: PASS');
console.log('transitive conflict protection: PASS');
console.log('25k unlinked candidates pairwise scan: NONE');
