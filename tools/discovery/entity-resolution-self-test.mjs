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
    { field: 'release_start', value: release, sourceUrl: sources[0], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
    { field: 'release_start', value: release, sourceUrl: sources[1], sourceClass: 'secondary', rule: 'fixture', observedAt: '' },
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
      release_start: fact(release),
      animation_studio: fact(studio),
      origin_country: fact('JP'),
      ...extra
    },
    lastSeen: '2026-09-10T00:00:00.000Z'
  };
}

const canonical = candidate('星の旅', 'Star Journey', '2027-04-03', 'Studio Star');
const alias = candidate('Star Journey', '', '2027-04-03', 'Studio Star');
assert.equal(areCandidatesMergeable(canonical, alias), true);
const merged = resolveCandidateEntities([canonical, alias]);
assert.equal(merged.merges, 1);
assert.equal(merged.candidates.length, 1);
assert.equal(merged.candidates[0].title, '星の旅');

const differentRelease = candidate('Star Journey', '', '2028-04-03', 'Studio Star');
assert.equal(areCandidatesMergeable(canonical, differentRelease), false, 'alias alone must not merge different releases');

const noAlias = candidate('星旅', '', '2027-04-03', 'Studio Star');
assert.equal(areCandidatesMergeable(canonical, noAlias), false, 'similar identity without explicit alias relation must stay separate');

const foreign = candidate('Star Journey', '', '2027-04-03', 'Studio Star', {
  origin_country: fact('OTHER')
});
assert.equal(areCandidatesMergeable(canonical, foreign), false, 'Japanese/non-Japanese candidates must never merge');

console.log('Entity resolution self-test: PASS');
console.log('explicit alias + identity merge: PASS');
console.log('different release protection: PASS');
console.log('no-alias conservative separation: PASS');
console.log('origin conflict protection: PASS');
