import assert from 'node:assert/strict';
import { extractDocument } from './html.mjs';
import { buildConfirmedTitleMatcher, matchConfirmedTitleKeys } from './known-title-matcher.mjs';

function confirmed(value) {
  return { status: 'confirmed', value, sourceCount: 2, hostCount: 2, confidence: 95 };
}

function identityCandidate(title) {
  return {
    key: title,
    title,
    facts: {
      title_ja: confirmed(title),
      media_type: confirmed('TV'),
      origin_country: confirmed('JP')
    },
    evidence: [
      { field: 'title_ja', value: title, sourceUrl: 'https://official.example.jp/work', directness: 100, rule: 'page-title' },
      { field: 'title_ja', value: title, sourceUrl: 'https://network.example.net/work', directness: 95, rule: 'page-title' },
      { field: 'media_type', value: 'TV', sourceUrl: 'https://official.example.jp/work', directness: 95, rule: 'media-type-labeled' },
      { field: 'origin_country', value: 'JP', sourceUrl: 'https://official.example.jp/work', directness: 100, rule: 'origin-country-labeled-japan' }
    ]
  };
}

const ready = identityCandidate('オッドタクシー');
const notReady = identityCandidate('未確定作品');
notReady.facts.origin_country = { status: 'observed', value: 'JP', sourceCount: 1, hostCount: 1, confidence: 50 };
notReady.evidence = notReady.evidence.filter((item) => item.field !== 'origin_country');

const shortReady = identityCandidate('86');
const matcher = buildConfirmedTitleMatcher([ready, notReady, shortReady]);
assert.equal(matcher.size, 2, 'only identity-ready work names must enter the confirmed-title matcher');

const genericArticle = extractDocument(`
<html><head><title>春の音楽特集</title><meta name="description" content="注目作品の楽曲を紹介"></head>
<body>今回はオッドタクシーで使われた主題歌と劇伴について詳しく紹介する。</body></html>
`, 'https://news.example.org/music-feature');
assert.deepEqual(matchConfirmedTitleKeys(matcher, genericArticle), ['オッドタクシー'], 'confirmed title in ordinary body text must be found even when anime-title heuristics do not identify the page subject');

const shortBodyOnly = extractDocument(`
<html><head><title>数字の歴史</title></head><body>統計上 86 という数字が登場する。</body></html>
`, 'https://news.example.org/numbers');
assert.ok(!matchConfirmedTitleKeys(matcher, shortBodyOnly).includes('86'), 'very short work names must not match arbitrary article-body occurrences');

const shortHeadline = extractDocument(`
<html><head><title>86 最新情報</title></head><body>作品情報。</body></html>
`, 'https://news.example.org/86');
assert.ok(matchConfirmedTitleKeys(matcher, shortHeadline).includes('86'), 'short confirmed title may match when present in page headline metadata');

console.log('Confirmed-title Web matcher self-test: PASS');
console.log('identity-ready titles only: PASS');
console.log('generic body mention -> searchable title key: PASS');
console.log('short-title body false-positive guard: PASS');
console.log('short-title headline matching: PASS');
