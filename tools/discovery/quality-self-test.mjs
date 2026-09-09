import assert from 'node:assert/strict';
import { extractDocument, extractAnimeTitleCandidates } from './html.mjs';
import { extractCandidateEvidence } from './evidence.mjs';
import { runDiscovery } from './engine.mjs';
import { emptyDiscoveryState } from './state.mjs';

const genericPage = extractDocument(`<!doctype html><html><head>
<title>アニメ (日本のアニメーション作品) - Wikipedia</title>
</head><body>
<p>アニメ 配信を重視するネットサービスについて説明する。</p>
<p>テレビアニメ作品一覧やアニメ制作の歴史を紹介する。</p>
<p>1963年1月1日放送開始、1997年12月16日公開など複数作品の年代情報を含む。</p>
</body></html>`, 'https://example.test/anime-overview');

const genericTitles = extractAnimeTitleCandidates(genericPage).map((item) => item.title);
assert.equal(genericTitles.includes('配信を重視するネット'), false, 'generic prose after アニメ must not become a title');
assert.equal(genericTitles.some((title) => /日本のアニメーション作品/.test(title)), false, 'general article heading must not become a work title');
assert.equal(genericPage.discoveryOnly, true, 'general anime overview must be link-discovery only');

const officialPage = extractDocument(`<!doctype html><html><head>
<title>花の教室 | TVアニメ公式サイト</title>
</head><body>
<p>花の教室はテレビアニメ作品です。</p>
</body></html>`, 'https://official.test/');
assert.ok(officialPage.candidates.some((item) => item.title === '花の教室'), 'official unquoted page title should still resolve to the work subject');
assert.equal(officialPage.discoveryOnly, false, 'single-work official page must remain evidence-eligible');

const filler = '無関係な説明。'.repeat(500);
const multiWork = extractDocument(`<!doctype html><html><head>
<title>新作アニメニュースまとめ</title>
</head><body>
<p>TVアニメ「星の旅」は2027年4月3日放送開始。</p>
<p>アニメーション制作：Studio Star</p>
${filler}
<p>TVアニメ「海の灯」は1999年8月9日放送開始。</p>
<p>アニメーション制作：Studio Sea</p>
</body></html>`, 'https://news.test/multi');

const star = multiWork.candidates.find((item) => item.title === '星の旅');
const sea = multiWork.candidates.find((item) => item.title === '海の灯');
assert.ok(star && sea, 'both explicitly titled anime works should be detected for exploration');
assert.equal(multiWork.discoveryOnly, true, 'multi-work roundup must not directly persist work evidence');

const starEvidence = extractCandidateEvidence(multiWork, star, '2026-09-09T00:00:00.000Z');
assert.ok(starEvidence.some((item) => item.field === 'release_start' && item.value === '2027-04-03'));
assert.equal(starEvidence.some((item) => item.field === 'release_start' && item.value === '1999-08-09'), false, 'another work date must not leak into candidate evidence');
assert.ok(starEvidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Star'));
assert.equal(starEvidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Sea'), false, 'another work staff must not leak into candidate evidence');

const aggregateUrl = 'https://catalog.test/anime-list';
const workUrl = 'https://catalog.test/work/hana';
const pages = new Map([
  [aggregateUrl, `<!doctype html><html><head><title>2027年春アニメ作品一覧</title></head><body>
    <p>TVアニメ「花の教室」を紹介します。</p>
    <a href="${workUrl}">TVアニメ 花の教室 詳細</a>
  </body></html>`],
  [workUrl, `<!doctype html><html><head><title>花の教室 | TVアニメ公式サイト</title></head><body>
    <p>花の教室はTVアニメ作品です。</p>
    <p>TVアニメ「花の教室」は2027年4月3日放送開始。</p>
  </body></html>`]
]);
const fakeFetcher = {
  async fetchPage(url) {
    const text = pages.get(url);
    if (!text) return { ok: false, skipped: true, reason: 'fixture-miss' };
    return { ok: true, url, text, contentType: 'text/html; charset=utf-8', sitemaps: [] };
  }
};
const state = emptyDiscoveryState();
state.frontier.push({ url: aggregateUrl, priority: 100, depth: 0, discoveredFrom: '' });
const discovery = await runDiscovery({ state, fetcher: fakeFetcher, maxPages: 2, maxDepth: 2, perHostLimit: 2, now: '2026-09-09T00:00:00.000Z' });
const hana = discovery.state.candidates.find((item) => item.title === '花の教室');
assert.ok(hana, 'linked single-work page must still produce the candidate');
assert.deepEqual(hana.sources, [workUrl], 'aggregate source must not be stored as candidate evidence');
assert.equal(hana.evidence.some((item) => item.sourceUrl === aggregateUrl), false, 'aggregate source evidence must not persist');
assert.ok(discovery.stats.discoveryOnlyPages >= 1, 'aggregate page must be counted as discovery-only');
const aggregateDoc = discovery.state.documents.find((item) => item.url === aggregateUrl);
assert.ok(aggregateDoc, 'aggregate page metadata may remain in the discovery index');
assert.deepEqual(aggregateDoc.candidateTitles, [], 'aggregate document must not persist candidate titles');
assert.equal(aggregateDoc.discoveryOnly, true);

console.log('Discovery quality self-test: PASS');
console.log('generic prose false positives: BLOCKED');
console.log('aggregate/list pages: LINK-ONLY');
console.log('single-work page evidence: PASS');
console.log('cross-work evidence leakage: BLOCKED');
