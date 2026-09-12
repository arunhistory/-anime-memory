import assert from 'node:assert/strict';
import { diversifyResearchResults } from './research-search.mjs';

const ranked = [
  { url: 'https://a.example.jp/1', score: 300, sourceFamily: 'a.example.jp' },
  { url: 'https://a.example.jp/2', score: 290, sourceFamily: 'a.example.jp' },
  { url: 'https://b.example.net/1', score: 250, sourceFamily: 'b.example.net' },
  { url: 'https://c.example.org/1', score: 240, sourceFamily: 'c.example.org' }
];

const two = diversifyResearchResults(ranked, 2);
assert.deepEqual(two.map((item) => item.url), [
  'https://a.example.jp/1',
  'https://b.example.net/1'
], 'limited deep-search results must prefer independent source families before a second page from the same family');

const four = diversifyResearchResults(ranked, 4);
assert.deepEqual(four.map((item) => item.url), [
  'https://a.example.jp/1',
  'https://b.example.net/1',
  'https://c.example.org/1',
  'https://a.example.jp/2'
], 'after family coverage, remaining capacity may be filled by the next ranked URLs');

console.log('Deep-search source-family diversity self-test: PASS');
console.log('independent families first: PASS');
console.log('ranked fill after diversity coverage: PASS');
