import { extractDocument, extractSitemapUrls, normalizeTitleKey } from './html.mjs';
import { scoreAnimeDocument, scoreDiscoveredLink, isRelevantDocument } from './score.mjs';
import { extractCandidateEvidence, mergeEvidence } from './evidence.mjs';
import { resolveCandidateEntities } from './entity-resolution.mjs';
import { collapseSameFamilyEvidence } from './source-family.mjs';
import {
  buildResearchStrategyModel,
  emptyResearchStrategyState,
  learnSourceTrustFromKnownRecord,
  recordResearchOperation,
  scoreResearchRoute
} from './research-strategy.mjs';
import { calibrateSourceTrustFromConsensus } from './trust-calibration.mjs';
import { resolveEvidenceWithTrust } from './trust-resolution.mjs';
import { normalizeUrl, urlHash, hostKey } from './url.mjs';

function popBest(frontier, trustModel) {
  if (!frontier.length) return null;
  let bestIndex = 0;
  let bestScore = Number(frontier[0]?.priority || 0) + scoreResearchRoute(trustModel, { url: frontier[0]?.url }).boost;
  for (let i = 1; i < frontier.length; i += 1) {
    const score = Number(frontier[i]?.priority || 0) + scoreResearchRoute(trustModel, { url: frontier[i]?.url }).boost;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return frontier.splice(bestIndex, 1)[0];
}

function normalizeCandidateHints(values) {
  const source = Array.isArray(values) ? values : [];
  const output = [];
  const seen = new Set();
  for (const value of source) {
    const title = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(title);
    if (output.length >= 4) break;
  }
  return output;
}

function pageFocusesCandidate(document, title) {
  const candidate = String(title || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!candidate) return false;
  const headline = `${document.title || ''}\n${document.ogTitle || ''}\n${document.description || ''}`
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
  if (headline.includes(candidate)) return true;

  const key = normalizeTitleKey(candidate);
  if (key.length < 4) return false;
  return normalizeTitleKey(headline).includes(key);
}

function addCandidate(candidateMap, candidate, sourceUrl, now, evidence, trustModel) {
  const key = normalizeTitleKey(candidate.title || candidate.key);
  if (!key) return false;
  const existed = candidateMap.has(key);
  const current = candidateMap.get(key) || {
    key,
    title: candidate.title,
    sources: [],
    evidence: [],
    facts: {},
    lastSeen: now
  };
  if (!current.title) current.title = candidate.title;
  if (!Array.isArray(current.sources)) current.sources = [];
  if (!current.sources.includes(sourceUrl)) current.sources.push(sourceUrl);
  current.sources = current.sources.slice(0, 50);
  current.evidence = collapseSameFamilyEvidence(mergeEvidence(current.evidence, evidence || []));
  current.facts = resolveEvidenceWithTrust(current.evidence, trustModel);
  current.lastSeen = now;
  candidateMap.set(key, current);
  return !existed;
}

function addFrontier(frontier, queued, visited, entry) {
  const url = normalizeUrl(entry.url);
  if (!url) return false;
  const hash = urlHash(url);
  if (visited.has(hash)) return false;

  const priority = Math.max(-100, Math.min(1000, Number(entry.priority || 0)));
  const candidateHints = normalizeCandidateHints(entry.candidateHints);
  const existing = queued.get(url);
  if (existing) {
    existing.priority = Math.max(Number(existing.priority || 0), priority);
    existing.candidateHints = normalizeCandidateHints([
      ...(existing.candidateHints || []),
      ...candidateHints
    ]);
    return false;
  }

  const item = {
    url,
    priority,
    depth: Math.max(0, Number(entry.depth || 0)),
    discoveredFrom: normalizeUrl(entry.discoveredFrom) || '',
    candidateHints
  };
  frontier.push(item);
  queued.set(url, item);
  return true;
}

function mergeDocument(documents, doc) {
  const index = documents.findIndex((item) => item.url === doc.url);
  if (index >= 0) documents[index] = doc;
  else documents.push(doc);
}

export async function runDiscovery(options) {
  const {
    state,
    fetcher,
    knownWorkSearch = null,
    maxPages = 200,
    maxDepth = 5,
    perHostLimit = 40,
    now = new Date().toISOString()
  } = options;

  if (!state || !fetcher) throw new Error('state and fetcher are required');
  if (!state.researchStrategy || state.researchStrategy.version !== 1) state.researchStrategy = emptyResearchStrategyState();
  if (!Array.isArray(state.calibrationSeen)) state.calibrationSeen = [];
  let trustModel = buildResearchStrategyModel(state);

  const knownTitleCache = new Map();
  const lookupKnownTitle = (title) => {
    const value = String(title || '').trim();
    if (!value || !knownWorkSearch?.available) return { known: false, record: null };
    if (knownTitleCache.has(value)) return knownTitleCache.get(value);
    const known = Boolean(knownWorkSearch.hasExactTitle(value));
    const record = known && typeof knownWorkSearch.findUniqueExactRecord === 'function'
      ? knownWorkSearch.findUniqueExactRecord(value)
      : null;
    const result = { known, record };
    knownTitleCache.set(value, result);
    return result;
  };
  const isKnownTitle = (title) => lookupKnownTitle(title).known;

  const frontier = state.frontier;
  const visited = new Set(state.visited || []);
  const queued = new Map();
  for (const entry of frontier) {
    const url = normalizeUrl(entry?.url);
    if (!url) continue;
    queued.set(url, entry);
    entry.candidateHints = normalizeCandidateHints(entry.candidateHints);
  }
  const hostCounts = new Map();
  const deferredBlocked = [];
  const stats = {
    attempted: 0,
    fetched: 0,
    relevant: 0,
    discoveryOnlyPages: 0,
    candidatesFound: 0,
    entityMerges: 0,
    evidenceClaims: 0,
    verificationPages: 0,
    verificationEvidenceClaims: 0,
    verificationLinksPromoted: 0,
    sourceTrustTrainingClaims: 0,
    coldStartTrustTrainingClaims: 0,
    coldStartConsensusFields: 0,
    coldStartConflictedFieldsSkipped: 0,
    researchStrategyBoostedLinks: 0,
    newLinks: 0,
    robotsSkipped: 0,
    otherSkipped: 0,
    hostFiltered: 0,
    failed: 0,
    sitemapLinks: 0,
    knownWorkCandidatesSkipped: 0,
    knownStateCandidatesPruned: 0
  };

  const candidateMap = new Map();
  for (const candidate of state.candidates || []) {
    if (isKnownTitle(candidate.title || candidate.key)) {
      stats.knownStateCandidatesPruned += 1;
      continue;
    }
    const collapsedEvidence = collapseSameFamilyEvidence(mergeEvidence(candidate.evidence || []));
    candidateMap.set(normalizeTitleKey(candidate.title || candidate.key), {
      ...candidate,
      evidence: collapsedEvidence,
      facts: resolveEvidenceWithTrust(collapsedEvidence, trustModel)
    });
  }

  while (frontier.length && stats.attempted < maxPages) {
    const entry = popBest(frontier, trustModel);
    if (!entry) break;
    queued.delete(entry.url);
    const normalized = normalizeUrl(entry.url);
    if (!normalized) continue;
    const hash = urlHash(normalized);
    if (visited.has(hash)) continue;
    if (entry.depth > maxDepth) continue;

    if (typeof fetcher.isHostAllowed === 'function' && !fetcher.isHostAllowed(normalized)) {
      deferredBlocked.push(entry);
      stats.hostFiltered += 1;
      continue;
    }

    const host = hostKey(normalized);
    const hostCount = hostCounts.get(host) || 0;
    if (hostCount >= perHostLimit) {
      addFrontier(frontier, queued, visited, { ...entry, priority: Number(entry.priority || 0) - 5 });
      continue;
    }
    hostCounts.set(host, hostCount + 1);
    stats.attempted += 1;

    let result;
    try {
      result = await fetcher.fetchPage(normalized);
    } catch (error) {
      stats.failed += 1;
      recordResearchOperation(state.researchStrategy, { url: normalized, failed: true, observedAt: now });
      trustModel = buildResearchStrategyModel(state);
      console.warn(`Discovery fetch failed: ${normalized}: ${error.message}`);
      continue;
    }

    if (!result.ok) {
      if (result.skipped) {
        if (String(result.reason).startsWith('robots')) stats.robotsSkipped += 1;
        else stats.otherSkipped += 1;
        recordResearchOperation(state.researchStrategy, { url: normalized, blocked: true, observedAt: now });
        visited.add(hash);
      } else {
        stats.failed += 1;
        recordResearchOperation(state.researchStrategy, { url: normalized, failed: true, observedAt: now });
      }
      trustModel = buildResearchStrategyModel(state);
      continue;
    }

    stats.fetched += 1;
    visited.add(hash);

    const contentType = String(result.contentType || '').toLowerCase();
    if (contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom')) {
      const sitemapUrls = extractSitemapUrls(result.text, result.url);
      for (const url of sitemapUrls.slice(0, 5000)) {
        if (addFrontier(frontier, queued, visited, {
          url,
          priority: Math.max(35, Number(entry.priority || 0) - 10),
          depth: entry.depth + 1,
          discoveredFrom: result.url,
          candidateHints: entry.candidateHints || []
        })) stats.sitemapLinks += 1;
      }
      recordResearchOperation(state.researchStrategy, { url: normalized, fetched: true, evidenceClaims: 0, observedAt: now });
      trustModel = buildResearchStrategyModel(state);
      continue;
    }

    const document = extractDocument(result.text, result.url);
    const pageScore = scoreAnimeDocument(document);
    const candidateKnowledge = new Map(document.candidates.map((candidate) => [candidate.key, lookupKnownTitle(candidate.title)]));
    const novelCandidates = document.noindex
      ? []
      : document.candidates.filter((candidate) => !candidateKnowledge.get(candidate.key)?.known);
    const detectedTitles = novelCandidates.map((item) => item.title);
    const subjectKey = document.subjectCandidate?.key || '';
    const subjectKnown = Boolean(subjectKey && candidateKnowledge.get(subjectKey)?.known);
    const persistableCandidateTitles = document.noindex || document.discoveryOnly || !document.subjectCandidate || subjectKnown
      ? []
      : [document.subjectCandidate.title];
    const relevant = !document.noindex && isRelevantDocument(pageScore);
    if (relevant) stats.relevant += 1;
    if (relevant && document.discoveryOnly) stats.discoveryOnlyPages += 1;

    let pageEvidenceClaims = 0;
    const acceptedVerificationHints = [];
    if (relevant) {
      mergeDocument(state.documents, {
        url: document.canonical || document.url,
        title: document.ogTitle || document.title,
        score: pageScore,
        candidateTitles: persistableCandidateTitles,
        discoveryOnly: Boolean(document.discoveryOnly),
        lastChecked: now
      });

      if (!document.discoveryOnly) {
        for (const candidate of document.candidates) {
          const knownInfo = candidateKnowledge.get(candidate.key) || { known: false, record: null };
          const candidateKey = normalizeTitleKey(candidate.title || candidate.key);
          const subjectOrFocused = subjectKey === candidateKey || pageFocusesCandidate(document, candidate.title);

          if (knownInfo.known) {
            stats.knownWorkCandidatesSkipped += 1;
            if (knownInfo.record && subjectOrFocused) {
              const trainingEvidence = extractCandidateEvidence(document, candidate, now);
              pageEvidenceClaims += trainingEvidence.length;
              const trained = learnSourceTrustFromKnownRecord(state.researchStrategy, trainingEvidence, knownInfo.record, now);
              stats.sourceTrustTrainingClaims += trained;
              if (trained > 0) trustModel = buildResearchStrategyModel(state);
            }
            continue;
          }

          const sourceUrl = document.canonical || document.url;
          const extracted = extractCandidateEvidence(document, candidate, now);
          const evidence = subjectKey && candidateKey === subjectKey
            ? extracted
            : extracted.filter((item) => item.field === 'title_ja');
          stats.evidenceClaims += evidence.length;
          pageEvidenceClaims += evidence.length;
          if (addCandidate(candidateMap, candidate, sourceUrl, now, evidence, trustModel)) stats.candidatesFound += 1;
        }

        const verificationHints = normalizeCandidateHints(entry.candidateHints);
        for (const hint of verificationHints) {
          const hintKey = normalizeTitleKey(hint);
          if (!hintKey) continue;
          const knownInfo = lookupKnownTitle(hint);
          if (knownInfo.known) {
            if (knownInfo.record && pageFocusesCandidate(document, hint)) {
              const trainingCandidate = { key: hintKey, title: hint };
              const trainingEvidence = extractCandidateEvidence(document, trainingCandidate, now);
              pageEvidenceClaims += trainingEvidence.length;
              const trained = learnSourceTrustFromKnownRecord(state.researchStrategy, trainingEvidence, knownInfo.record, now);
              stats.sourceTrustTrainingClaims += trained;
              if (trained > 0) trustModel = buildResearchStrategyModel(state);
            }
            continue;
          }

          const existingCandidate = candidateMap.get(hintKey);
          if (!existingCandidate) continue;

          if (subjectKey === hintKey) {
            acceptedVerificationHints.push(existingCandidate.title || hint);
            continue;
          }
          if (!pageFocusesCandidate(document, existingCandidate.title || hint)) continue;

          const sourceUrl = document.canonical || document.url;
          const verificationCandidate = {
            key: hintKey,
            title: existingCandidate.title || hint
          };
          const evidence = extractCandidateEvidence(document, verificationCandidate, now);
          if (!evidence.length) continue;
          stats.verificationPages += 1;
          stats.verificationEvidenceClaims += evidence.length;
          stats.evidenceClaims += evidence.length;
          pageEvidenceClaims += evidence.length;
          addCandidate(candidateMap, verificationCandidate, sourceUrl, now, evidence, trustModel);
          acceptedVerificationHints.push(verificationCandidate.title);
        }
      }
    }

    recordResearchOperation(state.researchStrategy, {
      url: normalized,
      fetched: true,
      evidenceClaims: pageEvidenceClaims,
      observedAt: now
    });
    trustModel = buildResearchStrategyModel(state);

    if (document.nofollow) continue;

    const existingCandidateTitles = [...candidateMap.values()].slice(-200).map((item) => item.title);
    const titleBoostSet = [...new Set([...detectedTitles, ...existingCandidateTitles])].slice(0, 250);
    const sameOrigin = new URL(document.url).origin;
    const subjectHint = relevant && !document.discoveryOnly && document.subjectCandidate && !subjectKnown
      ? document.subjectCandidate.title
      : '';
    const verificationHintsForLinks = normalizeCandidateHints([
      subjectHint,
      ...acceptedVerificationHints
    ]);
    const rankedLinks = [];
    for (const link of document.links) {
      const linkUrl = normalizeUrl(link.url, document.url);
      if (!linkUrl) continue;
      const linkOrigin = new URL(linkUrl).origin;
      const rawLinkScore = scoreDiscoveredLink(link, pageScore, titleBoostSet);
      const sameSite = linkOrigin === sameOrigin;

      const minScore = relevant ? (sameSite ? 0 : 18) : (sameSite ? 25 : 55);
      if (rawLinkScore < minScore) continue;
      const verificationBoost = verificationHintsForLinks.length ? (sameSite ? 25 : 45) : 0;
      const learned = scoreResearchRoute(trustModel, { url: linkUrl, anchor: link.anchor });
      if (learned.boost !== 0) stats.researchStrategyBoostedLinks += 1;
      const linkScore = Math.max(-100, Math.min(500, rawLinkScore + verificationBoost + learned.boost));
      rankedLinks.push({ linkUrl, linkScore, sameSite, candidateHints: verificationHintsForLinks });
    }

    rankedLinks.sort((a, b) => b.linkScore - a.linkScore);
    let externalAdded = 0;
    for (const item of rankedLinks.slice(0, 200)) {
      if (!item.sameSite && externalAdded >= 30) continue;
      const added = addFrontier(frontier, queued, visited, {
        url: item.linkUrl,
        priority: Number(entry.priority || 0) * 0.35 + item.linkScore,
        depth: entry.depth + 1,
        discoveredFrom: document.url,
        candidateHints: item.candidateHints
      });
      if (item.candidateHints.length) stats.verificationLinksPromoted += 1;
      if (added) {
        stats.newLinks += 1;
        if (!item.sameSite) externalAdded += 1;
      }
    }

    for (const sitemap of result.sitemaps || []) {
      if (addFrontier(frontier, queued, visited, {
        url: sitemap,
        priority: Math.max(50, Number(entry.priority || 0)),
        depth: Math.min(entry.depth + 1, maxDepth),
        discoveredFrom: document.url,
        candidateHints: acceptedVerificationHints
      })) stats.sitemapLinks += 1;
    }
  }

  for (const entry of deferredBlocked) addFrontier(frontier, queued, visited, entry);

  let resolved = resolveCandidateEntities(
    [...candidateMap.values()],
    (evidence) => resolveEvidenceWithTrust(evidence, trustModel)
  );

  const calibration = calibrateSourceTrustFromConsensus({
    candidates: resolved.candidates,
    strategyState: state.researchStrategy,
    seen: state.calibrationSeen,
    observedAt: now
  });
  state.calibrationSeen = calibration.seen;
  stats.coldStartTrustTrainingClaims = calibration.trained;
  stats.coldStartConsensusFields = calibration.consensusFields;
  stats.coldStartConflictedFieldsSkipped = calibration.conflictedFieldsSkipped;

  if (calibration.trained > 0) {
    trustModel = buildResearchStrategyModel(state);
    resolved = resolveCandidateEntities(
      resolved.candidates,
      (evidence) => resolveEvidenceWithTrust(evidence, trustModel)
    );
  }

  stats.entityMerges = resolved.merges;
  state.visited = [...visited];
  state.candidates = resolved.candidates;
  state.frontier = frontier;
  state.updatedAt = now;
  return { state, stats };
}
