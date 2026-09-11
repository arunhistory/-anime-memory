import assert from 'node:assert/strict';
import { sourceFamilyKey, collapseSameFamilyEvidence } from './source-family.mjs';
import { resolveEvidence } from './evidence.mjs';

assert.equal(sourceFamilyKey('https://ja.wikipedia.org/wiki/Test'), 'wikimedia-family');
assert.equal(sourceFamilyKey('https://www.wikidata.org/wiki/Q1'), 'wikimedia-family');
assert.equal(sourceFamilyKey('https://commons.wikimedia.org/wiki/File:X'), 'wikimedia-family');
assert.equal(sourceFamilyKey('https://anime.example.co.jp/a'), 'example.co.jp');
assert.equal(sourceFamilyKey('https://news.example.co.jp/b'), 'example.co.jp');
assert.equal(sourceFamilyKey('https://www.example.com/a'), 'example.com');

const sameFamily = collapseSameFamilyEvidence([
  {
    field: 'release_start',
    value: '2027-04-03',
    sourceUrl: 'https://ja.wikipedia.org/wiki/Test',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: '2026-09-10T00:00:00.000Z'
  },
  {
    field: 'release_start',
    value: '2027-04-03',
    sourceUrl: 'https://www.wikidata.org/wiki/Q1',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: '2026-09-10T00:01:00.000Z'
  }
]);
assert.equal(sameFamily.length, 1, 'same-family duplicate value must count once');
assert.equal(resolveEvidence(sameFamily).release_start.status, 'observed', 'Wikimedia family alone must not self-confirm');

const independent = collapseSameFamilyEvidence([
  ...sameFamily,
  {
    field: 'release_start',
    value: '2027-04-03',
    sourceUrl: 'https://independent.example.net/story',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: '2026-09-10T00:02:00.000Z'
  }
]);
assert.equal(resolveEvidence(independent).release_start.status, 'confirmed', 'two independent families may corroborate');

const conflict = collapseSameFamilyEvidence([
  {
    field: 'release_start',
    value: '2027-04-03',
    sourceUrl: 'https://ja.wikipedia.org/wiki/Test',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: ''
  },
  {
    field: 'release_start',
    value: '2027-04-04',
    sourceUrl: 'https://www.wikidata.org/wiki/Q1',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: ''
  }
]);
assert.equal(conflict.length, 2, 'same-family conflicting values must both remain visible');
assert.equal(resolveEvidence(conflict).release_start.status, 'conflict');

const primaryPreferred = collapseSameFamilyEvidence([
  {
    field: 'media_type',
    value: 'TV',
    sourceUrl: 'https://news.example.co.jp/story',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: ''
  },
  {
    field: 'media_type',
    value: 'TV',
    sourceUrl: 'https://anime.example.co.jp/official',
    sourceClass: 'primary',
    rule: 'fixture',
    observedAt: ''
  }
]);
assert.equal(primaryPreferred.length, 1);
assert.equal(primaryPreferred[0].sourceClass, 'primary', 'primary evidence should win within one family for the same value');

const legacy = collapseSameFamilyEvidence([
  {
    field: 'official_url',
    value: 'https://mobpsycho100.com/',
    sourceUrl: 'https://mobpsycho100.com/',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-url',
    observedAt: ''
  },
  {
    field: 'official_url',
    value: 'https://mobpsycho100.com/news/post-1',
    sourceUrl: 'https://mobpsycho100.com/news/post-1',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-url',
    observedAt: ''
  },
  {
    field: 'official_x',
    value: 'https://twitter.com/mobpsycho_anime',
    sourceUrl: 'https://mobpsycho100.com/',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-social-x',
    observedAt: ''
  },
  {
    field: 'official_x',
    value: 'https://twitter.com/mobpsycho_anime',
    sourceUrl: 'https://mobpsycho100.com/news/post-2',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-social-x',
    observedAt: ''
  },
  {
    field: 'official_x',
    value: 'https://twitter.com/parco_art',
    sourceUrl: 'https://mobpsycho100.com/news/post-21',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-social-x',
    observedAt: ''
  },
  {
    field: 'official_x',
    value: 'https://twitter.com/intent/tweet?text=share',
    sourceUrl: 'https://mobpsycho100.com/',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-social-x',
    observedAt: ''
  },
  {
    field: 'official_x',
    value: 'https://twitter.com/search?q=%23mobpsycho100',
    sourceUrl: 'https://mobpsycho100.com/',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-social-x',
    observedAt: ''
  },
  {
    field: 'official_youtube',
    value: 'https://www.youtube.com/channel/UCcjqSFXBg2cGQg5r0YooMiA',
    sourceUrl: 'https://mobpsycho100.com/',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-youtube',
    observedAt: ''
  },
  {
    field: 'official_youtube',
    value: 'https://www.youtube.com/playlist?list=bad',
    sourceUrl: 'https://mobpsycho100.com/',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-youtube',
    observedAt: ''
  },
  {
    field: 'official_youtube',
    value: 'https://www.youtube.com/watch?v=bad',
    sourceUrl: 'https://mobpsycho100.com/',
    sourceClass: 'primary',
    directness: 100,
    rule: 'primary-page-youtube',
    observedAt: ''
  }
]);
assert.deepEqual(
  legacy.map((item) => [item.field, item.value]).sort(),
  [
    ['official_url', 'https://mobpsycho100.com/'],
    ['official_x', 'https://twitter.com/mobpsycho_anime'],
    ['official_youtube', 'https://www.youtube.com/channel/UCcjqSFXBg2cGQg5r0YooMiA']
  ].sort(),
  'legacy official evidence migration must preserve only landing URL and landing-page official profiles/channels'
);
assert.ok(legacy.every((item) => item.rule.startsWith('legacy-primary-')));

console.log('Source family self-test: PASS');
console.log('Wikimedia cross-host self-confirmation: BLOCKED');
console.log('same registrable-family duplication: BLOCKED');
console.log('independent-family corroboration: PASS');
console.log('same-family conflicts preserved: PASS');
console.log('legacy news/share/search/playlist official evidence: REMOVED');
console.log('legacy landing official URL/profile/channel: PRESERVED');
