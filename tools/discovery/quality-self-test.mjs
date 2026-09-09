import assert from 'node:assert/strict';
import { extractDocument, extractAnimeTitleCandidates } from './html.mjs';
import { extractCandidateEvidence } from './evidence.mjs';

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

const officialPage = extractDocument(`<!doctype html><html><head>
<title>花の教室 | TVアニメ公式サイト</title>
</head><body>
<p>花の教室はテレビアニメ作品です。</p>
</body></html>`, 'https://official.test/');
assert.ok(officialPage.candidates.some((item) => item.title === '花の教室'), 'official unquoted page title should still resolve to the work subject');

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
assert.ok(star && sea, 'both explicitly titled anime works should be detected');

const starEvidence = extractCandidateEvidence(multiWork, star, '2026-09-09T00:00:00.000Z');
assert.ok(starEvidence.some((item) => item.field === 'release_start' && item.value === '2027-04-03'));
assert.equal(starEvidence.some((item) => item.field === 'release_start' && item.value === '1999-08-09'), false, 'another work date must not leak into candidate evidence');
assert.ok(starEvidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Star'));
assert.equal(starEvidence.some((item) => item.field === 'animation_studio' && item.value === 'Studio Sea'), false, 'another work staff must not leak into candidate evidence');

console.log('Discovery quality self-test: PASS');
console.log('generic prose false positives: BLOCKED');
console.log('official page subject extraction: PASS');
console.log('cross-work evidence leakage: BLOCKED');
