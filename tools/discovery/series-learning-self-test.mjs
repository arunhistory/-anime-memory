import assert from 'node:assert/strict';
import {
  buildSeriesHintIndex,
  deriveSeriesStem,
  ensureSeriesMemberShells,
  mergeSeriesKnowledge,
  relatedSeriesHints,
  seriesPriorityBoost
} from './series-learning.mjs';

assert.equal(deriveSeriesStem('作品名 第3期'), '作品名');
assert.equal(deriveSeriesStem('作品名 Season 2'), '作品名');
assert.equal(deriveSeriesStem('作品名 2nd season'), '作品名');

const drStoneSeries = mergeSeriesKnowledge({}, {
  ref: 'https://www.wikidata.org/entity/Q999999',
  title: 'Dr.STONE',
  members: [
    { title: 'Dr.STONE', kind: 'OTHER', url: 'https://example.test/dr-stone' },
    { title: 'Dr.STONE STONE WARS', kind: 'SEQUEL', url: 'https://example.test/stone-wars' },
    { title: 'Dr.STONE 龍水', kind: 'SPECIAL', url: 'https://example.test/ryusui' },
    { title: 'Dr.STONE NEW WORLD', kind: 'SEQUEL', url: 'https://example.test/new-world' },
    { title: 'Dr.STONE SCIENCE FUTURE', kind: 'SEQUEL', url: 'https://example.test/science-future' }
  ],
  relations: [
    { sourceTitle: 'Dr.STONE STONE WARS', targetTitle: 'Dr.STONE', kind: 'PREQUEL' },
    { sourceTitle: 'Dr.STONE', targetTitle: 'Dr.STONE STONE WARS', kind: 'SEQUEL' }
  ]
});
assert.equal(drStoneSeries.relations.length, 2);
assert.ok(drStoneSeries.relations.some((item) => item.sourceTitle === 'Dr.STONE STONE WARS' && item.targetTitle === 'Dr.STONE' && item.kind === 'PREQUEL'));
assert.ok(drStoneSeries.relations.some((item) => item.sourceTitle === 'Dr.STONE' && item.targetTitle === 'Dr.STONE STONE WARS' && item.kind === 'SEQUEL'));

const current = {
  key: 'drstonesciencefuture',
  title: 'Dr.STONE SCIENCE FUTURE',
  series: drStoneSeries
};
const map = new Map([[current.key, current]]);
assert.equal(ensureSeriesMemberShells(map, current, '2026-09-11T00:00:00.000Z'), 4);
assert.equal(map.size, 5);
for (const member of map.values()) assert.equal(member.series.relations.length, 2);

const legacyHints = relatedSeriesHints(current, [...map.values()]);
const index = buildSeriesHintIndex(map.values());
const indexedHints = relatedSeriesHints(current, index);
for (const title of ['Dr.STONE', 'Dr.STONE STONE WARS', 'Dr.STONE 龍水', 'Dr.STONE NEW WORLD', 'Dr.STONE SCIENCE FUTURE']) {
  assert.ok(legacyHints.includes(title), `legacy series hint missing: ${title}`);
  assert.ok(indexedHints.includes(title), `indexed series hint missing: ${title}`);
}
assert.deepEqual(new Set(indexedHints), new Set(legacyHints), 'indexed series lookup must preserve the legacy series-hint result for the regression fixture');
assert.ok(seriesPriorityBoost({ anchor: 'シリーズ作品一覧', url: 'https://example.test/series' }, indexedHints) >= 45);
assert.ok(seriesPriorityBoost({ anchor: 'Dr.STONE 龍水', url: 'https://example.test/ryusui' }, indexedHints) >= 70);
assert.equal(seriesPriorityBoost({ anchor: 'お問い合わせ', url: 'https://example.test/contact' }, indexedHints), 0);

const largeCandidates = Array.from({ length: 25000 }, (_, item) => ({
  key: `unrelated-${item}`,
  title: `無関係作品 ${String(item).padStart(5, '0')}`,
  series: {}
}));
largeCandidates.push(...map.values());
const largeIndex = buildSeriesHintIndex(largeCandidates);
const largeHints = relatedSeriesHints(current, largeIndex);
for (const title of ['Dr.STONE', 'Dr.STONE STONE WARS', 'Dr.STONE 龍水', 'Dr.STONE NEW WORLD', 'Dr.STONE SCIENCE FUTURE']) {
  assert.ok(largeHints.includes(title), `25k indexed series lookup dropped member: ${title}`);
}

const largeSeries = mergeSeriesKnowledge({}, {
  ref: 'https://www.wikidata.org/entity/Q888888',
  title: 'Long Series',
  members: Array.from({ length: 40 }, (_, item) => ({
    title: `Long Series ${String(item + 1).padStart(2, '0')}`,
    kind: item === 0 ? 'OTHER' : 'SEQUEL',
    url: `https://example.test/long/${item + 1}`
  }))
});
assert.equal(largeSeries.members.length, 40, 'canonical series membership must not be silently truncated at 32 works');

console.log('Series-first learning self-test: PASS');
console.log('series relation graph persistence: PASS');
console.log('series membership over 32 works: PRESERVED');
console.log('indexed series hints preserve legacy semantics: PASS');
console.log('25k unrelated-candidate indexed lookup: PASS');
