import assert from 'node:assert/strict';
import { normalizeUrl } from './url.mjs';

assert.equal(normalizeUrl('https://example.com/path'), 'https://example.com/path');
assert.equal(normalizeUrl('https://example.com:443/path'), 'https://example.com/path');
assert.equal(normalizeUrl('https://example.com/path?utm_source=test&a=1'), 'https://example.com/path?a=1');
assert.equal(
  normalizeUrl('https://https//vivy-anime.com/news/?id=60157'),
  null,
  'duplicated-scheme crawler corruption must be rejected rather than assigned to host https'
);
assert.equal(
  normalizeUrl('http://http//example.com/path'),
  null,
  'duplicated-scheme crawler corruption must be rejected for http as well'
);

console.log('URL normalization self-test: PASS');
console.log('duplicated-scheme host pollution: BLOCKED');
