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

const verifiedPrimaryPreferred = collapseSameFamilyEvidence([
  {
    field: 'director',
    value: '検証監督',
    sourceUrl: 'https://anime.example.co.jp/self-declared',
    sourceClass: 'primary',
    directness: 100,
    verifiedPrimary: false,
    rule: 'fixture',
    observedAt: ''
  },
  {
    field: 'director',
    value: '検証監督',
    sourceUrl: 'https://official.example.co.jp/staff',
    sourceClass: 'primary',
    directness: 90,
    verifiedPrimary: true,
    rule: 'fixture',
    observedAt: ''
  }
]);
assert.equal(verifiedPrimaryPreferred.length, 1);
assert.equal(verifiedPrimaryPreferred[0].verifiedPrimary, true, 'externally verified primary evidence must not be lost during same-family collapse');
assert.equal(verifiedPrimaryPreferred[0].sourceUrl, 'https://official.example.co.jp/staff');

console.log('Source family self-test: PASS');
console.log('Wikimedia cross-host self-confirmation: BLOCKED');
console.log('same registrable-family duplication: BLOCKED');
console.log('independent-family corroboration: PASS');
console.log('same-family conflicts preserved: PASS');
console.log('verified primary provenance collapse: PASS');
