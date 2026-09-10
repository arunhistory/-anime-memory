import assert from 'node:assert/strict';
import { buildReadinessReport } from './readiness-report.mjs';

const state = {
  candidates: [
    { key: 'a', title: 'A', facts: {}, evidence: [], series: {}, research: {} },
    { key: 'b', title: 'B', facts: { origin_country: { status: 'confirmed', value: 'OTHER' } }, evidence: [], series: {}, research: {} }
  ],
  wikidataSeriesExpansion: { version: 1, expandedRefs: [], lastRunAt: '' }
};
const report = buildReadinessReport(state);
assert.equal(report.candidates, 2);
assert.equal(report.identityReady, 0);
assert.equal(report.publishableReady, 0);
assert.equal(report.identityBlockedReasons['japanese-origin-not-confirmed'], 1);
assert.equal(report.identityBlockedReasons['non-japanese-origin'], 1);
assert.equal(report.publicationBlockedReasons['japanese-origin-not-confirmed'], 1);
assert.equal(report.publicationBlockedReasons['non-japanese-origin'], 1);
console.log('Readiness reason report self-test: PASS');
