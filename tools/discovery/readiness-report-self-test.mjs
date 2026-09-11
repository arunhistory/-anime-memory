import assert from 'node:assert/strict';
import { buildReadinessReport } from './readiness-report.mjs';

const readyEvidence = [
  { field: 'title_ja', value: 'C', sourceUrl: 'https://catalog.example.jp/c', directness: 96, rule: 'anime-title-candidate' },
  { field: 'title_ja', value: 'C', sourceUrl: 'https://news.example.net/c', directness: 88, rule: 'anime-title-candidate' },
  { field: 'origin_country', value: 'JP', sourceUrl: 'https://catalog.example.jp/c', directness: 98, rule: 'origin-country-labeled-japan' },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://catalog.example.jp/c', directness: 96, rule: 'media-tv' }
];

const state = {
  candidates: [
    { key: 'a', title: 'A', facts: {}, evidence: [], series: {}, research: {} },
    { key: 'b', title: 'B', facts: { origin_country: { status: 'confirmed', value: 'OTHER' } }, evidence: [], series: {}, research: {} },
    {
      key: 'c',
      title: 'C',
      facts: {
        title_ja: { status: 'confirmed', value: 'C' },
        origin_country: { status: 'confirmed', value: 'JP' },
        media_type: { status: 'confirmed', value: 'TV' },
        director: { status: 'confirmed', value: 'Director C' },
        release_start: { status: 'confirmed', value: '2026-01-01' }
      },
      evidence: readyEvidence,
      series: {},
      research: {}
    }
  ],
  wikidataSeriesExpansion: { version: 1, expandedRefs: [], lastRunAt: '' }
};
const report = buildReadinessReport(state);
assert.equal(report.candidates, 3);
assert.equal(report.identityReady, 1);
assert.equal(report.publishableReady, 0);
assert.equal(report.identityBlockedReasons['japanese-origin-not-confirmed'], 1);
assert.equal(report.identityBlockedReasons['non-japanese-origin'], 1);
assert.equal(report.publicationBlockedReasons['japanese-origin-not-confirmed'], 1);
assert.equal(report.publicationBlockedReasons['non-japanese-origin'], 1);
assert.equal(report.identityReadyAverageConfirmedInformationFields, 2, 'identity-ready average must expose confirmed information progress instead of dilution by all candidates');
assert.equal(report.maxConfirmedInformationFields, 2, 'max confirmed information fields must expose the leading candidate depth');
console.log('Readiness reason report self-test: PASS');
console.log('identity-ready confirmed information average: PASS');
console.log('maximum confirmed information depth: PASS');
