import assert from 'node:assert/strict';
import { normalizeOfficialLandingUrl } from './official-page.mjs';

for (const url of [
  'https://anime.example.jp/',
  'https://anime.example.jp/movie/',
  'https://anime.example.jp/special/'
]) {
  assert.ok(normalizeOfficialLandingUrl(url), `${url} should remain eligible as a work landing page`);
}

for (const url of [
  'https://anime.example.jp/staff-cast/',
  'https://anime.example.jp/goods/',
  'https://anime.example.jp/goods/post-1/',
  'https://anime.example.jp/campaign/',
  'https://anime.example.jp/campaign/gallery/',
  'https://anime.example.jp/blu-ray/',
  'https://anime.example.jp/movie/post-2/',
  'https://anime.example.jp/special/post-2/',
  'https://anime.example.jp/news/post-37/'
]) {
  assert.equal(normalizeOfficialLandingUrl(url), '', `${url} must not become official_url`);
}

console.log('Official landing-page policy self-test: PASS');
console.log('movie/special work roots: PRESERVED');
console.log('post/content/product subpages: BLOCKED');
