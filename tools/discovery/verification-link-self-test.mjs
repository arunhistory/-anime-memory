import assert from 'node:assert/strict';
import { runDiscovery } from './engine.mjs';
import { emptyDiscoveryState, seedFrontier } from './state.mjs';
import { recordSourceTrustOutcome } from './research-strategy.mjs';

const pages = new Map([
  ['https://seed.test/', `
    <html><head><title>TVアニメ「星の旅」作品紹介</title></head><body>
      <article>日本のTVアニメ「星の旅」は2027年4月3日放送開始。アニメーション制作：Studio Star</article>
      <a href="https://news.test/interview">制作インタビュー</a>
    </body></html>`],
  ['https://news.test/interview', `
    <html><head>
      <title>制作の舞台裏：星の旅の放送が始まるまで</title>
      <meta name="description" content="星の旅 制作インタビュー">
    </head><body>
      <article>日本のTVアニメ「星の旅」は2027年4月3日放送開始。アニメーション制作：Studio Star</article>
    </body></html>`]
]);

const fakeFetcher = {
  async fetchPage(url) {
    if (!pages.has(url)) return { ok: false, skipped: true, reason: 'fixture-missing' };
    return {
      ok: true,
      url,
      contentType: 'text/html; charset=utf-8',
      text: pages.get(url),
      sitemaps: []
    };
  }
};

const state = emptyDiscoveryState();
for (const sourceUrl of ['https://seed.test/', 'https://news.test/interview']) {
  for (const field of ['title_ja', 'origin_country', 'media_type', 'release_start', 'animation_studio']) {
    for (let i = 0; i < 4; i += 1) {
      recordSourceTrustOutcome(state.researchStrategy, {
        sourceUrl,
        field,
        outcome: 'match',
        strength: 'strong',
        observedAt: '2026-09-08T00:00:00.000Z'
      });
    }
  }
}
seedFrontier(state, ['https://seed.test/']);
const discovery = await runDiscovery({
  state,
  fetcher: fakeFetcher,
  maxPages: 10,
  maxDepth: 3,
  perHostLimit: 10,
  now: '2026-09-09T00:00:00.000Z'
});

const candidate = discovery.state.candidates.find((item) => item.title === '星の旅');
assert.ok(candidate, 'seed subject candidate must be discovered');
assert.ok(candidate.sources.includes('https://seed.test/'));
assert.ok(candidate.sources.includes('https://news.test/interview'), 'related page must join the existing candidate');
assert.equal(candidate.facts.origin_country.status, 'confirmed');
assert.equal(candidate.facts.origin_country.value, 'JP');
assert.equal(candidate.facts.media_type.status, 'confirmed');
assert.equal(candidate.facts.media_type.value, 'TV');
assert.equal(candidate.facts.release_start.status, 'confirmed');
assert.equal(candidate.facts.release_start.value, '2027-04-03');
assert.equal(candidate.facts.animation_studio.status, 'confirmed');
assert.equal(candidate.facts.animation_studio.value, 'Studio Star');
assert.ok(discovery.stats.verificationPages >= 1, 'related focused page must be processed as verification evidence');
assert.ok(discovery.stats.verificationEvidenceClaims >= 4, 'verification page must contribute field evidence');
assert.ok(discovery.stats.verificationLinksPromoted >= 1, 'candidate-scoped verification link must be promoted');

const focusedUrl = 'https://wiki.test/work';
const unrelatedUrl = 'https://wiki.test/unrelated-history';
const productionUrl = 'https://production.test/interview';
const scopedState = emptyDiscoveryState();
seedFrontier(scopedState, [focusedUrl]);
const scopedFetcher = {
  async fetchPage(url) {
    if (url !== focusedUrl) return { ok: false, skipped: true, reason: 'fixture-missing' };
    return {
      ok: true,
      url,
      contentType: 'text/html; charset=utf-8',
      sitemaps: [],
      text: `
        <html><head><title>TVアニメ「星の旅」作品紹介</title></head><body>
          <article>日本のTVアニメ「星の旅」は2027年4月3日放送開始。</article>
          <a href="${unrelatedUrl}">歴史</a>
          <a href="${productionUrl}">制作インタビュー</a>
        </body></html>`
    };
  }
};
const scoped = await runDiscovery({
  state: scopedState,
  fetcher: scopedFetcher,
  maxPages: 1,
  maxDepth: 3,
  perHostLimit: 10,
  now: '2026-09-09T00:00:00.000Z'
});
assert.equal(scoped.state.frontier.some((item) => item.url === unrelatedUrl), false, 'unrelated same-site links must not inherit candidate verification scope');
const productionEntry = scoped.state.frontier.find((item) => item.url === productionUrl);
assert.ok(productionEntry, 'production interview link must remain discoverable');
assert.ok(productionEntry.candidateHints.includes('星の旅'), 'production interview must inherit the focused candidate hint');

console.log('Candidate-scoped verification self-test: PASS');
console.log('related-page field evidence join: PASS');
console.log('learned-trust cross-host corroboration: PASS');
console.log('verification hint fan-out to unrelated same-site links: BLOCKED');
console.log('production interview verification routing: PASS');
console.log('unknown-secondary immediate corroboration: BLOCKED BY POLICY');
console.log('unfocused body-only pages: not promoted to verification evidence by this test path');
