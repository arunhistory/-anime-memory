import assert from 'node:assert/strict';
import { extractDocument } from './html.mjs';
import { extractCandidateEvidence, resolveEvidence } from './evidence.mjs';
import { splitEscaped, splitStructured } from '../normalize/record.mjs';

const document = extractDocument(`<!doctype html><html><head>
<title>星の旅 | TVアニメ公式サイト</title>
<link rel="canonical" href="https://star.example.jp/">
</head><body>
<p>日本のTVアニメ「星の旅」は2027年4月3日放送開始。</p>
<p>アニメーション制作：Studio Star</p>
<p>脚本：脚本太郎、脚本花子</p>
<p>主人公（CV：声優一郎）</p>
<p>相棒（SUPPORT）：声優二郎</p>
<p>オープニングテーマ「Star Road」 歌：Singer A 作詞：Lyric A 作曲：Music A 編曲：Arrange A</p>
<p>エンディングテーマ「Home Sky」 歌：Singer B 作詞：Lyric B 作曲：Music B 編曲：Arrange B</p>
<p>挿入歌「Flash」 歌：Singer C 作詞：Lyric C 作曲：Music C 編曲：Arrange C</p>
<p>放送日時：TOKYO MX：金曜 24:00</p>
<p>配信サービス：Netflix：見放題独占：日本：2027-04-05：</p>
<p>第1話「旅立ち」 2027年4月3日</p>
<p>第1話 脚本：脚本太郎</p>
<p>2028年 アニメ大賞：作品賞</p>
<a href="https://special.example.com/star-official">公式特設ページ</a>
</body></html>`, 'https://star.example.jp/');

const candidate = document.candidates.find((item) => item.title === '星の旅');
assert.ok(candidate);
const evidence = extractCandidateEvidence(document, candidate, '2026-09-10T00:00:00.000Z');
const facts = resolveEvidence(evidence);

if (!facts.episode_staff) {
  console.error('structured-debug document.text=', JSON.stringify(document.text));
  console.error('structured-debug episode evidence=', JSON.stringify(evidence.filter((item) => item.field === 'episodes' || item.field === 'episode_staff')));
  console.error('structured-debug fields=', JSON.stringify([...new Set(evidence.map((item) => item.field))]));
}

for (const field of [
  'staff', 'characters', 'opening_themes', 'ending_themes', 'insert_songs',
  'broadcast_slots', 'streaming_services', 'episodes', 'episode_staff', 'awards', 'official_other'
]) {
  assert.equal(facts[field]?.status, 'confirmed', `${field} should be confirmed from the direct official page`);
}

for (const parts of splitStructured(facts.staff.value)) assert.equal(parts.length, 2);
for (const parts of splitStructured(facts.characters.value)) assert.equal(parts.length, 3);
for (const parts of splitStructured(facts.opening_themes.value)) assert.equal(parts.length, 6);
for (const parts of splitStructured(facts.ending_themes.value)) assert.equal(parts.length, 6);
for (const parts of splitStructured(facts.insert_songs.value)) assert.equal(parts.length, 6);
for (const parts of splitStructured(facts.broadcast_slots.value)) assert.equal(parts.length, 2);
for (const parts of splitStructured(facts.streaming_services.value)) assert.equal(parts.length, 5);
for (const parts of splitStructured(facts.episodes.value)) assert.equal(parts.length, 3);
for (const parts of splitStructured(facts.episode_staff.value)) assert.equal(parts.length, 3);
for (const parts of splitStructured(facts.awards.value)) assert.equal(parts.length, 3);

const staff = splitStructured(facts.staff.value);
assert.ok(staff.some((parts) => parts[0] === '脚本' && parts[1] === '脚本太郎'));
assert.ok(staff.some((parts) => parts[0] === '脚本' && parts[1] === '脚本花子'));
const characters = splitStructured(facts.characters.value);
assert.ok(characters.some((parts) => parts[0] === '主人公' && parts[1] === '' && parts[2] === '声優一郎'));
assert.ok(characters.some((parts) => parts[0] === '相棒' && parts[1] === 'SUPPORT' && parts[2] === '声優二郎'));
assert.deepEqual(splitStructured(facts.streaming_services.value)[0], ['Netflix', '見放題独占', '日本', '2027-04-05', '']);
assert.deepEqual(splitStructured(facts.episodes.value)[0], ['1', '旅立ち', '2027-04-03']);
assert.ok(splitEscaped(facts.official_other.value).includes('https://special.example.com/star-official'));

console.log('Structured evidence self-test: PASS');
console.log('staff/characters structures: PASS');
console.log('OP/ED/insert-song 6-field structures: PASS');
console.log('broadcast/streaming structures: PASS');
console.log('episode/episode-staff/award structures: PASS');
console.log('official-other URL extraction: PASS');