import { normalizeTitleKey } from './html.mjs';
import { runDiscovery } from './engine.mjs';
import { promoteCorroborationFrontier } from './depth-control.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { candidateInformationReadiness } from './research-completion.mjs';
import { normalizeUrl, urlHash } from './url.mjs';
import { seedTitleBasedResearchRoots } from './research-seed.mjs';

function activeResearchKeys(state) {
  const keys = new Set();
  for (const candidate of Array.isArray(state?.candidates) ? state.candidates : []) {
    if (!discoveryCandidateReadiness(candidate).ready) continue;
    if (candidateInformationReadiness(candidate).ready) continue;
    const key = normalizeTitleKey(candidate?.title || candidate?.key);
    if (key) keys.add(key);
  }
  return keys;
}

function cleanHints(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean))];
}

function addDiscoveryHandoff(state, rawUrl, priority = 450) {
  const url = normalizeUrl(rawUrl);
  if (!url) return false;
  const visited = new Set(state?.visited || []);
  if (visited.has(urlHash(url))) return false;
  if (!Array.isArray(state.frontier)) state.frontier = [];
  const existing = state.frontier.find((entry) => normalizeUrl(entry?.url) === url);
  if (existing) {
    existing.priority = Math.max(Number(existing.priority || 0), Number(priority || 0));
    return false;
  }
  state.frontier.push({
    url,
    priority: Math.max(-100, Math.min(1000, Number(priority || 0))),
    depth: 0,
    discoveredFrom: '',
    candidateHints: []
  });
  return true;
}

function partitionResearchFrontier(mainState, entries) {
  const active = activeResearchKeys(mainState);
  const research = [];
  let discoveryHandoffs = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const hints = cleanHints(entry?.candidateHints);
    const stillResearch = hints.some((hint) => active.has(normalizeTitleKey(hint)));
    if (stillResearch) {
      research.push({ ...entry, candidateHints: hints });
      continue;
    }
    if (addDiscoveryHandoff(mainState, entry?.url, Math.max(250, Number(entry?.priority || 0)))) discoveryHandoffs += 1;
  }
  return { research, discoveryHandoffs };
}

function handoffNewCandidateSources(beforeKeys, state) {
  let added = 0;
  for (const candidate of Array.isArray(state?.candidates) ? state.candidates : []) {
    const key = normalizeTitleKey(candidate?.title || candidate?.key);
    if (!key || beforeKeys.has(key)) continue;
    for (const url of Array.isArray(candidate?.sources) ? candidate.sources : []) {
      if (addDiscoveryHandoff(state, url, 500)) added += 1;
    }
  }
  return added;
}

export async function runResearchLane({
  state,
  researchState,
  fetcher,
  knownWorkSearch = null,
  maxPages = 50,
  maxDepth = 6,
  perHostLimit = 20,
  now = new Date().toISOString(),
  titleSearchFetchImpl = fetch,
  titleSearchTimeoutMs = 15000
} = {}) {
  if (!state || !researchState || !fetcher) throw new Error('state, researchState and fetcher are required');

  const titleSearch = await seedTitleBasedResearchRoots(state, researchState, {
    fetchImpl: titleSearchFetchImpl,
    observedAt: now,
    timeoutMs: titleSearchTimeoutMs
  });

  if (!researchState.frontier.length || Number(maxPages) <= 0) {
    return {
      state,
      researchState,
      stats: { attempted: 0, fetched: 0 },
      titleSearch,
      focus: { promoted: 0, focusCandidate: '' },
      discoveryHandoffs: 0
    };
  }

  const discoveryFrontier = state.frontier;
  const discoveryVisited = state.visited;
  const beforeKeys = new Set((state.candidates || [])
    .map((candidate) => normalizeTitleKey(candidate?.title || candidate?.key))
    .filter(Boolean));

  const laneState = {
    ...state,
    frontier: researchState.frontier,
    visited: researchState.visited,
    engineMode: 'research'
  };
  const focus = promoteCorroborationFrontier(laneState);
  const result = await runDiscovery({
    state: laneState,
    fetcher,
    knownWorkSearch,
    maxPages,
    maxDepth,
    perHostLimit,
    now
  });

  const nextMain = {
    ...result.state,
    frontier: discoveryFrontier,
    visited: discoveryVisited
  };
  delete nextMain.engineMode;

  let discoveryHandoffs = handoffNewCandidateSources(beforeKeys, nextMain);
  const partitioned = partitionResearchFrontier(nextMain, result.state.frontier);
  discoveryHandoffs += partitioned.discoveryHandoffs;
  researchState.frontier = partitioned.research;
  researchState.visited = result.state.visited;

  return {
    state: nextMain,
    researchState,
    stats: result.stats,
    titleSearch,
    focus,
    discoveryHandoffs
  };
}
