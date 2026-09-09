import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadColumns } from '../csv/csv.mjs';
import { normalizeUrl, isPrivateIp, urlHash } from './url.mjs';
import { parseRobotsTxt, evaluateRobots } from './robots.mjs';
import { extractDocument, extractAnimeTitleCandidates } from './html.mjs';
import { extractCandidateEvidence, resolveEvidence } from './evidence.mjs';
import { candidateToCommonRecord, readyDiscoveryRecords } from './to-record.mjs';
import { PoliteFetcher } from './fetch-page.mjs';
import { runDiscovery } from './engine.mjs';
import { emptyDiscoveryState, saveDiscoveryState, loadDiscoveryState, seedFrontier } from './state.mjs';
import { DiscoveryIndex } from './index.mjs';

assert.equal(normalizeUrl('https://EXAMPLE.com/a?utm_source=x&id=1#frag'), 'https://example.com/a?id=1');
assert.equal(normalizeUrl('javascript:alert(1)'), null);
assert.equal(isPrivateIp('127.0.0.1'), true);
assert.equal(isPrivateIp('10.0.0.2'), true);
assert.equal(isPrivateIp('::1'), true);
assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
assert.equal(isPrivateIp('::ffff:7f00:1'), true);
assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
assert.equal(isPrivateIp('8.8.8.8'), false);

const robots = parseRobotsTxt(`
User-agent: *
Disallow: /private/
Allow: /private/public/
Crawl-delay: 2
Sitemap: https://example.test/sitemap.xml
`);
assert.equal(evaluateRobots(robots, 'AnimeMemoryBot/1.0', '/private/a').allowed, false);
assert.equal(evaluateRobots(robots, 'AnimeMemoryBot/1.0', '/private/public/a').allowed, true);
assert.equal(evaluateRobots(robots, 'AnimeMemoryBot/1.0', '/x').crawlDelayMs, 2000);

const unofficialHtml = `<!doctype html><html><head>
<title>話題の新作アニメを紹介する個人記事</title>
<meta property="og:title" content="ニュース：TVアニメ『星の旅』放送決定">
</head><body>
<p>筆者が見つけたTVアニメ『星の旅』について紹介します。2027年4月3日放送開始。</p>
<p>アニメーション制作：Studio Star</p>
<a href="https://other.test/info?utm_campaign=x">別のニュース記事</a>
<a href="/privacy">プライバシーポリシー</a>
</body></html>`;
const parsedDoc = extractDocument(unofficialHtml, 'https://blog.test/post/1');
const candidates = extractAnimeTitleCandidates(parsedDoc);
const starCandidate = candidates.find((item) => item.title === '星の旅');
assert.ok(starCandidate);
assert.ok(parsedDoc.links.some((item) => item.url === 'https://other.test/info'));
const oneSourceEvidence = extractCandidateEvidence(parsedDoc, starCandidate, '2026-09-09T00:00:00.000Z');
assert.equal(resolveEvidence(oneSourceEvidence).media_type.status, 'observed');
assert.equal(resolveEvidence(oneSourceEvidence).release_start.value, '2027-04-03');
assert.equal(resolveEvidence(oneSourceEvidence).animation_studio.value, 'Studio Star');

