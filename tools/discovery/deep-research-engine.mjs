import { extractDocument, normalizeTitleKey } from './html.mjs';
import { extractCandidateEvidence, mergeEvidence } from './evidence.mjs';
import { collapseSameFamilyEvidence } from './source-family.mjs';
import { resolveEvidenceWithTrust } from './trust-resolution.mjs';
import {
  buildResearchStrategyModel,
  emptyResearchStrategyState,
  recordResearchOperation
} from './research-strategy.mjs';
import {
  candidateInformationReadiness,
  recordCandidateResearch,
  sanitizeCandidateResearch
} from './research-completion.mjs';
import { normalizeUrl, hostKey, urlHash } from './url.mjs';

function normalizeHints(values) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const title = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 160);
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(title);
    if (output.length >= 32) break;
  }
  return output;
}

function normalizeResearchEntry(entry) {
  const url = normalizeUrl(entry?.url);
  if (!url) return null;
  return {
    url,
    priority: Math.max(-100, Math.min(1000, Number(entry?.priority || 0))),
    depth: Math.max(0, Number(entry?.depth || 0)),
    discoveredFrom: normalizeUrl(entry?.discoveredFrom) || '',
    candidateHints: normalizeHints(entry?.candidateHints)
  };
}

function mergeQueueEntry(map, entry) {
  const clean = normalizeResearchEntry(entry);
  if (!clean) return false;
  const existing = map.get(clean.url);
  if (existing) {
    existing.priority = Math.max(existing.priority, clean.priority);
    existing.candidateHints = normalizeHints([...existing.candidateHints, ...clean.candidateHints]);
    return false;
  }
  map.set(clean.url, clean);
  return true;
}

function pageFocusesCandidate(document, title) {
  const candidate = String(title || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!candidate) return false;
  const headline = `${document.title || ''}\n${document.ogTitle || ''}\n${document.description || ''}\n${document.keywords || ''}`
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
  if (headline.includes(candidate)) return true;

  const key = normalizeTitleKey(candidate);
  if (key.length < 4) return false;
  const body = String(document.text || '').normalize('NFKC');
  return normalizeTitleKey(headline).includes(key) || normalizeTitleKey(body).includes(key);
}

function linkMatchesTitle(link, title) {
  const key = normalizeTitleKey(title);
  if (!key) return false;
  const anchorKey = normalizeTitleKey(link?.anchor || '');
  if (anchorKey && anchorKey.includes(key)) return true;
  if (key.length < 4) return false;
  const urlKey = normalizeTitleKey(link?.url || '');
  return Boolean(urlKey && urlKey.includes(key));
}

function addDiscoveryFrontier(state, entry) {
  if (!Array.isArray(state.frontier)) state.frontier = [];
  if (!Array.isArray(state.visited)) state.visited = [];
  const url = normalizeUrl(entry?.url);
  if (!url || state.visited.includes(urlHash(url))) return false;
  const existing = state.frontier.find((item) => normalizeUrl(item?.url) === url);
  if (existing) {
    existing.priority = Math.max(Number(existing.priority || 0), Number(entry?.priority || 0));
    existing.candidateHints = normalizeHints([...(existing.candidateHints || []), ...(entry?.candidateHints || [])]);
    return false;
  }
  state.frontier.push({
    url,
    priority: Math.max(-100, Math.min(1000, Number(entry?.priority || 0))),
    depth: Math.max(0, Number(entry?.depth || 0)),
    discoveredFrom: normalizeUrl(entry?.discoveredFrom) || '',
    candidateHints: normalizeHints(entry?.candidateHints)
  });
  return true;
}

function isRetryableSkip(reason) {
  const value = String(reason || '');
  return value === 'http-408'
    || value === 'http-425'
    || value === 'http-429'
    || /^http-5\d\d$/.test(value)
    || value.startsWith('robots-fetch:')
    || /^robots-http-5\d\d$/.test(value);
}

