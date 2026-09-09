import fs from 'node:fs';
import path from 'node:path';
import { normalizeUrl, urlHash } from './url.mjs';
import { normalizeTitleKey } from './html.mjs';

export function emptyDiscoveryState() {
  return {
    version: 1,
    frontier: [],
    visited: [],
    documents: [],
    candidates: [],
    updatedAt: ''
  };
}

function sanitizeState(input) {
  const state = emptyDiscoveryState();
  if (!input || input.version !== 1) return state;
  state.frontier = Array.isArray(input.frontier) ? input.frontier : [];
  state.visited = Array.isArray(input.visited) ? input.visited : [];
  state.documents = Array.isArray(input.documents) ? input.documents : [];
  state.candidates = Array.isArray(input.candidates) ? input.candidates : [];
  state.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : '';
  return state;
}

export function loadDiscoveryState(filePath) {
  if (!fs.existsSync(filePath)) return emptyDiscoveryState();
  return sanitizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function saveDiscoveryState(filePath, state) {
  const clean = sanitizeState(state);
  clean.updatedAt = new Date().toISOString();
  clean.frontier = clean.frontier
    .filter((entry) => normalizeUrl(entry.url))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, 50000);
  clean.visited = [...new Set(clean.visited.map(String))].slice(-250000);
  clean.documents = clean.documents
    .map((doc) => ({
      url: normalizeUrl(doc.url),
      title: String(doc.title || '').slice(0, 500),
      score: Number(doc.score || 0),
      candidateTitles: [...new Set((doc.candidateTitles || []).map(String))].slice(0, 30),
      lastChecked: String(doc.lastChecked || '')
    }))
    .filter((doc) => doc.url)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20000);
  clean.candidates = clean.candidates
    .map((candidate) => ({
      key: normalizeTitleKey(candidate.title || candidate.key),
      title: String(candidate.title || '').slice(0, 120),
      sources: [...new Set((candidate.sources || []).map(normalizeUrl).filter(Boolean))].slice(0, 50),
      lastSeen: String(candidate.lastSeen || '')
    }))
    .filter((candidate) => candidate.key && candidate.title)
    .slice(0, 20000);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

export function seedFrontier(state, urls, priority = 100) {
  const seen = new Set(state.frontier.map((entry) => entry.url));
  const visited = new Set(state.visited);
  for (const raw of urls) {
    const url = normalizeUrl(raw);
    if (!url || seen.has(url) || visited.has(urlHash(url))) continue;
    state.frontier.push({ url, priority, depth: 0, discoveredFrom: '' });
    seen.add(url);
  }
}
