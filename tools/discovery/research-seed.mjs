import { normalizeTitleKey } from './html.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { candidateInformationReadiness } from './research-completion.mjs';
import { sourceFamilyKey } from './source-family.mjs';
import { normalizeUrl, urlHash } from './url.mjs';
import { addResearchFrontier, recordTitleSearch } from './research-lane-state.mjs';

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const TITLE_RECHECK_MS = 24 * 60 * 60 * 1000;
const SEARCH_WINDOW = 20;

function rankCandidate(candidate) {
  const readiness = candidateInformationReadiness(candidate);
  return [
    Number(readiness.confirmedFields || 0),
    Number(readiness.groups || 0),
    Number(readiness.sourceFamilies || 0),
    Number(readiness.routes || 0),
    Number(readiness.pages || 0)
  ];
}

function compareCandidates(left, right) {
  const a = rankCandidate(left);
  const b = rankCandidate(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return normalizeTitleKey(left?.title || left?.key).localeCompare(
    normalizeTitleKey(right?.title || right?.key),
    'ja'
  );
}

function pendingCandidates(state) {
  return (Array.isArray(state?.candidates) ? state.candidates : [])
    .filter((candidate) => discoveryCandidateReadiness(candidate).ready)
    .filter((candidate) => !candidateInformationReadiness(candidate).ready)
    .filter((candidate) => normalizeTitleKey(candidate?.title || candidate?.key))
    .sort(compareCandidates);
}

function candidateUrls(candidate) {
  const values = [...(Array.isArray(candidate?.sources) ? candidate.sources : [])];
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
  if (!titles.length) return new Map();
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

function existingLaneCandidate(candidates, researchState) {
  const byKey = new Map(candidates.map((candidate) => [normalizeTitleKey(candidate?.title || candidate?.key), candidate]));
  for (const entry of Array.isArray(researchState?.frontier) ? researchState.frontier : []) {
    for (const hint of Array.isArray(entry?.candidateHints) ? entry.candidateHints : []) {
      const candidate = byKey.get(normalizeTitleKey(hint));
      if (candidate) return candidate;
    }
  }
  return null;
}

function candidateResearchRoots(candidate, researchState) {
  const title = String(candidate?.title || candidate?.key || '').trim();
  const entries = representativeRoots(candidate).map((url) => ({
    url,
    priority: 700,
    depth: 0,
    discoveredFrom: '',
    candidateHints: [title]
  }));
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
  return entries;
}

function hasUnvisitedRoot(candidate, researchState) {
  const visited = new Set(researchState?.visited || []);
  return candidateResearchRoots(candidate, researchState)
    .some((entry) => !visited.has(urlHash(entry.url)));
}

export function seedKnownResearchRoots(state, researchState, selectedCandidate = null) {
  const candidate = selectedCandidate || existingLaneCandidate(pendingCandidates(state), researchState);
  if (!candidate) return 0;
  return addResearchFrontier(researchState, candidateResearchRoots(candidate, researchState));
}

export async function seedTitleBasedResearchRoots(state, researchState, {
  fetchImpl = fetch,
  observedAt = new Date().toISOString(),
  timeoutMs = 15000
} = {}) {
  const candidates = pendingCandidates(state);
  const existing = existingLaneCandidate(candidates, researchState);
  if (existing) {
    const frontierAdded = seedKnownResearchRoots(state, researchState, existing);
    return {
      searched: 0,
      resolved: 0,
      frontierAdded,
      pendingCandidates: candidates.length,
      selectedTitle: String(existing.title || existing.key || '')
    };
  }

  let searched = 0;
  let resolved = 0;
  let selectedCandidate = null;

  for (let offset = 0; offset < candidates.length && !selectedCandidate; offset += SEARCH_WINDOW) {
    const window = candidates.slice(offset, offset + SEARCH_WINDOW);
    const toSearch = window
      .map((candidate) => String(candidate.title || candidate.key || '').trim())
      .filter((title) => title && !recentlySearched(researchState, title, observedAt));
    const results = await resolveWikipediaTitles(toSearch, { fetchImpl, timeoutMs });
    searched += toSearch.length;

    for (const title of toSearch) {
      const url = results.get(normalizeTitleKey(title)) || '';
      recordTitleSearch(researchState, title, { checkedAt: observedAt, url });
      if (url) resolved += 1;
    }

    selectedCandidate = window.find((candidate) => hasUnvisitedRoot(candidate, researchState)) || null;
  }

  const frontierAdded = selectedCandidate
    ? addResearchFrontier(researchState, candidateResearchRoots(selectedCandidate, researchState))
    : 0;

  return {
    searched,
    resolved,
    frontierAdded,
    pendingCandidates: candidates.length,
    selectedTitle: selectedCandidate ? String(selectedCandidate.title || selectedCandidate.key || '') : ''
  };
}
