import assert from 'node:assert/strict';
import {
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

const hints = relatedSeriesHints(current, [...map.values()]);
for (const title of ['Dr.STONE', 'Dr.STONE STONE WARS', 'Dr.STONE 龍水', 'Dr.STONE NEW WORLD', 'Dr.STONE SCIENCE FUTURE']) {
  assert.ok(hints.includes(title), `series hint missing: ${title}`);
}
assert.ok(seriesPriorityBoost({ anchor: 'シリーズ作品一覧', url: 'https://example.test/series' }, hints) >= 45);
assert.ok(seriesPriorityBoost({ anchor: 'Dr.STONE 龍水', url: 'https://example.test/ryusui' }, hints) >= 70);
assert.equal(seriesPriorityBoost({ anchor: 'お問い合わせ', url: 'https://example.test/contact' }, hints), 0);

const largeSeries = mergeSeriesKnowledge({}, {
  ref: 'https://www.wikidata.org/entity/Q888888',
  title: 'Long Series',
  members: Array.from({ length: 40 }, (_, index) => ({
    title: `Long Series ${String(index + 1).padStart(2, '0')}`,
    kind: index === 0 ? 'OTHER' : 'SEQUEL',
    url: `https://example.test/long/${index + 1}`
  }))
});
assert.equal(largeSeries.members.length, 40, 'canonical series membership must not be silently truncated at 32 works');

console.log('Series-first learning self-test: PASS');
console.log('series relation graph persistence: PASS');
console.log('series membership over 32 works: PRESERVED');
