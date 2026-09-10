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
  ]
});

const current = {
  key: 'drstonesciencefuture',
  title: 'Dr.STONE SCIENCE FUTURE',
  series: drStoneSeries
};
const map = new Map([[current.key, current]]);
assert.equal(ensureSeriesMemberShells(map, current, '2026-09-11T00:00:00.000Z'), 4);
assert.equal(map.size, 5);

const hints = relatedSeriesHints(current, [...map.values()]);
for (const title of ['Dr.STONE', 'Dr.STONE STONE WARS', 'Dr.STONE 龍水', 'Dr.STONE NEW WORLD', 'Dr.STONE SCIENCE FUTURE']) {
  assert.ok(hints.includes(title), `series hint missing: ${title}`);
}
assert.ok(seriesPriorityBoost({ anchor: 'シリーズ作品一覧', url: 'https://example.test/series' }, hints) >= 45);
assert.ok(seriesPriorityBoost({ anchor: 'Dr.STONE 龍水', url: 'https://example.test/ryusui' }, hints) >= 70);
assert.equal(seriesPriorityBoost({ anchor: 'お問い合わせ', url: 'https://example.test/contact' }, hints), 0);

console.log('Series-first learning self-test: PASS');
