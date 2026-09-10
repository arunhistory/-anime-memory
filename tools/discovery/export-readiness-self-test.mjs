import assert from 'node:assert/strict';
import {
  discoveryCandidateInformationReadiness,
  readyDiscoveryRecords
} from './to-record.mjs';

function confirmed(value, extra = {}) {
  return { status: 'confirmed', value, sourceCount: 2, hostCount: 2, primarySourceCount: 0, confidence: 90, trainingSamples: 40, alternatives: [], ...extra };
}

const sparse = {
  key: 'drstone',
  title: 'Dr.STONE',
  evidence: [
    { field: 'title_ja', value: 'Dr.STONE', sourceUrl: 'https://a.example/title', directness: 95, rule: 'label-title' },
    { field: 'title_ja', value: 'Dr.STONE', sourceUrl: 'https://b.example/title', directness: 95, rule: 'label-title' },
    { field: 'origin_country', value: 'JP', sourceUrl: 'https://a.example/origin', directness: 98, rule: 'origin-country-labeled-japan' },
    { field: 'media_type', value: 'TV', sourceUrl: 'https://a.example/type', directness: 96, rule: 'label-media-type' },
    { field: 'media_type', value: 'TV', sourceUrl: 'https://b.example/type', directness: 96, rule: 'label-media-type' }
  ],
  facts: {
    title_ja: confirmed('Dr.STONE'),
    origin_country: confirmed('JP'),
    media_type: confirmed('TV'),
    release_start: confirmed('2019-07-05')
  },
  series: { ref: '', title: '', inferredStem: '', members: [] }
};
assert.equal(discoveryCandidateInformationReadiness(sparse, { expandedSeriesRefs: [] }).ready, false);
assert.equal(discoveryCandidateInformationReadiness(sparse, { expandedSeriesRefs: [] }).reason, 'information-domain-breadth-low');

const rich = structuredClone(sparse);
rich.facts.animation_studio = confirmed('TMS/8PAN');
rich.facts.director = confirmed('飯野慎也');
rich.facts.original_type = confirmed('漫画');
rich.facts.original_title = confirmed('Dr.STONE');
rich.facts.official_url = confirmed('https://dr-stone.jp/');
rich.facts.genres = confirmed('SF');
assert.equal(discoveryCandidateInformationReadiness(rich, { expandedSeriesRefs: [] }).ready, true);

const seriesRich = structuredClone(rich);
seriesRich.series = {
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
};
assert.equal(discoveryCandidateInformationReadiness(seriesRich, { expandedSeriesRefs: [] }).reason, 'series-not-expanded');
assert.equal(discoveryCandidateInformationReadiness(seriesRich, { expandedSeriesRefs: ['https://www.wikidata.org/entity/Q456'] }).ready, true);

const columns = ['id','title_ja','media_type','release_start','genres','original_type','original_title','animation_studio','director','official_url','external_ids','synopsis','updated_at'];
const state = {
  candidates: [seriesRich],
  wikidataSeriesExpansion: { version: 1, expandedRefs: ['https://www.wikidata.org/entity/Q456'], lastRunAt: '' }
};
const output = readyDiscoveryRecords(state, columns, '2026-09-11');
assert.equal(output.records.length, 1);
assert.equal(output.skipped.length, 0);

console.log('Information-rich export gate self-test: PASS');
console.log('identity-ready sparse record publication: BLOCKED');
console.log('series expansion before publication: PASS');
