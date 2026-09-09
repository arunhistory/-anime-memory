import assert from 'node:assert/strict';
import { extractDocument, extractAnimeTitleCandidates } from './html.mjs';
import { extractCandidateEvidence, resolveEvidence } from './evidence.mjs';
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
assert.equal(officialPage.subjectCandidate?.title, '花の教室', 'official work page subject must be identified');
assert.equal(officialPage.discoveryOnly, false, 'single-work official page must remain evidence-eligible');

const quotedHeadline = extractDocument(`<!doctype html><html><head>
<title>ニュース：TVアニメ『星の旅』放送決定</title>
</head><body>
<p>TVアニメ『星の旅』は2027年4月3日放送開始。</p>
</body></html>`, 'https://news.test/star-headline');
assert.equal(quotedHeadline.subjectCandidate?.title, '星の旅', 'quoted anime title in page heading must become the page subject');

const urlTitlePage = extractDocument(`<!doctype html><html><head>
<title>作品紹介</title>
</head><body>
<p>TVアニメ「https://ja.wikipedia.org/w/index.php?title=海底少年マリン&oldid=110320280」放送情報。</p>
</body></html>`, 'https://example.test/url-title');
assert.equal(urlTitlePage.candidates.some((item) => /^https?:\/\//i.test(item.title)), false, 'URL must never become an anime title candidate');

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

const ambiguousMedia = extractDocument(`<!doctype html><html><head>
<title>星の旅 | TVアニメ公式サイト</title>
</head><body>
<p>TVアニメ「星の旅」を紹介する。</p>
<p>関連情報として劇場版の企画にも触れる。</p>
</body></html>`, 'https://official.test/star-mixed-media');
const ambiguousStar = ambiguousMedia.candidates.find((item) => item.title === '星の旅');
assert.ok(ambiguousStar);
const ambiguousFacts = resolveEvidence(extractCandidateEvidence(ambiguousMedia, ambiguousStar, '2026-09-09T00:00:00.000Z'));
assert.equal(ambiguousFacts.media_type.status, 'conflict', 'multiple media types on one page must not be collapsed to the first match');
assert.equal(ambiguousFacts.media_type.value, '');

const majorityConflict = resolveEvidence([
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://a.test/star', rule: 'fixture', observedAt: '' },
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://b.test/star', rule: 'fixture', observedAt: '' },
  { field: 'release_start', value: '2027-04-04', sourceUrl: 'https://c.test/star', rule: 'fixture', observedAt: '' }
]);
assert.equal(majorityConflict.release_start.status, 'conflict', 'conflicting scalar facts must not be decided by majority vote');
assert.equal(majorityConflict.release_start.value, '');

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

const subjectUrl = 'https://subject.test/star';
const subjectPages = new Map([
  [subjectUrl, `<!doctype html><html><head><title>星の旅 | TVアニメ公式サイト</title></head><body>
    <p>TVアニメ「星の旅」は2027年4月3日放送開始。</p>
    <p>アニメーション制作：Studio Star</p>
    <p>関連作品としてTVアニメ「海の灯」は1999年8月9日放送開始。</p>
    <p>アニメーション制作：Studio Sea</p>
  </body></html>`]
]);
const subjectFetcher = {
  async fetchPage(url) {
    const text = subjectPages.get(url);
    if (!text) return { ok: false, skipped: true, reason: 'fixture-miss' };
    return { ok: true, url, text, contentType: 'text/html; charset=utf-8', sitemaps: [] };
  }
};
const subjectState = emptyDiscoveryState();
subjectState.frontier.push({ url: subjectUrl, priority: 100, depth: 0, discoveredFrom: '' });
const subjectDiscovery = await runDiscovery({ state: subjectState, fetcher: subjectFetcher, maxPages: 1, maxDepth: 1, perHostLimit: 1, now: '2026-09-09T00:00:00.000Z' });
const subjectStar = subjectDiscovery.state.candidates.find((item) => item.title === '星の旅');
const secondarySea = subjectDiscovery.state.candidates.find((item) => item.title === '海の灯');
assert.ok(subjectStar, 'page subject candidate must be persisted');
assert.ok(secondarySea, 'secondary anime mention may be retained for future discovery');
assert.ok(subjectStar.evidence.some((item) => item.field === 'release_start' && item.value === '2027-04-03'), 'subject must retain detailed evidence');
assert.ok(subjectStar.evidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Star'), 'subject staff evidence must be retained');
assert.deepEqual([...new Set(secondarySea.evidence.map((item) => item.field))], ['title_ja'], 'secondary mention must retain title evidence only');
const subjectDoc = subjectDiscovery.state.documents.find((item) => item.url === subjectUrl);
assert.deepEqual(subjectDoc?.candidateTitles, ['星の旅'], 'document index must expose only the page subject as a persisted candidate title');

console.log('Discovery quality self-test: PASS');
console.log('generic prose false positives: BLOCKED');
console.log('aggregate/list pages: LINK-ONLY');
console.log('URL title false positives: BLOCKED');
console.log('page subject identification: PASS');
console.log('secondary work evidence: TITLE-ONLY');
console.log('media ambiguity: CONFLICT');
console.log('scalar majority vote: DISABLED');
console.log('single-work page evidence: PASS');
console.log('cross-work evidence leakage: BLOCKED');
