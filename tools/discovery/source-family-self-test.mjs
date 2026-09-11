import assert from 'node:assert/strict';
import { sourceFamilyKey, collapseSameFamilyEvidence } from './source-family.mjs';
import { resolveEvidence } from './evidence.mjs';

assert.equal(sourceFamilyKey('https://ja.wikipedia.org/wiki/Test'), 'wikimedia-family');
assert.equal(sourceFamilyKey('https://www.wikidata.org/wiki/Q1'), 'wikimedia-family');
assert.equal(sourceFamilyKey('https://commons.wikimedia.org/wiki/File:X'), 'wikimedia-family');
assert.equal(sourceFamilyKey('https://anime.example.co.jp/a'), 'example.co.jp');
assert.equal(sourceFamilyKey('https://news.example.co.jp/b'), 'example.co.jp');
assert.equal(sourceFamilyKey('https://www.example.com/a'), 'example.com');
assert.equal(
  sourceFamilyKey('https://web.archive.org/web/20200803173725/https://hamehura-anime.com/onair/'),
  'hamehura-anime.com',
  'Wayback snapshot must belong to the original site family'
);
assert.equal(
  sourceFamilyKey('https://web.archive.org/web/20200803173725*/https://hamehura-anime.com/staff/'),
  'hamehura-anime.com',
  'Wayback wildcard snapshot must belong to the original site family'
);
assert.equal(
  sourceFamilyKey('https://web.archive.org/web/20200803173725/https://ja.wikipedia.org/wiki/Test'),
  'wikimedia-family',
  'archived Wikipedia page must remain in Wikimedia family'
);
assert.equal(
  sourceFamilyKey('https://web.archive.org/web/20200803173725/http://web.archive.org/screenshot/https://hamehura-anime.com/onair/'),
  'hamehura-anime.com',
  'nested Wayback screenshot wrapper must resolve to the embedded original site family'
);
assert.equal(
  sourceFamilyKey('http://web.archive.org/screenshot/https://hamehura-anime.com/onair/'),
  'hamehura-anime.com',
  'direct Wayback screenshot wrapper must resolve to the embedded original site family'
);
assert.equal(
  sourceFamilyKey('https://web.archive.org/save/https://hamehura-anime.com/onair/'),
  '',
  'unresolved Wayback UI URLs must never become an independent archive.org source family'
);

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

const archivedSameFamily = collapseSameFamilyEvidence([
  {
    field: 'director',
    value: 'Director A',
    sourceUrl: 'https://hamehura-anime.com/staff/',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: '2026-09-10T00:00:00.000Z'
  },
  {
    field: 'director',
    value: 'Director A',
    sourceUrl: 'https://web.archive.org/web/20200803173725/https://hamehura-anime.com/staff/',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: '2026-09-10T00:01:00.000Z'
  },
  {
    field: 'director',
    value: 'Director A',
    sourceUrl: 'https://web.archive.org/web/20200803173725/http://web.archive.org/screenshot/https://hamehura-anime.com/staff/',
    sourceClass: 'secondary',
    rule: 'fixture',
    observedAt: '2026-09-10T00:02:00.000Z'
  }
]);
assert.equal(archivedSameFamily.length, 1, 'live site and all resolvable Wayback copies must count as one source family');
assert.equal(resolveEvidence(archivedSameFamily).director.status, 'observed', 'Wayback copies must not independently confirm their original source');

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

const currentMovieRoot = collapseSameFamilyEvidence([{
  field: 'official_url', value: 'https://anime.example.jp/movie/', sourceUrl: 'https://anime.example.jp/movie/',
  sourceClass: 'primary', rule: 'primary-landing-page-url', observedAt: ''
}]);
const currentSpecialRoot = collapseSameFamilyEvidence([{
  field: 'official_url', value: 'https://anime.example.jp/special/', sourceUrl: 'https://anime.example.jp/special/',
  sourceClass: 'primary', rule: 'primary-landing-page-url', observedAt: ''
}]);
assert.equal(currentMovieRoot.length, 1, 'movie work root must remain eligible as official_url');
assert.equal(currentSpecialRoot.length, 1, 'special work root must remain eligible as official_url');

for (const url of [
  'https://anime.example.jp/staff-cast/',
  'https://anime.example.jp/goods/',
  'https://anime.example.jp/goods/post-1/',
  'https://anime.example.jp/campaign/',
  'https://anime.example.jp/blu-ray/',
  'https://anime.example.jp/movie/post-2/',
  'https://anime.example.jp/special/post-2/'
]) {
  const filtered = collapseSameFamilyEvidence([{
    field: 'official_url', value: url, sourceUrl: url,
    sourceClass: 'primary', rule: 'primary-landing-page-url', observedAt: ''
  }]);
  assert.equal(filtered.length, 0, `${url} must not survive as current official_url evidence`);
}

assert.equal(collapseSameFamilyEvidence([{
  field: 'official_x', value: 'https://twitter.com/anime_official', sourceUrl: 'https://anime.example.jp/goods/post-1/',
  sourceClass: 'primary', rule: 'primary-landing-social-x-profile', observedAt: ''
}]).length, 0, 'content-page landing social evidence must be removed');
assert.equal(collapseSameFamilyEvidence([{
  field: 'official_youtube', value: 'https://www.youtube.com/@anime_official', sourceUrl: 'https://anime.example.jp/campaign/',
  sourceClass: 'primary', rule: 'primary-landing-youtube-channel', observedAt: ''
}]).length, 0, 'content-page landing YouTube evidence must be removed');

console.log('Source family self-test: PASS');
console.log('Wikimedia cross-host self-confirmation: BLOCKED');
console.log('same registrable-family duplication: BLOCKED');
console.log('Wayback/original source-family duplication: BLOCKED');
console.log('nested Wayback screenshot family duplication: BLOCKED');
console.log('unresolved Wayback independent family: BLOCKED');
console.log('independent-family corroboration: PASS');
console.log('same-family conflicts preserved: PASS');
console.log('legacy news/share/search/playlist official evidence: REMOVED');
console.log('legacy landing official URL/profile/channel: PRESERVED');
console.log('current content-page landing evidence: REMOVED');
console.log('movie/special work landing roots: PRESERVED');
