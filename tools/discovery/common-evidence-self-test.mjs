import assert from 'node:assert/strict';
import { loadColumns } from '../csv/csv.mjs';
import { extractDocument } from './html.mjs';
import { extractCandidateEvidence, resolveEvidence } from './evidence.mjs';
import { candidateToCommonRecord } from './to-record.mjs';

const official = extractDocument(`<!doctype html><html><head>
<title>星の旅 | TVアニメ公式サイト</title>
<link rel="canonical" href="https://star.example.jp/">
</head><body>
<p>日本のTVアニメ「星の旅」は2027年4月3日放送開始。</p>
<p>タイトル読み：ほしのたび</p>
<p>英題：Journey of Stars</p>
<p>別名：星旅、Star Journey</p>
<p>放送終了：2027年6月26日</p>
<p>話数：全13話</p>
<p>各話時間：24分</p>
<p>対象層：一般</p>
<p>舞台設定：宇宙、学校</p>
<p>テーマ：友情、冒険</p>
<p>原作：山田太郎</p>
<p>出版社：星出版</p>
<p>アニメーション制作：Studio Star</p>
<p>制作協力：Studio Moon</p>
<p>製作委員会：星の旅製作委員会</p>
<p>プロデューサー：佐藤一郎、鈴木二郎</p>
<p>監督：田中三郎</p>
<p>シリーズ構成：高橋四郎</p>
<p>キャラクターデザイン：伊藤五郎</p>
<p>音楽：音羽六郎</p>
<p>音響監督：声野七郎</p>
<p>音楽制作：Star Music</p>
<p>放送局：TOKYO MX、BS11</p>
<a href="https://x.com/star_anime">公式X</a>
<a href="https://x.com/intent/post?text=share">シェア</a>
<a href="https://x.com/star_anime/status/123">投稿</a>
<a href="https://x.com/cast_member">出演者X</a>
<a href="https://www.youtube.com/@star_anime">公式YouTube</a>
<a href="https://www.youtube.com/watch?v=abc123">本PV</a>
<a href="https://youtu.be/abc123">PV</a>
</body></html>`, 'https://star.example.jp/');

const candidate = official.candidates.find((item) => item.title === '星の旅');
assert.ok(candidate);
assert.equal(official.subjectCandidate?.title, '星の旅');
const evidence = extractCandidateEvidence(official, candidate, '2026-09-10T00:00:00.000Z');
assert.ok(evidence.length > 15);
assert.ok(evidence.every((item) => item.sourceClass === 'primary'));
const facts = resolveEvidence(evidence);

for (const field of ['title_ja', 'media_type', 'origin_country', 'title_kana', 'title_en', 'release_start', 'release_end', 'episode_count', 'runtime_min', 'animation_studio', 'director', 'series_composition', 'character_design', 'music', 'sound_director', 'official_url', 'official_x', 'official_youtube']) {
  assert.equal(facts[field]?.status, 'confirmed', `${field} should be confirmed from the direct official source`);
}
assert.equal(facts.origin_country.value, 'JP');
assert.equal(facts.media_type.value, 'TV');
assert.equal(facts.episode_count.value, '13');
assert.equal(facts.runtime_min.value, '24');
assert.equal(facts.aliases.status, 'confirmed');
assert.ok(facts.aliases.value.includes('星旅'));
assert.ok(facts.aliases.value.includes('Star Journey'));
assert.equal(facts.animation_studio.value, 'Studio Star');
assert.ok(facts.producers.value.includes('佐藤一郎'));
assert.ok(facts.producers.value.includes('鈴木二郎'));
assert.ok(facts.broadcast_networks.value.includes('TOKYO MX'));
assert.ok(facts.broadcast_networks.value.includes('BS11'));
assert.equal(facts.official_url.value, 'https://star.example.jp/');
assert.equal(facts.official_x.value, 'https://x.com/star_anime');
assert.equal(facts.official_youtube.value, 'https://www.youtube.com/@star_anime');
assert.equal(evidence.filter((item) => item.field === 'official_x').length, 1, 'share/status/cast X links must not become official X evidence');
assert.equal(evidence.filter((item) => item.field === 'official_youtube').length, 1, 'video links must not become official YouTube channel evidence');

