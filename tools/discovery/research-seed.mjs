import { normalizeTitleKey } from './html.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { candidateInformationReadiness } from './research-completion.mjs';
import { sourceFamilyKey } from './source-family.mjs';
import { normalizeUrl } from './url.mjs';
import { addResearchFrontier, recordTitleSearch } from './research-lane-state.mjs';

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const TITLE_RECHECK_MS = 24 * 60 * 60 * 1000;
const MEDIAWIKI_TITLE_BATCH = 50;

function pendingCandidates(state) {
  return (Array.isArray(state?.candidates) ? state.candidates : [])
    .filter((candidate) => discoveryCandidateReadiness(candidate).ready)
    .filter((candidate) => !candidateInformationReadiness(candidate).ready)
    .filter((candidate) => normalizeTitleKey(candidate?.title || candidate?.key));
}

function candidateUrls(candidate) {
  const values = [
    ...(Array.isArray(candidate?.sources) ? candidate.sources : []),
    ...(Array.isArray(candidate?.evidence) ? candidate.evidence.map((item) => item?.sourceUrl) : [])
  ];
  const official = String(candidate?.facts?.official_url?.value || '').trim();
  if (official) values.push(...official.split('|'));
  return [...new Set(values.map((value) => normalizeUrl(value)).filter(Boolean))];
}

function urlPreference(url) {
  try {
    const parsed = new URL(url);
    const pathDepth = parsed.pathname.split('/').filter(Boolean).length;
    const queryPenalty = parsed.search ? 20 : 0;
    return pathDepth * 10 + queryPenalty + parsed.pathname.length / 1000;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function representativeRoots(candidate) {
  const bestByFamily = new Map();
  for (const url of candidateUrls(candidate)) {
    const family = sourceFamilyKey(url);
    if (!family) continue;
    const current = bestByFamily.get(family);
    if (!current || urlPreference(url) < urlPreference(current)) bestByFamily.set(family, url);
  }
  return [...bestByFamily.values()];
}

function recentlySearched(researchState, title, observedAt) {
  const key = normalizeTitleKey(title);
  const entry = researchState?.titleSearch?.[key];
  if (!entry?.checkedAt) return false;
  const checked = Date.parse(entry.checkedAt);
  const observed = Date.parse(observedAt);
  return Number.isFinite(checked) && Number.isFinite(observed) && observed - checked < TITLE_RECHECK_MS;
}

function articleUrl(title) {
  const normalizedTitle = String(title || '').replace(/ /g, '_');
  return normalizeUrl(`https://ja.wikipedia.org/wiki/${encodeURIComponent(normalizedTitle).replace(/%2F/gi, '/')}`);
}

function redirectMap(payload) {
  const map = new Map();
  for (const item of Array.isArray(payload?.query?.normalized) ? payload.query.normalized : []) {
    if (item?.from && item?.to) map.set(String(item.from), String(item.to));
  }
  for (const item of Array.isArray(payload?.query?.redirects) ? payload.query.redirects : []) {
    if (item?.from && item?.to) map.set(String(item.from), String(item.to));
  }
  return map;
}

function resolveMappedTitle(title, map) {
  let current = String(title || '');
  const seen = new Set();
  for (let step = 0; step < 8; step += 1) {
    if (!map.has(current) || seen.has(current)) break;
    seen.add(current);
    current = map.get(current);
  }
  return current;
}

async function resolveWikipediaTitles(titles, { fetchImpl, timeoutMs }) {
  const url = new URL(WIKIPEDIA_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'info');
  url.searchParams.set('titles', titles.join('|'));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 15000));
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'AnimeMemoryBot/1.0 (+https://github.com/arunhistory/-anime-memory)'
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) throw new Error(`wikipedia-title-http-${response?.status || 'unknown'}`);
  const payload = await response.json();
  const map = redirectMap(payload);
  const pages = new Map();
  for (const page of Array.isArray(payload?.query?.pages) ? payload.query.pages : []) {
    if (page?.missing || Number(page?.ns) !== 0 || !page?.title) continue;
    pages.set(normalizeTitleKey(page.title), page.title);
  }

  const resolved = new Map();
  for (const title of titles) {
    const mapped = resolveMappedTitle(title, map);
    const pageTitle = pages.get(normalizeTitleKey(mapped)) || '';
    resolved.set(normalizeTitleKey(title), pageTitle ? articleUrl(pageTitle) : '');
  }
  return resolved;
}

export function seedKnownResearchRoots(state, researchState) {
  const entries = [];
  for (const candidate of pendingCandidates(state)) {
    const title = String(candidate.title || candidate.key || '').trim();
    for (const url of representativeRoots(candidate)) {
      entries.push({
        url,
        priority: 700,
        depth: 0,
        discoveredFrom: '',
        candidateHints: [title]
      });
    }
    const titleSearchUrl = researchState?.titleSearch?.[normalizeTitleKey(title)]?.url;
    if (titleSearchUrl) {
      entries.push({
        url: titleSearchUrl,
        priority: 900,
        depth: 0,
        discoveredFrom: WIKIPEDIA_API,
        candidateHints: [title]
      });
    }
  }
  return addResearchFrontier(researchState, entries);
}

export async function seedTitleBasedResearchRoots(state, researchState, {
  fetchImpl = fetch,
  observedAt = new Date().toISOString(),
  timeoutMs = 15000
} = {}) {
  const selected = pendingCandidates(state)
    .map((candidate) => String(candidate.title || candidate.key || '').trim())
    .filter((title) => title && !recentlySearched(researchState, title, observedAt));

  let searched = 0;
  let resolved = 0;
  let frontierAdded = 0;

  for (let offset = 0; offset < selected.length; offset += MEDIAWIKI_TITLE_BATCH) {
    const batch = selected.slice(offset, offset + MEDIAWIKI_TITLE_BATCH);
    const results = await resolveWikipediaTitles(batch, { fetchImpl, timeoutMs });
    searched += batch.length;
    for (const title of batch) {
      const url = results.get(normalizeTitleKey(title)) || '';
      recordTitleSearch(researchState, title, { checkedAt: observedAt, url });
      if (!url) continue;
      resolved += 1;
      frontierAdded += addResearchFrontier(researchState, [{
        url,
        priority: 900,
        depth: 0,
        discoveredFrom: WIKIPEDIA_API,
        candidateHints: [title]
      }]);
    }
  }

  frontierAdded += seedKnownResearchRoots(state, researchState);
  return { searched, resolved, frontierAdded, pendingCandidates: pendingCandidates(state).length };
}
