import assert from 'node:assert/strict';
import { extractDocument, isPlausibleAnimeTitle } from './html.mjs';

function doc(title, body) {
  return extractDocument(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`, 'https://example.test/page');
}

const searchPage = doc('アニメ番組検索', '<p>テレビアニメ作品を検索できます。</p>');
assert.equal(searchPage.subjectCandidate, null, 'search feature page must not become a work subject');
assert.equal(isPlausibleAnimeTitle('アニメ番組検索'), false);

const newsList = doc('「ジャングル大帝」の芸能ニュース一覧', '<p>TVアニメ「ジャングル大帝」の関連ニュースです。</p>');
assert.equal(newsList.subjectCandidate, null, 'news-list heading must not become a work subject');
assert.equal(newsList.candidates.some((item) => item.title === 'ジャングル大帝'), true, 'explicit quoted work mention may still be discovered');

const longArticle = doc(
  '90分のアニメを200人で1年かけて作っていた時代に、30分のアニメを年間52本作ろうとした手塚治虫。「日本初のテレビアニメは鉄腕アトムではなかった」',
  '<p>日本のテレビアニメ史を解説する記事。TVアニメ「鉄腕アトム」について触れる。</p>'
);
assert.equal(longArticle.subjectCandidate, null, 'article headline must not become a work subject');
assert.equal(longArticle.candidates.some((item) => item.title === '鉄腕アトム'), true, 'explicit work mention inside an article remains discoverable');

const malformedQuote = doc('「お前、タヌキにならねーか？', '<p>アニメ作品を紹介する記事。</p>');
assert.equal(malformedQuote.subjectCandidate, null, 'unclosed quote headline must not become a work subject');
assert.equal(isPlausibleAnimeTitle('「お前、タヌキにならねーか？'), false);

const portalHeading = doc(
  'KYOTO手塚治虫ワールド作品｜アニメ｜手塚治虫 TEZUKA OSAMU OFFICIAL',
  '<p>アニメ作品を紹介するポータルです。</p>'
);
assert.equal(portalHeading.subjectCandidate, null, 'multi-segment portal heading must not become a work subject');

const legitimatePunctuation = doc(
  'やはり俺の青春ラブコメはまちがっている。 - Wikipedia',
  '<p>やはり俺の青春ラブコメはまちがっている。は日本のテレビアニメ作品である。</p>'
);
assert.equal(legitimatePunctuation.subjectCandidate?.title, 'やはり俺の青春ラブコメはまちがっている。', 'legitimate title punctuation must not be rejected');
assert.equal(isPlausibleAnimeTitle('やはり俺の青春ラブコメはまちがっている。'), true);

const official = doc('花の教室 | TVアニメ公式サイト', '<p>花の教室はテレビアニメ作品です。</p>');
assert.equal(official.subjectCandidate?.title, '花の教室', 'official work title extraction must remain intact');

const catalogOfficial = doc('ジャングル大帝（1965）｜アニメ｜手塚治虫 TEZUKA OSAMU OFFICIAL', '<p>ジャングル大帝（1965）は日本のテレビアニメです。</p>');
assert.equal(catalogOfficial.subjectCandidate?.title, 'ジャングル大帝（1965）', 'official catalog suffix must be removed from the work title');

console.log('Anime candidate title quality self-test: PASS');
console.log('generic search/news/portal headings: BLOCKED');
console.log('article headline fallback: BLOCKED');
console.log('explicit work mentions remain discoverable: PASS');
console.log('legitimate punctuation and official titles: PASS');
