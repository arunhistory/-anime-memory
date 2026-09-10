import assert from 'node:assert/strict';
import { publishableDiscoveryReadiness } from './to-record.mjs';
import { recordCandidateResearch } from './research-completion.mjs';

function confirmed(value) {
  return { status: 'confirmed', value, sourceCount: 2, hostCount: 2, primarySourceCount: 0, confidence: 90, trainingSamples: 40, alternatives: [] };
}

let research = {};
for (const [url, field] of [
  ['https://dr-stone.jp/staff/', 'director'],
  ['https://anime.example.net/music/', 'opening_themes']
]) {
  research = recordCandidateResearch(research, {
    url,
    evidence: [{ field, value: 'fixture' }],
    observedAt: '2026-09-11T00:00:00.000Z'
  });
}

const candidate = {
  key: 'drstonesciencefuture',
  title: 'Dr.STONE SCIENCE FUTURE',
  evidence: [
    { field: 'title_ja', value: 'Dr.STONE SCIENCE FUTURE', sourceUrl: 'https://dr-stone.jp/', directness: 99, rule: 'label-title' },
    { field: 'title_ja', value: 'Dr.STONE SCIENCE FUTURE', sourceUrl: 'https://anime.example.net/title', directness: 95, rule: 'label-title' },
    { field: 'origin_country', value: 'JP', sourceUrl: 'https://dr-stone.jp/', directness: 98, rule: 'origin-country-labeled-japan' },
    { field: 'media_type', value: 'TV', sourceUrl: 'https://dr-stone.jp/', directness: 99, rule: 'label-media-type' },
    { field: 'media_type', value: 'TV', sourceUrl: 'https://anime.example.net/type', directness: 95, rule: 'label-media-type' }
  ],
  facts: {
    title_ja: confirmed('Dr.STONE SCIENCE FUTURE'),
    origin_country: confirmed('JP'),
    media_type: confirmed('TV'),
    release_start: confirmed('2025-01-09'),
    episode_count: confirmed('24'),
    animation_studio: confirmed('TMS Entertainment'),
    production_name: confirmed('Dr.STONE Project'),
    director: confirmed('Director A'),
    series_composition: confirmed('Writer B'),
    characters: confirmed('千空::MAIN::Actor A'),
    music: confirmed('Composer A'),
    opening_themes: confirmed('OP::Song A::Artist A::::::'),
    original_type: confirmed('漫画'),
    original_author: confirmed('Author A'),
    official_url: confirmed('https://dr-stone.jp/'),
    broadcast_networks: confirmed('TOKYO MX')
  },
  research,
  series: {
    ref: 'https://www.wikidata.org/entity/Q456',
    title: 'Dr.STONE',
    inferredStem: 'Dr.STONE',
    members: [
      { title: 'Dr.STONE', url: '', kind: 'OTHER' },
      { title: 'Dr.STONE STONE WARS', url: '', kind: 'SEQUEL' },
      { title: 'Dr.STONE 龍水', url: '', kind: 'SPECIAL' },
      { title: 'Dr.STONE NEW WORLD', url: '', kind: 'SEQUEL' },
      { title: 'Dr.STONE SCIENCE FUTURE', url: '', kind: 'SEQUEL' }
    ]
  }
};

const beforeSeries = publishableDiscoveryReadiness(candidate, { expandedSeriesRefs: [] });
assert.equal(beforeSeries.ready, false);
assert.equal(beforeSeries.reason, 'series-not-expanded');

const afterSeries = publishableDiscoveryReadiness(candidate, {
  expandedSeriesRefs: ['https://www.wikidata.org/entity/Q456']
});
assert.equal(afterSeries.ready, true);
assert.equal(afterSeries.information.mode, 'information-rich');

const sparse = structuredClone(candidate);
sparse.facts = {
  title_ja: confirmed('Dr.STONE SCIENCE FUTURE'),
  origin_country: confirmed('JP'),
  media_type: confirmed('TV'),
  release_start: confirmed('2025-01-09')
};
const sparseStatus = publishableDiscoveryReadiness(sparse, {
  expandedSeriesRefs: ['https://www.wikidata.org/entity/Q456']
});
assert.equal(sparseStatus.ready, false);
assert.match(sparseStatus.reason, /^information-/);

console.log('Publishable readiness self-test: PASS');
console.log('series-not-expanded publication: BLOCKED');
console.log('name-only/sparse publication: BLOCKED');
