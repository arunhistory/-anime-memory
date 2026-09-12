import assert from 'node:assert/strict';
import { INITIAL_CSV_RECORD_LIMIT, takeInitialPackage } from './public-package.mjs';

const fixture = (index) => ({
  title_ja: `公開候補${index}`,
  media_type: 'TV',
  synopsis: ''
});

assert.equal(INITIAL_CSV_RECORD_LIMIT, 500);
assert.equal(takeInitialPackage(Array.from({ length: 499 }, (_, index) => fixture(index))).selected.length, 0);
const packaged = takeInitialPackage(Array.from({ length: 501 }, (_, index) => fixture(index)));
assert.equal(packaged.selected.length, 500);
assert.equal(packaged.remaining.length, 1);
const geminiStaged = Array.from({ length: 500 }, (_, index) => ({ ...fixture(index), synopsis: index < 499 ? '概要' : '' }));
assert.equal(takeInitialPackage(geminiStaged, { requireSynopsis: true }).selected.length, 0);

await import('./confirmed-csv-self-test.mjs');

console.log('Public package self-test: PASS');
console.log('public CSV package size: 500');
console.log('499 public-ready works -> no public file package: PASS');
console.log('501 public-ready works -> 500 selected + 1 waiting: PASS');
console.log('pending state persistence: NONE');
