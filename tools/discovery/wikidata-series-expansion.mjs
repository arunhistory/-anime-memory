import { mergeEvidence } from './evidence.mjs';
import { normalizeTitleKey } from './html.mjs';
import { mergeSeriesKnowledge, sanitizeSeriesKnowledge } from './series-learning.mjs';
import { normalizeUrl, urlHash } from './url.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const DEFAULT_SERIES_LIMIT = 12;

function cleanTitle(value) {
  const title = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
  return /^Q\d+$/i.test(title) ? '' : title;
}

function mediaTypeFromLabel(value) {
  const label = String(value || '').normalize('NFKC').toLocaleLowerCase('ja');
  if (/original video animation|オリジナル・?ビデオ・?アニメ|\bova\b/.test(label)) return 'OVA';
  if (/original net animation|webアニメ|ウェブアニメ|\bona\b/.test(label)) return 'ONA';
  if (/short|短編/.test(label)) return 'SHORT';
  if (/film|movie|映画|劇場/.test(label)) return 'MOVIE';
  if (/special|特別|スペシャル/.test(label)) return 'SPECIAL';
  if (/television|テレビ|tv series|tv program/.test(label)) return 'TV';
  return '';
}

function normalizedDate(value) {
  const match = String(value || '').match(/^(19\d{2}|20\d{2}|21\d{2})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function qidFromRef(value) {
  const normalized = normalizeUrl(value);
  const match = String(normalized || '').match(/^https:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/i);
  return match ? match[1].toUpperCase() : '';
}

function refFromQid(qid) {
  return `https://www.wikidata.org/entity/${qid}`;
}

export function emptyWikidataSeriesExpansionState() {
  return { version: 1, expandedRefs: [], lastRunAt: '' };
}

export function sanitizeWikidataSeriesExpansionState(value) {
  const state = emptyWikidataSeriesExpansionState();
  if (!value || value.version !== 1) return state;
  const seen = new Set();
  for (const raw of Array.isArray(value.expandedRefs) ? value.expandedRefs : []) {
    const qid = qidFromRef(raw);
    if (!qid) continue;
    seen.add(refFromQid(qid));
  }
  state.expandedRefs = [...seen];
  state.lastRunAt = String(value.lastRunAt || '').slice(0, 40);
  return state;
}

export function pendingWikidataSeriesRefs(state, limit = Number.POSITIVE_INFINITY) {
  const progress = sanitizeWikidataSeriesExpansionState(state?.wikidataSeriesExpansion);
  const expanded = new Set(progress.expandedRefs);
  const refs = [];
  const seen = new Set();
  const bounded = Number.isFinite(Number(limit)) ? Math.max(0, Math.trunc(Number(limit))) : Number.POSITIVE_INFINITY;
  for (const candidate of Array.isArray(state?.candidates) ? state.candidates : []) {
    const qid = qidFromRef(candidate?.series?.ref);
    if (!qid) continue;
    const ref = refFromQid(qid);
    if (expanded.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
    if (refs.length >= bounded) break;
  }
  return refs;
}

function seriesQuery(refs) {
  const qids = refs.map(qidFromRef).filter(Boolean);
  if (!qids.length) return '';
  const values = qids.map((qid) => `wd:${qid}`).join(' ');
  return `SELECT DISTINCT ?series ?seriesLabel ?item ?itemLabel ?classLabel ?date ?official ?follows ?followsLabel ?followedBy ?followedByLabel WHERE {
  VALUES ?series { ${values} }
  ?item wdt:P179 ?series .
  ?item wdt:P31 ?class .
  ?class wdt:P279* wd:Q1107 .
  ?item wdt:P495 wd:Q17 .
  OPTIONAL { ?item wdt:P577 ?date . }
  OPTIONAL { ?item wdt:P856 ?official . }
  OPTIONAL { ?item wdt:P155 ?follows . }
  OPTIONAL { ?item wdt:P156 ?followedBy . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
ORDER BY ?series ?item`;
}

function relationEdges(binding, currentTitle) {
  const edges = [];
  const followsTitle = cleanTitle(binding?.followsLabel?.value);
  const followedByTitle = cleanTitle(binding?.followedByLabel?.value);
  if (followsTitle && normalizeTitleKey(followsTitle) !== normalizeTitleKey(currentTitle)) {
    edges.push(
      { sourceTitle: currentTitle, targetTitle: followsTitle, kind: 'PREQUEL' },
      { sourceTitle: followsTitle, targetTitle: currentTitle, kind: 'SEQUEL' }
    );
  }
  if (followedByTitle && normalizeTitleKey(followedByTitle) !== normalizeTitleKey(currentTitle)) {
    edges.push(
      { sourceTitle: currentTitle, targetTitle: followedByTitle, kind: 'SEQUEL' },
      { sourceTitle: followedByTitle, targetTitle: currentTitle, kind: 'PREQUEL' }
    );
  }
  return edges;
}

function addFrontierUrl(state, frontierSeen, visited, { url, discoveredFrom, candidateHints }) {
  const normalized = normalizeUrl(url);
  if (!normalized || frontierSeen.has(normalized) || visited.has(urlHash(normalized))) return false;
  const host = new URL(normalized).hostname.toLowerCase();
  if (host.endsWith('wikidata.org') || host.endsWith('wikipedia.org')) return false;
  state.frontier.push({
    url: normalized,
    priority: 995,
    depth: 0,
    discoveredFrom: normalizeUrl(discoveredFrom) || '',
    candidateHints: [...new Set((candidateHints || []).map(cleanTitle).filter(Boolean))].slice(0, 32)
  });
  frontierSeen.add(normalized);
  return true;
}

export async function expandSeriesFromWikidata(state, {
  fetchImpl = fetch,
  limit = DEFAULT_SERIES_LIMIT,
  observedAt = new Date().toISOString(),
  timeoutMs = 25000
} = {}) {
  if (!state || !Array.isArray(state.candidates) || !Array.isArray(state.frontier)) {
    throw new Error('discovery state is required');
  }
  const progress = sanitizeWikidataSeriesExpansionState(state.wikidataSeriesExpansion);
  state.wikidataSeriesExpansion = progress;
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || DEFAULT_SERIES_LIMIT)));
  const refs = pendingWikidataSeriesRefs(state, boundedLimit);
  if (!refs.length) {
    return { seriesRequested: 0, rows: 0, seriesExpanded: 0, candidatesAdded: 0, evidenceAdded: 0, officialFrontierAdded: 0, memberCount: 0 };
  }

  const sparql = seriesQuery(refs);
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', sparql);
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
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) throw new Error(`wikidata-series-http-${response?.status || 'unknown'}`);
  const payload = await response.json();
  const bindings = Array.isArray(payload?.results?.bindings) ? payload.results.bindings : [];

  const candidateMap = new Map(state.candidates.map((candidate) => [normalizeTitleKey(candidate.title || candidate.key), candidate]));
  const groups = new Map();
  const frontierSeen = new Set(state.frontier.map((entry) => normalizeUrl(entry?.url)).filter(Boolean));
  const visited = new Set(state.visited || []);
  let candidatesAdded = 0;
  let evidenceAdded = 0;
  let officialFrontierAdded = 0;

  for (const binding of bindings) {
    const seriesRef = normalizeUrl(binding?.series?.value);
    const seriesQid = qidFromRef(seriesRef);
    const itemRef = normalizeUrl(binding?.item?.value);
    const title = cleanTitle(binding?.itemLabel?.value);
    const key = normalizeTitleKey(title);
    const mediaType = mediaTypeFromLabel(binding?.classLabel?.value);
    if (!seriesQid || !itemRef || !title || !key || !mediaType) continue;
    const canonicalSeriesRef = refFromQid(seriesQid);
    if (!refs.includes(canonicalSeriesRef)) continue;
    const seriesTitle = cleanTitle(binding?.seriesLabel?.value);
    const date = normalizedDate(binding?.date?.value);
    const officialUrl = normalizeUrl(binding?.official?.value);
    const member = { title, url: officialUrl || itemRef, kind: 'OTHER' };
    const group = groups.get(canonicalSeriesRef) || { ref: canonicalSeriesRef, title: seriesTitle, members: [], relations: [] };
    if (!group.title && seriesTitle) group.title = seriesTitle;
    if (!group.members.some((item) => normalizeTitleKey(item.title) === key)) group.members.push(member);
    group.relations.push(...relationEdges(binding, title));
    groups.set(canonicalSeriesRef, group);

    const incoming = [
      { field: 'title_ja', value: title, sourceUrl: itemRef, sourceClass: 'secondary', directness: 96, rule: 'wikidata-series-member-label', observedAt },
      { field: 'origin_country', value: 'JP', sourceUrl: itemRef, sourceClass: 'secondary', directness: 98, rule: 'origin-country-labeled-japan', observedAt },
      { field: 'media_type', value: mediaType, sourceUrl: itemRef, sourceClass: 'secondary', directness: 96, rule: 'wikidata-series-member-class', observedAt },
      ...(date ? [{ field: mediaType === 'MOVIE' ? 'theatrical_release_date' : 'release_start', value: date, sourceUrl: itemRef, sourceClass: 'secondary', directness: 94, rule: 'wikidata-series-member-date', observedAt }] : [])
    ];
    const current = candidateMap.get(key) || { key, title, sources: [], evidence: [], facts: {}, series: {}, lastSeen: observedAt };
    const before = current.evidence?.length || 0;
    current.sources = [...new Set([...(current.sources || []), itemRef])].slice(0, 50);
    current.evidence = mergeEvidence(current.evidence || [], incoming);
    current.series = mergeSeriesKnowledge(current.series, { ref: canonicalSeriesRef, title: seriesTitle, members: [member] });
    current.lastSeen = observedAt;
    evidenceAdded += Math.max(0, current.evidence.length - before);
    if (!candidateMap.has(key)) candidatesAdded += 1;
    candidateMap.set(key, current);

    if (addFrontierUrl(state, frontierSeen, visited, {
      url: officialUrl,
      discoveredFrom: itemRef,
      candidateHints: [seriesTitle, title]
    })) officialFrontierAdded += 1;
  }

  for (const group of groups.values()) {
    const fullKnowledge = sanitizeSeriesKnowledge(group);
    for (const candidate of candidateMap.values()) {
      if (normalizeUrl(candidate?.series?.ref) !== fullKnowledge.ref) continue;
      candidate.series = mergeSeriesKnowledge(candidate.series, fullKnowledge);
    }
  }

  state.candidates = [...candidateMap.values()];
  const expanded = new Set(progress.expandedRefs);
  for (const ref of refs) expanded.add(ref);
  progress.expandedRefs = [...expanded];
  progress.lastRunAt = observedAt;
  state.wikidataSeriesExpansion = progress;
  const memberCount = [...groups.values()].reduce((sum, group) => sum + group.members.length, 0);
  return {
    seriesRequested: refs.length,
    rows: bindings.length,
    seriesExpanded: refs.length,
    candidatesAdded,
    evidenceAdded,
    officialFrontierAdded,
    memberCount
  };
}
