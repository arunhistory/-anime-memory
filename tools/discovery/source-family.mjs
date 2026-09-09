const JP_SECOND_LEVEL = new Set(['ac', 'ad', 'co', 'ed', 'go', 'gr', 'lg', 'ne', 'or']);

function normalizedHost(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isIpHost(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export function sourceFamilyKey(url) {
  const host = normalizedHost(url);
  if (!host) return '';
  if (isIpHost(host)) return host;

  if (
    host === 'wikipedia.org' || host.endsWith('.wikipedia.org') ||
    host === 'wikidata.org' || host.endsWith('.wikidata.org') ||
    host === 'wikimedia.org' || host.endsWith('.wikimedia.org') ||
    host === 'wiktionary.org' || host.endsWith('.wiktionary.org') ||
    host === 'wikibooks.org' || host.endsWith('.wikibooks.org') ||
    host === 'wikiquote.org' || host.endsWith('.wikiquote.org') ||
    host === 'wikisource.org' || host.endsWith('.wikisource.org') ||
    host === 'wikinews.org' || host.endsWith('.wikinews.org') ||
    host === 'wikiversity.org' || host.endsWith('.wikiversity.org') ||
    host === 'wikivoyage.org' || host.endsWith('.wikivoyage.org')
  ) return 'wikimedia-family';

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  if (parts.at(-1) === 'jp' && JP_SECOND_LEVEL.has(parts.at(-2))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

export function collapseSameFamilyEvidence(evidence = []) {
  const selected = new Map();
  const passthrough = [];

  for (const item of Array.isArray(evidence) ? evidence : []) {
    const family = sourceFamilyKey(item?.sourceUrl);
    const field = String(item?.field || '');
    const value = String(item?.value || '');
    if (!family || !field || !value) {
      passthrough.push(item);
      continue;
    }

    const key = `${field}\u0000${value}\u0000${family}`;
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, item);
      continue;
    }

    const existingPrimary = existing?.sourceClass === 'primary';
    const incomingPrimary = item?.sourceClass === 'primary';
    if (!existingPrimary && incomingPrimary) selected.set(key, item);
  }

  return [...selected.values(), ...passthrough];
}
