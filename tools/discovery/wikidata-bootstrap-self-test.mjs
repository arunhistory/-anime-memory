import assert from 'node:assert/strict';
import { emptyDiscoveryState } from './state.mjs';
import { bootstrapFromWikidata } from './wikidata-bootstrap.mjs';

const state = emptyDiscoveryState();
const fetchImpl = async (url, options) => {
  assert.equal(new URL(url).hostname, 'query.wikidata.org');
  assert.match(String(options?.headers?.['user-agent']), /AnimeMemoryBot/);
  return new Response(JSON.stringify({ results: { bindings: [
    {
      item: { value: 'https://www.wikidata.org/entity/Q123' },
      itemLabel: { value: '星の旅' },
      classLabel: { value: 'anime television series' },
      date: { value: '2027-04-03T00:00:00Z' }
    }
  ] } }), { status: 200, headers: { 'content-type': 'application/sparql-results+json' } });
};

const result = await bootstrapFromWikidata(state, { fetchImpl, limit: 2, observedAt: '2026-09-10T00:00:00.000Z' });
assert.equal(result.fetched, 1);
assert.equal(result.candidatesAdded, 1);
assert.equal(result.completed, true);
assert.equal(state.wikidataBootstrap.offset, 1);
assert.equal(state.candidates[0].title, '星の旅');
assert.ok(state.candidates[0].evidence.some((item) => item.field === 'origin_country' && item.value === 'JP'));
assert.ok(state.candidates[0].evidence.some((item) => item.field === 'media_type' && item.value === 'TV'));
assert.ok(state.candidates[0].evidence.some((item) => item.field === 'release_start' && item.value === '2027-04-03'));

const second = await bootstrapFromWikidata(state, { fetchImpl: async () => { throw new Error('must-not-fetch'); } });
assert.equal(second.completed, true);

console.log('Wikidata structured bootstrap: PASS');
console.log('country-of-origin Japan gate: PASS');
console.log('bounded cursor completion: PASS');