function recordSkip(stats, reason) {
  const key = String(reason || 'unknown').slice(0, 160);
  stats.skipReasons[key] = (stats.skipReasons[key] || 0) + 1;
}

function updateCandidateFromPage(candidate, document, sourceUrl, now, trustModel) {
  const evidence = extractCandidateEvidence(document, {
    key: candidate.key,
    title: candidate.title,
    series: candidate.series
  }, now);
  candidate.sources = [...new Set([...(candidate.sources || []), sourceUrl])].slice(-50);
  candidate.evidence = collapseSameFamilyEvidence(mergeEvidence(candidate.evidence || [], evidence));
  candidate.research = recordCandidateResearch(candidate.research, {
    url: sourceUrl,
    evidence,
    observedAt: now
  });
  candidate.facts = resolveEvidenceWithTrust(candidate.evidence, trustModel);
  candidate.lastSeen = now;
  return evidence;
}

function queueSameWorkLinks(state, document, candidate, entry, queuedResearch) {
  if (document.nofollow || candidateInformationReadiness(candidate).ready) return 0;
  const researched = new Set(sanitizeCandidateResearch(candidate.research).pageUrls);
  let added = 0;
  for (const link of document.links || []) {
    const url = normalizeUrl(link?.url, document.url);
    if (!url || researched.has(url) || !linkMatchesTitle(link, candidate.title)) continue;
    if (mergeQueueEntry(queuedResearch, {
      url,
      priority: Math.max(180, Number(entry.priority || 0) - 10),
      depth: 0,
      discoveredFrom: document.url,
      candidateHints: [candidate.title]
    })) added += 1;
  }
  return added;
}

function routeDistinctWorkLinks(state, document, acceptedKeys, entry) {
  if (document.nofollow) return 0;
  const otherTitles = (document.candidates || [])
    .map((candidate) => String(candidate?.title || '').trim())
    .filter((title) => title && !acceptedKeys.has(normalizeTitleKey(title)));
  let added = 0;
  for (const link of document.links || []) {
    const title = otherTitles.find((candidateTitle) => linkMatchesTitle(link, candidateTitle));
    if (!title) continue;
    if (addDiscoveryFrontier(state, {
      url: link.url,
      priority: Math.max(90, Number(entry.priority || 0) * 0.25),
      depth: 0,
      discoveredFrom: document.url,
      candidateHints: [title]
    })) added += 1;
  }

  const subjectTitle = String(document.subjectCandidate?.title || '').trim();
  if (subjectTitle && !acceptedKeys.has(normalizeTitleKey(subjectTitle))) {
    if (addDiscoveryFrontier(state, {
      url: document.canonical || document.url,
      priority: Math.max(120, Number(entry.priority || 0) * 0.3),
      depth: 0,
      discoveredFrom: entry.discoveredFrom,
      candidateHints: [subjectTitle]
    })) added += 1;
  }
  return added;
}

