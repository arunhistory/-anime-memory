import { mergeEvidence } from './evidence.mjs';
import { normalizeTitleKey } from './html.mjs';
import { mergeSeriesKnowledge, sanitizeSeriesKnowledge } from './series-learning.mjs';
import { normalizeUrl, urlHash } from './url.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const DEFAULT_LIMIT = 200;

function mediaTypeFromLabel(value) {
  const label = String(value || '').normalize('NFKC').toLocaleLowerCase('ja');
  if (/original video animation|オリジナル・?ビデオ・?アニメ|\bova\b/.test(label)) return 'OVA';
  if (/original net animation|webアニメ|ウェブアニメ|\bona\b/.test(label)) return 'ONA';
  if (/short|短編/.test(label)) return 'SHORT';
  if (/film|movie|映画|劇場/.test(label)) return 'MOVIE';
  if (/television|テレビ|tv series|tv program/.test(label)) return 'TV';
  return '';
}

function normalizedDate(value) {
  const match = String(value || '').match(/^(19\d{2}|20\d{2}|21\d{2})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function query(limit, offset) {
  return `SELECT DISTINCT ?item ?itemLabel ?classLabel ?date ?official
    ?series ?seriesLabel ?seriesOfficial
    ?follows ?followsLabel ?followsOfficial
    ?followedBy ?followedByLabel ?followedByOfficial WHERE {
  ?item wdt:P31 ?class .
  ?class wdt:P279* wd:Q1107 .
  ?item wdt:P495 wd:Q17 .
  OPTIONAL { ?item wdt:P577 ?date . }
  OPTIONAL { ?item wdt:P856 ?official . }
  OPTIONAL {
    ?item wdt:P179 ?series .
    OPTIONAL { ?series wdt:P856 ?seriesOfficial . }
  }
  OPTIONAL {
    ?item wdt:P155 ?follows .
    OPTIONAL { ?follows wdt:P856 ?followsOfficial . }
  }
  OPTIONAL {
    ?item wdt:P156 ?followedBy .
    OPTIONAL { ?followedBy wdt:P856 ?followedByOfficial . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
ORDER BY ?item
LIMIT ${limit}
OFFSET ${offset}`;
}

function cleanBootstrapState(value) {
  return {
    version: 1,
    offset: Math.max(0, Math.trunc(Number(value?.offset) || 0)),
    completed: Boolean(value?.completed),
    lastRunAt: String(value?.lastRunAt || '').slice(0, 40)
  };
}

export function sanitizeWikidataBootstrapState(value) {
  return cleanBootstrapState(value);
}

function cleanTitle(value) {
  const title = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
  return /^Q\d+$/i.test(title) ? '' : title;
}

function relationMember(binding, prefix, kind) {
  const title = cleanTitle(binding?.[`${prefix}Label`]?.value);
  const url = normalizeUrl(binding?.[prefix]?.value);
  if (!title || !url) return null;
  return {
    title,
    url: normalizeUrl(binding?.[`${prefix}Official`]?.value) || url,
    kind
  };
}

function buildSeriesKnowledge(binding, title, sourceUrl) {
  const seriesRef = normalizeUrl(binding?.series?.value);
  const seriesTitle = cleanTitle(binding?.seriesLabel?.value);
  const members = [
    { title, url: sourceUrl, kind: 'OTHER' },
    relationMember(binding, 'follows', 'PREQUEL'),
    relationMember(binding, 'followedBy', 'SEQUEL')
  ].filter(Boolean);
  return sanitizeSeriesKnowledge({
    ref: seriesRef,
    title: seriesTitle,
    members
  });
}

function addFrontierUrl(state, frontierSeen, visited, { url, priority, discoveredFrom, candidateHints }) {
  const normalized = normalizeUrl(url);
  if (!normalized || frontierSeen.has(normalized) || visited.has(urlHash(normalized))) return false;
  const host = new URL(normalized).hostname.toLowerCase();
  if (host.endsWith('wikidata.org') || host.endsWith('wikipedia.org')) return false;
  state.frontier.push({
    url: normalized,
    priority,
    depth: 0,
    discoveredFrom: normalizeUrl(discoveredFrom) || '',
    candidateHints: [...new Set((candidateHints || []).map(cleanTitle).filter(Boolean))].slice(0, 32)
  });
  frontierSeen.add(normalized);
  return true;
}

export async function bootstrapFromWikidata(state, {
  fetchImpl = fetch,
  limit = DEFAULT_LIMIT,
  observedAt = new Date().toISOString(),
  timeoutMs = 25000
} = {}) {
  if (!state || !Array.isArray(state.candidates)) throw new Error('discovery state is required');
  const progress = cleanBootstrapState(state.wikidataBootstrap);
  state.wikidataBootstrap = progress;
  if (progress.completed) return { fetched: 0, candidatesAdded: 0, evidenceAdded: 0, officialFrontierAdded: 0, seriesFrontierAdded: 0, completed: true, offset: progress.offset };

  const batchSize = Math.max(1, Math.min(500, Math.trunc(Number(limit) || DEFAULT_LIMIT)));
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', query(batchSize, progress.offset));
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
  if (!response?.ok) throw new Error(`wikidata-http-${response?.status || 'unknown'}`);
  const payload = await response.json();
  const bindings = Array.isArray(payload?.results?.bindings) ? payload.results.bindings : [];
  const candidateMap = new Map(state.candidates.map((candidate) => [normalizeTitleKey(candidate.title || candidate.key), candidate]));
  let candidatesAdded = 0;
  let evidenceAdded = 0;
  let officialFrontierAdded = 0;
  let seriesFrontierAdded = 0;
  const frontierSeen = new Set((state.frontier || []).map((entry) => normalizeUrl(entry?.url)).filter(Boolean));
  const visited = new Set(state.visited || []);

  for (const binding of bindings) {
    const sourceUrl = normalizeUrl(binding?.item?.value);
    const title = cleanTitle(binding?.itemLabel?.value);
    const key = normalizeTitleKey(title);
    const mediaType = mediaTypeFromLabel(binding?.classLabel?.value);
    if (!sourceUrl || !key || !title || !mediaType) continue;
    const date = normalizedDate(binding?.date?.value);
    const officialUrl = normalizeUrl(binding?.official?.value);
    const incoming = [
      { field: 'title_ja', value: title, sourceUrl, sourceClass: 'secondary', directness: 96, rule: 'wikidata-item-label', observedAt },
      { field: 'origin_country', value: 'JP', sourceUrl, sourceClass: 'secondary', directness: 98, rule: 'origin-country-labeled-japan', observedAt },
      { field: 'media_type', value: mediaType, sourceUrl, sourceClass: 'secondary', directness: 96, rule: 'wikidata-instance-class', observedAt },
      ...(date ? [{ field: mediaType === 'MOVIE' ? 'theatrical_release_date' : 'release_start', value: date, sourceUrl, sourceClass: 'secondary', directness: 94, rule: 'wikidata-publication-date', observedAt }] : [])
    ];
    const current = candidateMap.get(key) || { key, title, sources: [], evidence: [], facts: {}, series: {}, lastSeen: observedAt };
    const before = current.evidence?.length || 0;
    current.sources = [...new Set([...(current.sources || []), sourceUrl])].slice(0, 50);
    current.evidence = mergeEvidence(current.evidence || [], incoming);
    current.series = mergeSeriesKnowledge(current.series, buildSeriesKnowledge(binding, title, sourceUrl));
    current.lastSeen = observedAt;
    evidenceAdded += Math.max(0, current.evidence.length - before);
    if (!candidateMap.has(key)) candidatesAdded += 1;
    candidateMap.set(key, current);

    if (addFrontierUrl(state, frontierSeen, visited, {
      url: officialUrl,
      priority: 900,
      discoveredFrom: sourceUrl,
      candidateHints: [title, current.series?.title, ...(current.series?.members || []).map((item) => item.title)]
    })) officialFrontierAdded += 1;

    const seriesOfficial = normalizeUrl(binding?.seriesOfficial?.value);
    if (addFrontierUrl(state, frontierSeen, visited, {
      url: seriesOfficial,
      priority: 980,
      discoveredFrom: sourceUrl,
      candidateHints: [current.series?.title, title, ...(current.series?.members || []).map((item) => item.title)]
    })) seriesFrontierAdded += 1;

    for (const prefix of ['follows', 'followedBy']) {
      const relatedOfficial = normalizeUrl(binding?.[`${prefix}Official`]?.value);
      const relatedTitle = cleanTitle(binding?.[`${prefix}Label`]?.value);
      if (addFrontierUrl(state, frontierSeen, visited, {
        url: relatedOfficial,
        priority: 970,
        discoveredFrom: sourceUrl,
        candidateHints: [relatedTitle, current.series?.title, title]
      })) seriesFrontierAdded += 1;
    }
  }

  state.candidates = [...candidateMap.values()];
  progress.offset += bindings.length;
  progress.completed = bindings.length < batchSize;
  progress.lastRunAt = observedAt;
  return { fetched: bindings.length, candidatesAdded, evidenceAdded, officialFrontierAdded, seriesFrontierAdded, completed: progress.completed, offset: progress.offset };
}
