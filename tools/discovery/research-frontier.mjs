import { normalizeUrl, urlHash } from './url.mjs';

function mergeHints(left, right) {
  const output = [];
  const seen = new Set();
  for (const value of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const key = text.normalize('NFKC').toLocaleLowerCase('ja');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= 32) break;
  }
  return output;
}

export function promoteResearchFrontierForCrawl(state) {
  if (!state || typeof state !== 'object') throw new Error('discovery state is required');
  if (!Array.isArray(state.frontier)) state.frontier = [];
  if (!Array.isArray(state.researchFrontier)) state.researchFrontier = [];
  if (!Array.isArray(state.visited)) state.visited = [];

  const byUrl = new Map(state.frontier.map((entry) => [normalizeUrl(entry?.url), entry]).filter(([url]) => url));
  const revisitHashes = new Set();
  let promoted = 0;
  let merged = 0;

  for (const researchEntry of state.researchFrontier) {
    const url = normalizeUrl(researchEntry?.url);
    if (!url) continue;
    revisitHashes.add(urlHash(url));
    const current = byUrl.get(url);
    if (current) {
      current.priority = Math.max(Number(current.priority || 0), Number(researchEntry.priority || 0));
      current.candidateHints = mergeHints(current.candidateHints, researchEntry.candidateHints);
      current.researchSearch = true;
      merged += 1;
      continue;
    }
    const entry = { ...researchEntry, url, researchSearch: true };
    state.frontier.push(entry);
    byUrl.set(url, entry);
    promoted += 1;
  }

  // Search-index entries were already discovered earlier. Research re-fetches their
  // current page bodies because full article text is intentionally not persisted.
  if (revisitHashes.size) state.visited = state.visited.filter((hash) => !revisitHashes.has(String(hash)));
  state.researchFrontier = [];
  return { promoted, merged, revisitCount: revisitHashes.size };
}

export function restoreUnprocessedResearchFrontier(state) {
  if (!state || typeof state !== 'object') throw new Error('discovery state is required');
  const research = [];
  const discovery = [];
  for (const entry of Array.isArray(state.frontier) ? state.frontier : []) {
    if (entry?.researchSearch === true) {
      const clean = { ...entry };
      delete clean.researchSearch;
      research.push(clean);
    } else {
      discovery.push(entry);
    }
  }
  state.frontier = discovery;
  state.researchFrontier = research;
  return research.length;
}
