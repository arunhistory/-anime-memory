import assert from 'node:assert/strict';
import { migrateLegacyOfficialEvidence } from './legacy-evidence-migration.mjs';

const evidence = [
  { field: 'official_url', value: 'https://anime.example.jp/', sourceUrl: 'https://anime.example.jp/', rule: 'primary-page-url' },
  { field: 'official_x', value: 'https://twitter.com/anime_official', sourceUrl: 'https://anime.example.jp/', rule: 'primary-page-social-x' },
  { field: 'official_youtube', value: 'https://www.youtube.com/channel/UC123', sourceUrl: 'https://anime.example.jp/', rule: 'primary-page-youtube' },
  { field: 'official_youtube', value: 'https://www.youtube.com/playlist?list=bad', sourceUrl: 'https://anime.example.jp/', rule: 'primary-page-youtube' },
  { field: 'official_url', value: 'https://anime.example.jp/news/post-1', sourceUrl: 'https://anime.example.jp/news/post-1', rule: 'primary-page-url' },
  { field: 'official_x', value: 'https://twitter.com/intent/tweet?text=share', sourceUrl: 'https://anime.example.jp/news/post-1', rule: 'primary-page-social-x' },
  { field: 'official_x', value: 'https://twitter.com/search?q=anime', sourceUrl: 'https://anime.example.jp/news/post-1', rule: 'primary-page-social-x' },
  { field: 'release_start', value: '2027-04-01', sourceUrl: 'https://anime.example.jp/news/post-1', rule: 'event-date-release' }
];

const result = migrateLegacyOfficialEvidence(evidence);
assert.equal(result.removed, 4);
assert.equal(result.rewritten, 3);
assert.equal(result.evidence.length, 4);
assert.ok(result.evidence.some((item) => item.rule === 'primary-landing-page-url'));
assert.ok(result.evidence.some((item) => item.rule === 'primary-landing-social-x-profile' && item.value === 'https://twitter.com/anime_official'));
assert.ok(result.evidence.some((item) => item.rule === 'primary-landing-youtube-channel' && item.value === 'https://www.youtube.com/channel/UC123'));
assert.ok(result.evidence.some((item) => item.field === 'release_start' && item.rule === 'event-date-release'));
assert.equal(result.evidence.some((item) => /intent|search|playlist|\/news\//.test(String(item.value))), false);

const second = migrateLegacyOfficialEvidence(result.evidence);
assert.equal(second.removed, 0);
assert.equal(second.rewritten, 0);
assert.deepEqual(second.evidence, result.evidence);

console.log('Legacy official evidence migration self-test: PASS');
console.log('news-page official URL contamination: REMOVED');
console.log('share/search social contamination: REMOVED');
console.log('playlist-as-channel contamination: REMOVED');
console.log('legitimate landing official evidence: PRESERVED');
console.log('non-official factual evidence: PRESERVED');
console.log('migration idempotency: PASS');
