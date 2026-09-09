import { normalizeTitleKey } from './html.mjs';

function termsFromText(value) {
  const normalized = String(value || '').normalize('NFKC').toLocaleLowerCase('ja');
  const terms = new Set();
  for (const token of normalized.split(/[^\p{L}\p{N}ー]+/u)) {
    if (token.length >= 2) terms.add(token.slice(0, 80));
  }
  const compact = normalized.replace(/[^\p{L}\p{N}ー]/gu, '');
  if (compact.length >= 2 && compact.length <= 160) {
    for (let size = 2; size <= Math.min(4, compact.length); size += 1) {
      for (let i = 0; i <= compact.length - size && i < 200; i += 1) terms.add(compact.slice(i, i + size));
    }
  }
  return [...terms].slice(0, 800);
}

export class DiscoveryIndex {
  constructor(serialized = null) {
    this.docs = new Map();
    this.terms = new Map();
    if (serialized) this.load(serialized);
  }

  addDocument(doc) {
    const metadata = {
      url: doc.url,
      title: String(doc.title || '').slice(0, 500),
      score: Number(doc.score || 0),
      candidateTitles: [...new Set((doc.candidateTitles || []).map(String))].slice(0, 30),
      lastChecked: doc.lastChecked || ''
    };
    this.docs.set(metadata.url, metadata);
    const tokens = new Set([
      ...termsFromText(metadata.title),
      ...metadata.candidateTitles.flatMap((title) => termsFromText(title)),
      ...metadata.candidateTitles.map(normalizeTitleKey).filter(Boolean)
    ]);
    for (const token of tokens) {
      if (!this.terms.has(token)) this.terms.set(token, new Set());
      this.terms.get(token).add(metadata.url);
    }
  }

  search(query, limit = 20) {
    const tokens = [...new Set([...termsFromText(query), normalizeTitleKey(query)].filter(Boolean))];
    const counts = new Map();
    for (const token of tokens) {
      for (const url of this.terms.get(token) || []) counts.set(url, (counts.get(url) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([url, hits]) => ({ ...this.docs.get(url), hits }))
      .sort((a, b) => b.hits - a.hits || b.score - a.score || a.url.localeCompare(b.url))
      .slice(0, limit);
  }

  toJSON() {
    return {
      version: 1,
      documents: [...this.docs.values()]
    };
  }

  load(serialized) {
    if (!serialized || serialized.version !== 1 || !Array.isArray(serialized.documents)) return;
    for (const doc of serialized.documents) this.addDocument(doc);
  }
}
