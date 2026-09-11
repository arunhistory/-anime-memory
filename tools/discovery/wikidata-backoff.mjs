export const WIKIDATA_DEFAULT_BACKOFF_MS = 60 * 1000;

export function sanitizeWikidataRetryAfter(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function activeWikidataBackoffUntil(state, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ''));
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const candidates = [
    state?.wikidataBootstrap?.retryAfter,
    state?.wikidataSeriesExpansion?.retryAfter
  ]
    .map((value) => Date.parse(String(value || '')))
    .filter((value) => Number.isFinite(value) && value > effectiveNow);
  if (!candidates.length) return '';
  return new Date(Math.max(...candidates)).toISOString();
}

export function retryAfterFromResponse(response, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ''));
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const raw = String(response?.headers?.get?.('retry-after') || '').trim();
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(effectiveNow + Math.ceil(seconds * 1000)).toISOString();
    }
    const absolute = Date.parse(raw);
    if (Number.isFinite(absolute) && absolute > effectiveNow) return new Date(absolute).toISOString();
  }
  return new Date(effectiveNow + WIKIDATA_DEFAULT_BACKOFF_MS).toISOString();
}

export function defaultWikidataBackoffUntil(now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ''));
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(effectiveNow + WIKIDATA_DEFAULT_BACKOFF_MS).toISOString();
}