const detailPage = extractDocument(`<!doctype html><html><head>
<title>星の旅 STAFF | TVアニメ公式サイト</title>
<link rel="canonical" href="https://star.example.jp/staff/">
</head><body>
<p>日本のTVアニメ「星の旅」スタッフ情報。</p>
<p>監督：田中三郎</p>
<a href="https://x.com/star_anime">公式X</a>
<a href="https://x.com/cast_member">X</a>
<a href="https://x.com/other_staff"></a>
<a href="https://www.youtube.com/@star_anime">公式YouTube</a>
<a href="https://www.youtube.com/@cast_channel">YouTube</a>
<a href="https://www.youtube.com/@other_channel"></a>
</body></html>`, 'https://star.example.jp/staff/');
const detailCandidate = detailPage.candidates.find((item) => item.title === '星の旅');
assert.ok(detailCandidate);
const detailEvidence = extractCandidateEvidence(detailPage, detailCandidate, '2026-09-10T00:00:00.000Z');
assert.equal(detailEvidence.some((item) => item.field === 'official_url'), false, 'detail subpage must not become a competing official_url value');
assert.equal(
  detailEvidence.filter((item) => item.field === 'official_x').length,
  0,
  'detail subpage must not create official X evidence, even from social links labeled on the detail page'
);
assert.equal(
  detailEvidence.filter((item) => item.field === 'official_youtube').length,
  0,
  'detail subpage must not create official YouTube evidence, even from social links labeled on the detail page'
);

const columns = loadColumns(process.cwd());
const corroboratingEvidence = [
  { field: 'title_ja', value: '星の旅', sourceUrl: 'https://news.example.net/star', sourceClass: 'secondary', rule: 'fixture', observedAt: '2026-09-10T00:00:00.000Z' },
  { field: 'media_type', value: 'TV', sourceUrl: 'https://news.example.net/star', sourceClass: 'secondary', rule: 'fixture', observedAt: '2026-09-10T00:00:00.000Z' },
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://news.example.net/star', sourceClass: 'secondary', rule: 'fixture', observedAt: '2026-09-10T00:00:00.000Z' }
];
const record = candidateToCommonRecord({ ...candidate, facts, evidence: [...evidence, ...corroboratingEvidence] }, columns, '2026-09-10');
assert.ok(record);
assert.equal(record.title_ja, '星の旅');
assert.equal(record.title_kana, 'ほしのたび');
assert.equal(record.title_en, 'Journey of Stars');
assert.equal(record.release_end, '2027-06-26');
assert.equal(record.episode_count, '13');
assert.equal(record.runtime_min, '24');
assert.equal(record.production_committee, '星の旅製作委員会');
assert.equal(record.official_url, 'https://star.example.jp/');
assert.equal(record.synopsis, '');

const secondary = extractDocument(`<!doctype html><html><head>
<title>星の旅 放送ニュース</title>
</head><body>
<p>日本のTVアニメ「星の旅」は2027年4月3日放送開始。</p>
<p>アニメーション制作：Studio Star</p>
</body></html>`, 'https://news.example.net/star');
const secondaryCandidate = secondary.candidates.find((item) => item.title === '星の旅');
assert.ok(secondaryCandidate);
const secondaryFacts = resolveEvidence(extractCandidateEvidence(secondary, secondaryCandidate, '2026-09-10T00:00:00.000Z'));
assert.equal(secondaryFacts.title_ja.status, 'observed');
assert.equal(secondaryFacts.media_type.status, 'observed');
assert.equal(secondaryFacts.origin_country.status, 'observed');

const conflict = resolveEvidence([
  ...evidence,
  {
    field: 'release_start',
    value: '2027-04-04',
    sourceUrl: 'https://other.example.net/star',
    sourceClass: 'secondary',
    rule: 'fixture-conflict',
    observedAt: '2026-09-10T00:00:00.000Z'
  }
]);
assert.equal(conflict.release_start.status, 'conflict');
assert.equal(conflict.release_start.value, '');

console.log('Common evidence self-test: PASS');
console.log('primary source directness: PASS');
console.log('single secondary source remains observed: PASS');
console.log('broad common-field extraction: PASS');
console.log('official landing URL extraction: PASS');
console.log('official social profile filtering: PASS');
console.log('detail-page official URL contamination: BLOCKED');
console.log('detail-page social evidence contamination: BLOCKED');
console.log('conflict overrides majority/directness: PASS');
