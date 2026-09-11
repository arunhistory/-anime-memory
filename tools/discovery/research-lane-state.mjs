import fs from 'node:fs';
import path from 'node:path';
import { normalizeTitleKey } from './html.mjs';
import { normalizeUrl, urlHash } from './url.mjs';

const VERSION = 1;
const MAX_HINTS = 32;

export function emptyResearchLaneState() {
  return {
    version: VERSION,
    frontier: [],
    visited: [],
    titleSearch: {},
    updatedAt: ''
  };
}

function cleanHints(values) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const key = normalizeTitleKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= MAX_HINTS) break;
  }
  return output;
}

function sanitizeFrontier(values) {
  const byUrl = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const url = normalizeUrl(raw?.url);
    if (!url) continue;
    const clean = {
      url,
      priority: Math.max(-100, Math.min(1000, Number(raw?.priority || 0))),
      depth: Math.max(0, Math.trunc(Number(raw?.depth || 0))),
      discoveredFrom: normalizeUrl(raw?.discoveredFrom) || '',
      candidateHints: cleanHints(raw?.candidateHints)
    };
    if (!clean.candidateHints.length) continue;
    const current = byUrl.get(url);
    if (!current) {
      byUrl.set(url, clean);
      continue;
    }
    current.priority = Math.max(current.priority, clean.priority);
    current.depth = Math.min(current.depth, clean.depth);
    if (!current.discoveredFrom && clean.discoveredFrom) current.discoveredFrom = clean.discoveredFrom;
    current.candidateHints = cleanHints([...current.candidateHints, ...clean.candidateHints]);
  }
  return [...byUrl.values()].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
}

function sanitizeTitleSearch(value) {
  const output = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [rawKey, raw] of Object.entries(value)) {
    const key = normalizeTitleKey(rawKey);
    if (!key || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const checkedAt = Number.isFinite(Date.parse(raw.checkedAt)) ? String(raw.checkedAt) : '';
    const url = normalizeUrl(raw.url) || '';
    output[key] = { checkedAt, url };
  }
  return output;
}

function sanitizeState(input) {
  const state = emptyResearchLaneState();
  if (!input || input.version !== VERSION) return state;
  state.frontier = sanitizeFrontier(input.frontier);
  state.visited = [...new Set((Array.isArray(input.visited) ? input.visited : [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^[a-f0-9]{64}$/.test(value)))];
  state.titleSearch = sanitizeTitleSearch(input.titleSearch);
  state.updatedAt = Number.isFinite(Date.parse(input.updatedAt)) ? String(input.updatedAt) : '';
  return state;
}

function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, filePath);
}

export function loadResearchLaneState(filePath) {
  if (!fs.existsSync(filePath)) return emptyResearchLaneState();
  return sanitizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function saveResearchLaneState(filePath, state) {
  const clean = sanitizeState(state);
  clean.updatedAt = new Date().toISOString();
  atomicWrite(filePath, `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}

export function addResearchFrontier(state, entries = []) {
  const current = sanitizeFrontier(state?.frontier);
  const visited = new Set(state?.visited || []);
  const byUrl = new Map(current.map((entry) => [entry.url, entry]));
  let added = 0;

  for (const raw of Array.isArray(entries) ? entries : []) {
    const url = normalizeUrl(raw?.url);
    if (!url || visited.has(urlHash(url))) continue;
    const candidateHints = cleanHints(raw?.candidateHints);
    if (!candidateHints.length) continue;
    const next = {
      url,
      priority: Math.max(-100, Math.min(1000, Number(raw?.priority || 0))),
      depth: Math.max(0, Math.trunc(Number(raw?.depth || 0))),
      discoveredFrom: normalizeUrl(raw?.discoveredFrom) || '',
      candidateHints
    };
    const existing = byUrl.get(url);
    if (existing) {
      existing.priority = Math.max(existing.priority, next.priority);
      existing.depth = Math.min(existing.depth, next.depth);
      existing.candidateHints = cleanHints([...existing.candidateHints, ...next.candidateHints]);
      continue;
    }
    byUrl.set(url, next);
    added += 1;
  }

  state.frontier = [...byUrl.values()].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  return added;
}

export function recordTitleSearch(state, title, { checkedAt = new Date().toISOString(), url = '' } = {}) {
  if (!state.titleSearch || typeof state.titleSearch !== 'object' || Array.isArray(state.titleSearch)) state.titleSearch = {};
  const key = normalizeTitleKey(title);
  if (!key) return;
  state.titleSearch[key] = {
    checkedAt: Number.isFinite(Date.parse(checkedAt)) ? String(checkedAt) : new Date().toISOString(),
    url: normalizeUrl(url) || ''
  };
}
