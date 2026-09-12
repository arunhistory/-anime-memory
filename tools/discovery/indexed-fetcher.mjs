import { extractDocument } from './html.mjs';
import { buildConfirmedTitleMatcher, matchConfirmedTitleKeys } from './known-title-matcher.mjs';
import { buildWebSearchPositionIndex, indexWebDocument } from './web-search-index.mjs';

function isHtml(contentType) {
  const value = String(contentType || '').toLowerCase();
  return value.includes('text/html') || value.includes('application/xhtml+xml') || value === '';
}

export class IndexedFetcher {
  constructor(inner, state, { now = () => new Date().toISOString() } = {}) {
    if (!inner || typeof inner.fetchPage !== 'function') throw new Error('IndexedFetcher requires an inner fetcher');
    if (!state || typeof state !== 'object') throw new Error('IndexedFetcher requires discovery state');
    this.inner = inner;
    this.state = state;
    this.now = now;
    if (!Array.isArray(this.state.webSearchIndex)) this.state.webSearchIndex = [];
    this.positionByUrl = buildWebSearchPositionIndex(this.state.webSearchIndex);
    this.confirmedTitleMatcher = buildConfirmedTitleMatcher(this.state.candidates);
  }

  isHostAllowed(url) {
    if (typeof this.inner.isHostAllowed !== 'function') return true;
    return this.inner.isHostAllowed(url);
  }

  async fetchPage(url) {
    const result = await this.inner.fetchPage(url);
    if (!result?.ok || !isHtml(result.contentType) || !result.text || !result.url) return result;

    // The index stores only compact search metadata. Full HTML/body text stays transient
    // and is still evaluated by the normal discovery/evidence pipeline.
    const document = extractDocument(result.text, result.url);
    const confirmedTitleKeys = matchConfirmedTitleKeys(this.confirmedTitleMatcher, document);
    indexWebDocument(
      this.state.webSearchIndex,
      document,
      this.now(),
      this.positionByUrl,
      confirmedTitleKeys
    );
    return result;
  }
}
