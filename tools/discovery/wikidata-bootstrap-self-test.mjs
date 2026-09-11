import assert from 'node:assert/strict';
import { emptyDiscoveryState } from './state.mjs';
import { bootstrapFromWikidata } from './wikidata-bootstrap.mjs';

const state = emptyDiscoveryState();
const fetchImpl = async (url, options) => {
  assert.equal(new URL(url).hostname, 'query.wikidata.org');
  assert.match(String(options?.headers?.['user-agent']), /AnimeMemoryBot/);
  const query = new URL(url).searchParams.get('query') || '';
  assert.match(query, /wdt:P179/);
  assert.match(query, /wdt:P155/);
  assert.match(query, /wdt:P156/);
  assert.match(query, /schema:about/);
  assert.match(query, /https:\/\/ja\.wikipedia\.org\//);
  return new Response(JSON.stringify({ results: { bindings: [
    {
      item: { value: 'https://www.wikidata.org/entity/Q123' },
      itemLabel: { value: 'Dr.STONE SCIENCE FUTURE' },
      classLabel: { value: 'anime television series' },
      date: { value: '2025-01-09T00:00:00Z' },
      official: { value: 'https://dr-stone.jp/' },
      jaArticle: { value: 'https://ja.wikipedia.org/wiki/Dr.STONE' },
      series: { value: 'https://www.wikidata.org/entity/Q456' },
      seriesLabel: { value: 'Dr.STONE' },
      seriesOfficial: { value: 'https://dr-stone.jp/' },
      follows: { value: 'https://www.wikidata.org/entity/Q122' },
      followsLabel: { value: 'Dr.STONE NEW WORLD' },
      followsOfficial: { value: 'https://dr-stone.jp/3rd/' },
      followedBy: { value: 'https://www.wikidata.org/entity/Q124' },
      followedByLabel: { value: 'Dr.STONE SCIENCE FUTURE Part 2' },
      followedByOfficial: { value: 'https://dr-stone.jp/4th/' }
    }
  ] } }), { status: 200, headers: { 'content-type': 'application/sparql-results+json' } });
};

const result = await bootstrapFromWikidata(state, { fetchImpl, limit: 2, observedAt: '2026-09-10T00:00:00.000Z' });
assert.equal(result.fetched, 1);
assert.equal(result.candidatesAdded, 1);
assert.equal(result.officialFrontierAdded, 1);
assert.equal(result.articleFrontierAdded, 1);
assert.equal(result.seriesFrontierAdded, 2);
assert.equal(result.completed, true);
assert.equal(state.wikidataBootstrap.offset, 1);
assert.equal(state.candidates[0].title, 'Dr.STONE SCIENCE FUTURE');
assert.equal(state.candidates[0].series.title, 'Dr.STONE');
assert.ok(state.candidates[0].series.members.some((item) => item.title === 'Dr.STONE NEW WORLD' && item.kind === 'PREQUEL'));
assert.ok(state.candidates[0].series.members.some((item) => item.title === 'Dr.STONE SCIENCE FUTURE Part 2' && item.kind === 'SEQUEL'));
assert.ok(state.candidates[0].series.relations.some((item) => item.sourceTitle === 'Dr.STONE SCIENCE FUTURE' && item.targetTitle === 'Dr.STONE NEW WORLD' && item.kind === 'PREQUEL'));
assert.ok(state.candidates[0].series.relations.some((item) => item.sourceTitle === 'Dr.STONE NEW WORLD' && item.targetTitle === 'Dr.STONE SCIENCE FUTURE' && item.kind === 'SEQUEL'));
assert.ok(state.candidates[0].series.relations.some((item) => item.sourceTitle === 'Dr.STONE SCIENCE FUTURE' && item.targetTitle === 'Dr.STONE SCIENCE FUTURE Part 2' && item.kind === 'SEQUEL'));
assert.ok(state.candidates[0].series.relations.some((item) => item.sourceTitle === 'Dr.STONE SCIENCE FUTURE Part 2' && item.targetTitle === 'Dr.STONE SCIENCE FUTURE' && item.kind === 'PREQUEL'));
assert.ok(state.candidates[0].evidence.some((item) => item.field === 'origin_country' && item.value === 'JP'));
assert.ok(state.candidates[0].evidence.some((item) => item.field === 'media_type' && item.value === 'TV'));
assert.ok(state.candidates[0].evidence.some((item) => item.field === 'release_start' && item.value === '2025-01-09'));
assert.ok(state.frontier.some((item) => item.url === 'https://dr-stone.jp/' && item.candidateHints.includes('Dr.STONE')));
assert.ok(state.frontier.some((item) => item.url === 'https://ja.wikipedia.org/wiki/Dr.STONE' && item.candidateHints.includes('Dr.STONE SCIENCE FUTURE')));
assert.ok(state.frontier.some((item) => item.url === 'https://dr-stone.jp/3rd/' && item.candidateHints.includes('Dr.STONE NEW WORLD')));
assert.ok(state.frontier.some((item) => item.url === 'https://dr-stone.jp/4th/' && item.candidateHints.includes('Dr.STONE SCIENCE FUTURE Part 2')));

const second = await bootstrapFromWikidata(state, { fetchImpl: async () => { throw new Error('must-not-fetch'); } });
assert.equal(second.completed, true);

const throttleState = emptyDiscoveryState();
const throttledAt = new Date('2026-09-11T00:00:00.000Z');
await assert.rejects(
  bootstrapFromWikidata(throttleState, {
    observedAt: throttledAt.toISOString(),
    fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })
  }),
  /wikidata-http-429/
);
assert.equal(throttleState.wikidataBootstrap.retryAfter, '2026-09-11T00:02:00.000Z');
let deferredFetches = 0;
const deferred = await bootstrapFromWikidata(throttleState, {
  observedAt: '2026-09-11T00:01:00.000Z',
  fetchImpl: async () => {
    deferredFetches += 1;
    throw new Error('backoff-must-prevent-fetch');
  }
});
assert.equal(deferredFetches, 0, 'persisted Retry-After must suppress the next WDQS request');
assert.equal(deferred.backoffUntil, '2026-09-11T00:02:00.000Z');

console.log('Wikidata structured bootstrap: PASS');
console.log('country-of-origin Japan gate: PASS');
console.log('reciprocal prequel/sequel graph: PASS');
console.log('series-first relation expansion: PASS');
console.log('exact Japanese Wikipedia sitelink routing: PASS');
console.log('bounded cursor completion: PASS');
console.log('Retry-After persistent backoff: PASS');
