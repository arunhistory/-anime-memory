import assert from 'node:assert/strict';
import { emptyDiscoveryState } from './state.mjs';
import {
  SERIES_EXPANSION_RETRY_DELAY_MS,
  expandSeriesFromWikidata,
  pendingWikidataSeriesRefs,
  sanitizeWikidataSeriesExpansionState
} from './wikidata-series-expansion.mjs';

const state = emptyDiscoveryState();
state.candidates.push({
  key: 'drstonesciencefuture',
  title: 'Dr.STONE SCIENCE FUTURE',
  sources: [],
  evidence: [],
  facts: {},
  series: {
    ref: 'https://www.wikidata.org/entity/Q456',
    title: 'Dr.STONE',
    inferredStem: 'Dr.STONE',
    members: [{ title: 'Dr.STONE SCIENCE FUTURE', url: 'https://www.wikidata.org/entity/Q5', kind: 'OTHER' }],
    relations: []
  },
  lastSeen: '2026-09-11T00:00:00.000Z'
});

const titles = [
  ['Q1', 'Dr.STONE', 'anime television series', '2019-07-05T00:00:00Z', 'https://dr-stone.jp/1st/'],
  ['Q2', 'Dr.STONE STONE WARS', 'anime television series', '2021-01-14T00:00:00Z', 'https://dr-stone.jp/2nd/'],
  ['Q3', 'Dr.STONE 龍水', 'anime special', '2022-07-10T00:00:00Z', 'https://dr-stone.jp/ryusui/'],
  ['Q4', 'Dr.STONE NEW WORLD', 'anime television series', '2023-04-06T00:00:00Z', 'https://dr-stone.jp/3rd/'],
  ['Q5', 'Dr.STONE SCIENCE FUTURE', 'anime television series', '2025-01-09T00:00:00Z', 'https://dr-stone.jp/4th/']
];

function stoneBindings() {
  return titles.map(([qid, title, classLabel, date, official], index) => ({
    series: { value: 'https://www.wikidata.org/entity/Q456' },
    seriesLabel: { value: 'Dr.STONE' },
    item: { value: `https://www.wikidata.org/entity/${qid}` },
    itemLabel: { value: title },
    classLabel: { value: classLabel },
    date: { value: date },
    official: { value: official },
    ...(index > 0 ? {
      follows: { value: `https://www.wikidata.org/entity/${titles[index - 1][0]}` },
      followsLabel: { value: titles[index - 1][1] }
    } : {}),
    ...(index < titles.length - 1 ? {
      followedBy: { value: `https://www.wikidata.org/entity/${titles[index + 1][0]}` },
      followedByLabel: { value: titles[index + 1][1] }
    } : {})
  }));
}

let calls = 0;
const fetchImpl = async (url, options) => {
  calls += 1;
  assert.equal(new URL(url).hostname, 'query.wikidata.org');
  assert.match(String(options?.headers?.['user-agent']), /AnimeMemoryBot/);
  const query = new URL(url).searchParams.get('query') || '';
  assert.match(query, /VALUES \?series \{ wd:Q456 \}/);
  assert.match(query, /\?item wdt:P179 \?series/);
  assert.match(query, /\?item wdt:P495 wd:Q17/);
  return new Response(JSON.stringify({ results: { bindings: stoneBindings() } }), {
    status: 200,
    headers: { 'content-type': 'application/sparql-results+json' }
  });
};

const result = await expandSeriesFromWikidata(state, {
  fetchImpl,
  limit: 12,
  observedAt: '2026-09-11T00:00:00.000Z'
});
assert.equal(calls, 1);
assert.equal(result.seriesRequested, 1);
assert.equal(result.seriesExpanded, 1);
assert.equal(result.memberCount, 5);
assert.equal(state.candidates.length, 5);
assert.equal(state.wikidataSeriesExpansion.expandedRefs.includes('https://www.wikidata.org/entity/Q456'), true);
assert.equal(state.wikidataSeriesExpansion.deferredRefs.length, 0);

