import { discoveryCandidateReadiness } from './to-record.mjs';
import {
  candidateInformationReadiness,
  sanitizeCandidateResearch
} from './research-completion.mjs';
import { normalizeUrl, urlHash } from './url.mjs';
import {
  activeWikidataBackoffUntil,
  defaultWikidataBackoffUntil,
  retryAfterFromResponse
} from './wikidata-backoff.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const DEFAULT_LIMIT = 100;
const RECHECK_MS = 24 * 60 * 60 * 1000;

function qidFromUrl(value) {
  const match = String(value || '').match(/wikidata\.org\/entity\/(Q\d+)(?:$|[?#/])/i);
  return match ? match[1].toUpperCase() : '';
}

function candidateQid(candidate) {
  for (const value of [
    ...(Array.isArray(candidate?.sources) ? candidate.sources : []),
    ...(Array.isArray(candidate?.evidence) ? candidate.evidence.map((item) => item?.sourceUrl) : [])
  ]) {
    const qid = qidFromUrl(value);
    if (qid) return qid;
  }
  return '';
}

function recentlyChecked(research, observedMs) {
  if (research.wikidataArticleUrl) return true;
  const checkedMs = Date.parse(research.wikidataArticleCheckedAt || '');
  return Number.isFinite(checkedMs) && observedMs - checkedMs < RECHECK_MS;
}

function exactJaWikipediaUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return '';
  const host = new URL(url).hostname.toLowerCase();
  return host === 'ja.wikipedia.org' ? url : '';
}

function query(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(' ');
  return `PREFIX schema: <http://schema.org/>
SELECT ?item ?article WHERE {
  VALUES ?item { ${values} }
  OPTIONAL {
    ?article schema:about ?item ;
      schema:isPartOf <https://ja.wikipedia.org/> .
  }
}`;
}

function addFrontier(state, frontierSeen, visited, url, title, qid) {
  const normalized = exactJaWikipediaUrl(url);
  if (!normalized || frontierSeen.has(normalized) || visited.has(urlHash(normalized))) return false;
  state.frontier.push({
    url: normalized,
    priority: 950,
    depth: 0,
    discoveredFrom: `https://www.wikidata.org/entity/${qid}`,
    candidateHints: [String(title || '').slice(0, 120)].filter(Boolean)
  });
  frontierSeen.add(normalized);
  return true;
}

export async function backfillCandidateWikipediaSitelinks(state, {
  fetchImpl = fetch,
  limit = DEFAULT_LIMIT,
  observedAt = new Date().toISOString(),
  timeoutMs = 25000
} = {}) {
  if (!state || !Array.isArray(state.candidates) || !Array.isArray(state.frontier)) {
    throw new Error('discovery state is required');
  }

  const observedMsRaw = Date.parse(observedAt);
  const observedDate = Number.isFinite(observedMsRaw) ? new Date(observedMsRaw) : new Date();
  const observedMs = observedDate.getTime();
  const backoffUntil = activeWikidataBackoffUntil(state, observedDate);
  if (backoffUntil) {
    return { requested: 0, resolved: 0, frontierAdded: 0, noArticle: 0, backoffUntil };
  }

  const max = Math.max(1, Math.min(200, Math.trunc(Number(limit) || DEFAULT_LIMIT)));
  const selectedByQid = new Map();
  for (const candidate of state.candidates) {
    if (!discoveryCandidateReadiness(candidate).ready) continue;
    if (candidateInformationReadiness(candidate).ready) continue;
    const research = sanitizeCandidateResearch(candidate.research);
    if (recentlyChecked(research, observedMs)) continue;
    const qid = candidateQid(candidate);
    if (!qid) continue;
    if (!selectedByQid.has(qid)) selectedByQid.set(qid, []);
    selectedByQid.get(qid).push(candidate);
    if (selectedByQid.size >= max) break;
  }

  const qids = [...selectedByQid.keys()];
  if (!qids.length) return { requested: 0, resolved: 0, frontierAdded: 0, noArticle: 0 };

  const url = new URL(ENDPOINT);
  url.searchParams.set('query', query(qids));
  url.searchParams.set('format', 'json');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 25000));
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/sparql-results+json',
        'user-agent': 'AnimeMemoryBot/1.0 (+https://github.com/arunhistory/-anime-memory)'
      },
      signal: controller.signal
    });
  } catch (error) {
    if (state.wikidataBootstrap) state.wikidataBootstrap.retryAfter = defaultWikidataBackoffUntil(observedDate);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response?.ok) {
    if ([429, 503].includes(Number(response?.status)) && state.wikidataBootstrap) {
      state.wikidataBootstrap.retryAfter = retryAfterFromResponse(response, observedDate);
    }
    throw new Error(`wikidata-article-http-${response?.status || 'unknown'}`);
  }
  if (state.wikidataBootstrap) state.wikidataBootstrap.retryAfter = '';

  const payload = await response.json();
  const bindings = Array.isArray(payload?.results?.bindings) ? payload.results.bindings : [];
  const articleByQid = new Map();
  for (const binding of bindings) {
    const qid = qidFromUrl(binding?.item?.value);
    if (!qid || !selectedByQid.has(qid)) continue;
    const article = exactJaWikipediaUrl(binding?.article?.value);
    if (article) articleByQid.set(qid, article);
    else if (!articleByQid.has(qid)) articleByQid.set(qid, '');
  }

  const frontierSeen = new Set(state.frontier.map((entry) => normalizeUrl(entry?.url)).filter(Boolean));
  const visited = new Set(state.visited || []);
  let resolved = 0;
  let frontierAdded = 0;
  let noArticle = 0;

  for (const [qid, candidates] of selectedByQid) {
    const article = articleByQid.get(qid) || '';
    if (article) resolved += 1;
    else noArticle += 1;
    for (const candidate of candidates) {
      const research = sanitizeCandidateResearch(candidate.research);
      research.wikidataArticleCheckedAt = observedDate.toISOString();
      research.wikidataArticleUrl = article;
      candidate.research = research;
      if (article && addFrontier(state, frontierSeen, visited, article, candidate.title, qid)) frontierAdded += 1;
    }
  }

  return {
    requested: qids.length,
    resolved,
    frontierAdded,
    noArticle
  };
}