export async function runDeepResearch({
  state,
  fetcher,
  maxPages = 100,
  perHostLimit = 100,
  now = new Date().toISOString()
} = {}) {
  if (!state || !fetcher) throw new Error('state and fetcher are required');
  if (!Array.isArray(state.researchFrontier)) state.researchFrontier = [];
  if (!Array.isArray(state.candidates)) state.candidates = [];
  if (!state.researchStrategy || state.researchStrategy.version !== 1) state.researchStrategy = emptyResearchStrategyState();

  let trustModel = buildResearchStrategyModel(state);
  const candidateMap = new Map();
  for (const candidate of state.candidates) {
    const key = normalizeTitleKey(candidate?.title || candidate?.key);
    if (!key) continue;
    const evidence = collapseSameFamilyEvidence(mergeEvidence(candidate.evidence || []));
    candidateMap.set(key, {
      ...candidate,
      evidence,
      facts: resolveEvidenceWithTrust(evidence, trustModel)
    });
  }

  const queued = new Map();
  for (const entry of state.researchFrontier) mergeQueueEntry(queued, entry);
  const ordered = [...queued.values()].sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url));
  const leftovers = new Map();
  const newlyQueued = new Map();
  const hostCounts = new Map();
  const touchedCandidates = new Set();
  const stats = {
    attempted: 0,
    fetched: 0,
    matchedPages: 0,
    candidatesMatched: 0,
    evidenceClaims: 0,
    researchLinksQueued: 0,
    discoveryLinksQueued: 0,
    retryQueued: 0,
    permanentSkipped: 0,
    failed: 0,
    skipReasons: {},
    startFrontier: ordered.length,
    remainingFrontier: 0
  };

  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    if (stats.attempted >= maxPages) {
      for (let rest = index; rest < ordered.length; rest += 1) mergeQueueEntry(leftovers, ordered[rest]);
      break;
    }

    const host = hostKey(entry.url);
    if ((hostCounts.get(host) || 0) >= perHostLimit) {
      mergeQueueEntry(leftovers, entry);
      continue;
    }
    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
    stats.attempted += 1;

    let result;
    try {
      result = await fetcher.fetchPage(entry.url);
    } catch (error) {
      stats.failed += 1;
      stats.retryQueued += 1;
      mergeQueueEntry(leftovers, entry);
      recordResearchOperation(state.researchStrategy, { url: entry.url, failed: true, observedAt: now });
      continue;
    }

    if (!result.ok) {
      recordSkip(stats, result.reason);
      if (!result.skipped || isRetryableSkip(result.reason)) {
        stats.retryQueued += 1;
        mergeQueueEntry(leftovers, entry);
        recordResearchOperation(state.researchStrategy, { url: entry.url, failed: true, observedAt: now });
      } else {
        stats.permanentSkipped += 1;
        recordResearchOperation(state.researchStrategy, { url: entry.url, blocked: true, observedAt: now });
      }
      continue;
    }

    stats.fetched += 1;
    const document = extractDocument(result.text, result.url);
    const sourceUrl = normalizeUrl(document.canonical || document.url) || entry.url;
    const acceptedKeys = new Set();
    let pageEvidenceClaims = 0;

    for (const hint of normalizeHints(entry.candidateHints)) {
      const key = normalizeTitleKey(hint);
      const candidate = candidateMap.get(key);
      if (!candidate || !pageFocusesCandidate(document, candidate.title || hint)) continue;
      const evidence = updateCandidateFromPage(candidate, document, sourceUrl, now, trustModel);
      candidateMap.set(key, candidate);
      touchedCandidates.add(key);
      acceptedKeys.add(key);
      pageEvidenceClaims += evidence.length;
      stats.evidenceClaims += evidence.length;
      stats.candidatesMatched += 1;
      stats.researchLinksQueued += queueSameWorkLinks(state, document, candidate, entry, newlyQueued);
    }

    if (acceptedKeys.size) stats.matchedPages += 1;
    stats.discoveryLinksQueued += routeDistinctWorkLinks(state, document, acceptedKeys, entry);
    recordResearchOperation(state.researchStrategy, {
      url: sourceUrl,
      fetched: true,
      evidenceClaims: pageEvidenceClaims,
      observedAt: now
    });
    trustModel = buildResearchStrategyModel(state);
  }

  for (const [key, candidate] of candidateMap) {
    if (!touchedCandidates.has(key)) continue;
    candidate.facts = resolveEvidenceWithTrust(candidate.evidence || [], trustModel);
  }

  const finalQueue = new Map();
  for (const entry of leftovers.values()) mergeQueueEntry(finalQueue, entry);
  for (const entry of newlyQueued.values()) mergeQueueEntry(finalQueue, entry);
  state.researchFrontier = [...finalQueue.values()];
  state.candidates = state.candidates.map((candidate) => candidateMap.get(normalizeTitleKey(candidate?.title || candidate?.key)) || candidate);
  state.updatedAt = now;
  stats.remainingFrontier = state.researchFrontier.length;
  return { state, stats };
}