for (const title of titles.map((item) => item[1])) {
  const candidate = state.candidates.find((item) => item.title === title);
  assert.ok(candidate, `series member candidate missing: ${title}`);
  assert.equal(candidate.series.title, 'Dr.STONE');
  assert.equal(candidate.series.members.length, 5, `full series knowledge missing on ${title}`);
  assert.ok(candidate.series.relations.length >= 8, `series relation graph missing on ${title}`);
  assert.ok(candidate.evidence.some((item) => item.field === 'origin_country' && item.value === 'JP'));
  assert.ok(candidate.evidence.some((item) => item.field === 'media_type'));
}
const stoneWars = state.candidates.find((item) => item.title === 'Dr.STONE STONE WARS');
assert.ok(stoneWars.series.relations.some((item) => item.sourceTitle === 'Dr.STONE STONE WARS' && item.targetTitle === 'Dr.STONE' && item.kind === 'PREQUEL'));
assert.ok(stoneWars.series.relations.some((item) => item.sourceTitle === 'Dr.STONE' && item.targetTitle === 'Dr.STONE STONE WARS' && item.kind === 'SEQUEL'));
assert.equal(state.candidates.find((item) => item.title === 'Dr.STONE 龍水').evidence.some((item) => item.field === 'media_type' && item.value === 'SPECIAL'), true);
assert.ok(state.frontier.some((item) => item.url === 'https://dr-stone.jp/1st/' && item.candidateHints.includes('Dr.STONE')));
assert.ok(state.frontier.some((item) => item.url === 'https://dr-stone.jp/ryusui/' && item.candidateHints.includes('Dr.STONE 龍水')));

const second = await expandSeriesFromWikidata(state, {
  fetchImpl: async () => { throw new Error('already-expanded-series-must-not-fetch'); }
});
assert.equal(second.seriesRequested, 0);
assert.equal(second.seriesExpanded, 0);

const partialState = emptyDiscoveryState();
for (const [key, title, ref] of [
  ['stone', 'Dr.STONE', 'https://www.wikidata.org/entity/Q456'],
  ['missing', 'Missing Series Work', 'https://www.wikidata.org/entity/Q999']
]) {
  partialState.candidates.push({
    key,
    title,
    sources: [],
    evidence: [],
    facts: {},
    series: { ref, title, inferredStem: title, members: [{ title, url: '', kind: 'OTHER' }], relations: [] },
    lastSeen: '2026-09-11T00:00:00.000Z'
  });
}
const attemptedAt = new Date('2026-09-11T00:00:00.000Z');
const partial = await expandSeriesFromWikidata(partialState, {
  limit: 12,
  observedAt: attemptedAt.toISOString(),
  fetchImpl: async (url) => {
    const query = new URL(url).searchParams.get('query') || '';
    assert.match(query, /wd:Q456/);
    assert.match(query, /wd:Q999/);
    return new Response(JSON.stringify({ results: { bindings: stoneBindings() } }), {
      status: 200,
      headers: { 'content-type': 'application/sparql-results+json' }
    });
  }
});
assert.equal(partial.seriesRequested, 2);
assert.equal(partial.seriesExpanded, 1, 'only series with valid returned members may be marked expanded');
assert.deepEqual(partialState.wikidataSeriesExpansion.expandedRefs, ['https://www.wikidata.org/entity/Q456']);
assert.deepEqual(partialState.wikidataSeriesExpansion.deferredRefs, [{
  ref: 'https://www.wikidata.org/entity/Q999',
  retryAfter: new Date(attemptedAt.getTime() + SERIES_EXPANSION_RETRY_DELAY_MS).toISOString()
}]);
assert.deepEqual(
  pendingWikidataSeriesRefs(partialState, Number.POSITIVE_INFINITY, new Date(attemptedAt.getTime() + SERIES_EXPANSION_RETRY_DELAY_MS - 1)),
  [],
  'zero-result series must not busy-loop before retry delay expires'
);
assert.deepEqual(
  pendingWikidataSeriesRefs(partialState, Number.POSITIVE_INFINITY, new Date(attemptedAt.getTime() + SERIES_EXPANSION_RETRY_DELAY_MS)),
  ['https://www.wikidata.org/entity/Q999'],
  'zero-result series must become retryable after the delay'
);

const manyRefs = Array.from({ length: 20001 }, (_, index) => `https://www.wikidata.org/entity/Q${index + 1}`);
const preservedProgress = sanitizeWikidataSeriesExpansionState({ version: 1, expandedRefs: manyRefs, lastRunAt: '2026-09-11T00:00:00.000Z' });
assert.equal(preservedProgress.expandedRefs.length, 20001, 'expanded series progress must not silently truncate at 20,000');

console.log('Wikidata full-series expansion self-test: PASS');
console.log('DR.STONE five-title expansion: PASS');
console.log('reciprocal prequel/sequel graph: PASS');
console.log('expanded-series repeat suppression: PASS');
console.log('zero-result series retry defer: PASS');
console.log('expanded-series progress over 20k: PRESERVED');