const mockResponses = new Map([
  ['https://example.test/robots.txt', new Response('User-agent: *\nDisallow: /blocked\n', { status: 200, headers: { 'content-type': 'text/plain' } })],
  ['https://example.test/page', new Response('<html><title>TVアニメ「海の灯」公式情報</title><body>TVアニメ「海の灯」キャスト</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })]
]);
const polite = new PoliteFetcher({
  minDelayMs: 0,
  fetchImpl: async (url) => {
    const response = mockResponses.get(String(url));
    if (!response) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
    return response.clone();
  },
  resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
  waitImpl: async () => {}
});
assert.ok(polite.userAgent.includes('github.com/arunhistory/-anime-memory'));
const fetched = await polite.fetchPage('https://example.test/page');
assert.equal(fetched.ok, true);
const blocked = await polite.fetchPage('https://example.test/blocked/x');
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, 'robots-disallow');

const controlled = new PoliteFetcher({
  minDelayMs: 0,
  allowedHosts: ['example.test'],
  fetchImpl: async (url) => {
    const response = mockResponses.get(String(url));
    if (!response) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
    return response.clone();
  },
  resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
  waitImpl: async () => {}
});
assert.equal((await controlled.fetchPage('https://example.test/page')).ok, true);
const hostBlocked = await controlled.fetchPage('https://outside.test/page');
assert.equal(hostBlocked.ok, false);
assert.equal(hostBlocked.skipped, true);
assert.equal(hostBlocked.reason, 'host-not-allowed');

const pages = new Map([
  ['https://seed.test/', `
    <html><head><title>アニメ情報を書いているブログ</title></head><body>
      <article>新作TVアニメ『星の旅』は2027年4月3日放送開始。アニメーション制作：Studio Star</article>
      <a href="https://news.test/star">星の旅 キャスト続報</a>
      <a href="https://random.test/jobs">採用情報</a>
    </body></html>`],
  ['https://news.test/star', `
    <html><head><title>TVアニメ「星の旅」キャスト・放送情報</title></head><body>
      TVアニメ「星の旅」は2027年4月3日放送開始。アニメーション制作：Studio Star
      <a href="https://third.test/review">読者レビュー</a>
    </body></html>`],
  ['https://third.test/review', '<html><title>星の旅 感想</title><body>アニメ 星の旅 第1話の感想。</body></html>']
]);
const fakeFetcher = {
  async fetchPage(url) {
    if (!pages.has(url)) return { ok: false, skipped: true, reason: 'fixture-missing' };
    return { ok: true, url, contentType: 'text/html; charset=utf-8', text: pages.get(url), sitemaps: [] };
  }
};
const state = emptyDiscoveryState();
seedFrontier(state, ['https://seed.test/']);
const discovery = await runDiscovery({ state, fetcher: fakeFetcher, maxPages: 10, maxDepth: 4, perHostLimit: 10, now: '2026-09-09T00:00:00.000Z' });
const discoveredCandidate = discovery.state.candidates.find((item) => item.title === '星の旅');
assert.ok(discoveredCandidate);
assert.equal(discoveredCandidate.facts.media_type.status, 'confirmed');
assert.equal(discoveredCandidate.facts.media_type.value, 'TV');
assert.equal(discoveredCandidate.facts.release_start.status, 'confirmed');
assert.equal(discoveredCandidate.facts.release_start.value, '2027-04-03');
assert.equal(discoveredCandidate.facts.animation_studio.status, 'confirmed');
assert.equal(discoveredCandidate.facts.animation_studio.value, 'Studio Star');
assert.ok(discovery.state.documents.some((item) => item.url === 'https://seed.test/'));
assert.ok(discovery.state.documents.some((item) => item.url === 'https://news.test/star'));
assert.ok(discovery.stats.newLinks >= 1);
assert.ok(discovery.stats.evidenceClaims >= 6);

const columns = loadColumns(process.cwd());
const commonRecord = candidateToCommonRecord(discoveredCandidate, columns, '2026-09-09');
assert.ok(commonRecord);
assert.equal(Object.keys(commonRecord).length, 70);
assert.equal(commonRecord.title_ja, '星の旅');
assert.equal(commonRecord.media_type, 'TV');
assert.equal(commonRecord.release_start, '2027-04-03');
assert.equal(commonRecord.animation_studio, 'Studio Star');
assert.equal(commonRecord.synopsis, '');
assert.equal(commonRecord.updated_at, '2026-09-09');
const readyRecords = readyDiscoveryRecords(discovery.state, columns, '2026-09-09');
assert.equal(readyRecords.records.length, 1);

const conflictEvidence = [
  ...oneSourceEvidence,
  { field: 'release_start', value: '2027-04-04', sourceUrl: 'https://conflict.test/article', rule: 'fixture', observedAt: '2026-09-09T00:00:00.000Z' }
];
assert.equal(resolveEvidence(conflictEvidence).release_start.status, 'conflict');
assert.equal(resolveEvidence(conflictEvidence).release_start.value, '');
const conflictCandidate = {
  ...discoveredCandidate,
  evidence: conflictEvidence,
  facts: { ...discoveredCandidate.facts, release_start: resolveEvidence(conflictEvidence).release_start }
};
const conflictRecord = candidateToCommonRecord(conflictCandidate, columns, '2026-09-09');
assert.ok(conflictRecord);
assert.equal(conflictRecord.release_start, '');

const index = new DiscoveryIndex({ version: 1, documents: discovery.state.documents });
assert.ok(index.search('星の旅').some((item) => item.url.includes('seed.test') || item.url.includes('news.test')));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-discovery-'));
const statePath = path.join(temp, 'crawler', 'state.json');
saveDiscoveryState(statePath, discovery.state);
const savedText = fs.readFileSync(statePath, 'utf8');
assert.equal(savedText.includes('読者レビュー'), false, 'page body must not be persisted');
assert.equal(savedText.includes('<html>'), false, 'raw HTML must not be persisted');
const restored = loadDiscoveryState(statePath);
assert.ok(restored.visited.includes(urlHash('https://seed.test/')));
const restoredCandidate = restored.candidates.find((item) => item.title === '星の旅');
assert.ok(restoredCandidate?.sources.includes('https://seed.test/'));
assert.ok(restoredCandidate?.sources.includes('https://news.test/star'));
assert.equal(restoredCandidate?.facts?.release_start?.status, 'confirmed');
assert.ok(restoredCandidate?.evidence?.some((item) => item.field === 'animation_studio' && item.sourceUrl === 'https://news.test/star'));
fs.rmSync(temp, { recursive: true, force: true });

const sourceText = [
  'run.mjs', 'engine.mjs', 'fetch-page.mjs', 'html.mjs', 'evidence.mjs', 'to-record.mjs', 'score.mjs', 'state.mjs', 'url.mjs'
].map((file) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), file), 'utf8')).join('\n');
for (const forbidden of ['GEMINI_API_KEY', 'BRAVE_SEARCH_API_KEY', 'SERPAPI', 'ANIME_SOURCE_CONFIG_JSON']) {
  assert.equal(sourceText.includes(forbidden), false, `external API coupling found: ${forbidden}`);
}

console.log('Web discovery self-test: PASS');
console.log('non-official anime mention discovery: PASS');
console.log('multi-source evidence resolution: PASS');
console.log('conflict preservation: PASS');
console.log('confirmed facts to common record: PASS');
console.log('candidate evidence persistence: PASS');
console.log('robots enforcement: PASS');
console.log('controlled-host pilot mode: PASS');
console.log('mapped IPv6 private-address rejection: PASS');
console.log('raw HTML persistence: NONE');
console.log('External search API: NONE');
console.log('Gemini connection: NONE');
