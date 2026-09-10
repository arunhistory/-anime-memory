import { mergeEvidence } from './evidence.mjs';
import { normalizeTitleKey } from './html.mjs';
import { normalizeUrl } from './url.mjs';

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
  return `SELECT DISTINCT ?item ?itemLabel ?classLabel ?date WHERE {
  ?item wdt:P31 ?class .
  ?class wdt:P279* wd:Q1107 .
  ?item wdt:P495 wd:Q17 .
  OPTIONAL { ?item wdt:P577 ?date . }
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

export async function bootstrapFromWikidata(state, {
  fetchImpl = fetch,
  limit = DEFAULT_LIMIT,
  observedAt = new Date().toISOString(),
  timeoutMs = 25000
} = {}) {
  if (!state || !Array.isArray(state.candidates)) throw new Error('discovery state is required');
  const progress = cleanBootstrapState(state.wikidataBootstrap);
  state.wikidataBootstrap = progress;
  if (progress.completed) return { fetched: 0, candidatesAdded: 0, evidenceAdded: 0, completed: true, offset: progress.offset };

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

  for (const binding of bindings) {
    const sourceUrl = normalizeUrl(binding?.item?.value);
    const title = String(binding?.itemLabel?.value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
    const key = normalizeTitleKey(title);
    const mediaType = mediaTypeFromLabel(binding?.classLabel?.value);
    if (!sourceUrl || !key || /^Q\d+$/i.test(title) || !mediaType) continue;
    const date = normalizedDate(binding?.date?.value);
    const incoming = [
      { field: 'title_ja', value: title, sourceUrl, sourceClass: 'secondary', directness: 96, rule: 'wikidata-item-label', observedAt },
      { field: 'origin_country', value: 'JP', sourceUrl, sourceClass: 'secondary', directness: 98, rule: 'origin-country-labeled-japan', observedAt },
      { field: 'media_type', value: mediaType, sourceUrl, sourceClass: 'secondary', directness: 96, rule: 'wikidata-instance-class', observedAt },
      ...(date ? [{ field: mediaType === 'MOVIE' ? 'theatrical_release_date' : 'release_start', value: date, sourceUrl, sourceClass: 'secondary', directness: 94, rule: 'wikidata-publication-date', observedAt }] : [])
    ];
    const current = candidateMap.get(key) || { key, title, sources: [], evidence: [], facts: {}, lastSeen: observedAt };
    const before = current.evidence?.length || 0;
    current.sources = [...new Set([...(current.sources || []), sourceUrl])].slice(0, 50);
    current.evidence = mergeEvidence(current.evidence || [], incoming);
    current.lastSeen = observedAt;
    evidenceAdded += Math.max(0, current.evidence.length - before);
    if (!candidateMap.has(key)) candidatesAdded += 1;
    candidateMap.set(key, current);
  }

  state.candidates = [...candidateMap.values()];
  progress.offset += bindings.length;
  progress.completed = bindings.length < batchSize;
  progress.lastRunAt = observedAt;
  return { fetched: bindings.length, candidatesAdded, evidenceAdded, completed: progress.completed, offset: progress.offset };
}
