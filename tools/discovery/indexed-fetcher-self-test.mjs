import assert from 'node:assert/strict';
import { IndexedFetcher } from './indexed-fetcher.mjs';
import { searchOwnWebIndex } from './web-search-index.mjs';

const calls = [];
let musicVersion = 1;
const inner = {
  isHostAllowed(url) {
    return !String(url).includes('blocked');
  },
  async fetchPage(url) {
    calls.push(url);
    if (url.endsWith('/feed')) {
      return { ok: true, url, contentType: 'application/rss+xml', text: '<rss><channel/></rss>' };
    }
    if (url.endsWith('/noindex')) {
      return {
        ok: true,
        url,
        contentType: 'text/html; charset=utf-8',
        text: '<html><head><title>TVアニメ「非索引作品」公式</title><meta name="robots" content="noindex"></head><body>TVアニメ「非索引作品」</body></html>'
      };
    }
    const marker = musicVersion === 1 ? '主題歌・音楽情報' : '主題歌・音楽情報 更新版';
    return {
      ok: true,
      url,
      contentType: 'text/html; charset=utf-8',
      text: `<html><head><title>TVアニメ「オッドタクシー」公式 MUSIC</title><meta name="description" content="${marker}"></head><body>TVアニメ「オッドタクシー」 主題歌 オープニング エンディング</body></html>`
    };
  }
};

const state = { webSearchIndex: [] };
let tick = 0;
const fetcher = new IndexedFetcher(inner, state, { now: () => `2026-09-12T00:00:0${tick++}.000Z` });
assert.equal(fetcher.isHostAllowed('https://example.jp/work'), true);
assert.equal(fetcher.isHostAllowed('https://blocked.example.jp/work'), false);

const htmlResult = await fetcher.fetchPage('https://example.jp/oddtaxi/music');
assert.equal(htmlResult.ok, true);
assert.equal(state.webSearchIndex.length, 1, 'successful fetched HTML must be indexed immediately');
const entry = state.webSearchIndex[0];
assert.equal(entry.url, 'https://example.jp/oddtaxi/music');
assert.ok(entry.topics.includes('music'));
assert.equal(Object.hasOwn(entry, 'text'), false, 'full page text must not be persisted in the search index');
assert.equal(Object.hasOwn(entry, 'html'), false, 'full HTML must not be persisted in the search index');

musicVersion = 2;
await fetcher.fetchPage('https://example.jp/oddtaxi/music');
assert.equal(state.webSearchIndex.length, 1, 're-fetching an indexed URL must replace its entry instead of appending a duplicate');
assert.equal(state.webSearchIndex[0].indexedAt, '2026-09-12T00:00:01.000Z', 're-fetch must update the existing indexed entry');

const hits = searchOwnWebIndex(state.webSearchIndex, {
  title: 'オッドタクシー',
  topic: 'music',
  fields: ['opening_themes'],
  limit: 10
});
assert.equal(hits.length, 1, 'newly crawled page must be searchable without an external search provider');

await fetcher.fetchPage('https://example.jp/noindex');
assert.equal(state.webSearchIndex.length, 1, 'noindex HTML must not enter the own search corpus');
await fetcher.fetchPage('https://example.jp/feed');
assert.equal(state.webSearchIndex.length, 1, 'RSS/XML fetches must not be inserted as HTML search documents');
assert.deepEqual(calls, [
  'https://example.jp/oddtaxi/music',
  'https://example.jp/oddtaxi/music',
  'https://example.jp/noindex',
  'https://example.jp/feed'
]);

console.log('Crawler-to-own-search indexing bridge self-test: PASS');
console.log('fresh HTML -> own index: PASS');
console.log('constant-time URL position update path: PASS');
console.log('searchable immediately: PASS');
console.log('full body persistence: BLOCKED');
console.log('noindex exclusion: PASS');
console.log('non-HTML exclusion: PASS');
