import assert from 'node:assert/strict';
import { promoteResearchFrontierForCrawl, restoreUnprocessedResearchFrontier } from './research-frontier.mjs';
import { urlHash } from './url.mjs';

const researchUrl = 'https://example.jp/oddtaxi/music';
const discoveryUrl = 'https://example.jp/anime/news';
const state = {
  frontier: [{
    url: discoveryUrl,
    priority: 50,
    depth: 1,
    discoveredFrom: '',
    candidateHints: []
  }],
  researchFrontier: [{
    url: researchUrl,
    priority: 400,
    depth: 0,
    discoveredFrom: '',
    candidateHints: ['オッドタクシー']
  }],
  visited: [urlHash(researchUrl), urlHash(discoveryUrl)]
};

const promotion = promoteResearchFrontierForCrawl(state);
assert.deepEqual(promotion, { promoted: 1, merged: 0, revisitCount: 1 });
assert.equal(state.researchFrontier.length, 0);
assert.equal(state.frontier.length, 2);
const promoted = state.frontier.find((entry) => entry.url === researchUrl);
assert.equal(promoted.researchSearch, true);
assert.deepEqual(promoted.candidateHints, ['オッドタクシー']);
assert.ok(!state.visited.includes(urlHash(researchUrl)), 'research URL must be reopened for current-page verification');
assert.ok(state.visited.includes(urlHash(discoveryUrl)), 'ordinary discovery visited state must remain untouched');

const restoredCount = restoreUnprocessedResearchFrontier(state);
assert.equal(restoredCount, 1);
assert.equal(state.frontier.length, 1);
assert.equal(state.frontier[0].url, discoveryUrl);
assert.equal(state.researchFrontier.length, 1);
assert.equal(state.researchFrontier[0].url, researchUrl);
assert.equal(Object.hasOwn(state.researchFrontier[0], 'researchSearch'), false, 'transient routing marker must not persist');

const mergeState = {
  frontier: [{
    url: researchUrl,
    priority: 10,
    depth: 2,
    discoveredFrom: 'https://example.jp/',
    candidateHints: ['既存ヒント']
  }],
  researchFrontier: [{
    url: researchUrl,
    priority: 500,
    depth: 0,
    discoveredFrom: '',
    candidateHints: ['オッドタクシー']
  }],
  visited: [urlHash(researchUrl)]
};
const merged = promoteResearchFrontierForCrawl(mergeState);
assert.deepEqual(merged, { promoted: 0, merged: 1, revisitCount: 1 });
assert.equal(mergeState.frontier.length, 1);
assert.equal(mergeState.frontier[0].priority, 500);
assert.equal(mergeState.frontier[0].researchSearch, true);
assert.deepEqual(mergeState.frontier[0].candidateHints, ['既存ヒント', 'オッドタクシー']);

console.log('Research frontier lifecycle self-test: PASS');
console.log('visited research URL reopen: PASS');
console.log('ordinary visited state preserved: PASS');
console.log('unprocessed research restoration: PASS');
console.log('existing frontier merge: PASS');
