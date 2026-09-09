import { extractDocument, extractSitemapUrls, normalizeTitleKey } from './html.mjs';
import { scoreAnimeDocument, scoreDiscoveredLink, isRelevantDocument } from './score.mjs';
import { normalizeUrl, urlHash, hostKey } from './url.mjs';

function popBest(frontier) {
  if (!frontier.length) return null;
  let bestIndex = 0;
  for (let i = 1; i < frontier.length; i += 1) {
    const a = frontier[i];
    const b = frontier[bestIndex];
    if (Number(a.priority || 0) > Number(b.priority || 0)) bestIndex = i;
  }
  return frontier.splice(bestIndex, 1)[0];
}

function addCandidate(candidateMap, candidate, sourceUrl, now) {
  const key = normalizeTitleKey(candidate.title || candidate.key);
  if (!key) return;
  const current = candidateMap.get(key) || { key, title: candidate.title, sources: [], lastSeen: now };
  if (!current.title) current.title = candidate.title;
  if (!current.sources.includes(sourceUrl)) current.sources.push(sourceUrl);
  current.sources = current.sources.slice(0, 50);
  current.lastSeen = now;
  candidateMap.set(key, current);
}

function addFrontier(frontier, queued, visited, entry) {
  const url = normalizeUrl(entry.url);
  if (!url) return false;
  const hash = urlHash(url);
  if (visited.has(hash) || queued.has(url)) return false;
  frontier.push({
    url,
    priority: Math.max(-100, Math.min(1000, Number(entry.priority || 0))),
    depth: Math.max(0, Number(entry.depth || 0)),
    discoveredFrom: normalizeUrl(entry.discoveredFrom) || ''
  });
  queued.add(url);
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
    maxPages = 200,
    maxDepth = 5,
    perHostLimit = 40,
    now = new Date().toISOString()
  } = options;

  if (!state || !fetcher) throw new Error('state and fetcher are required');

  const frontier = state.frontier;
  const visited = new Set(state.visited || []);
  const queued = new Set(frontier.map((entry) => normalizeUrl(entry.url)).filter(Boolean));
  const candidateMap = new Map((state.candidates || []).map((candidate) => [normalizeTitleKey(candidate.title || candidate.key), { ...candidate }]));
  const hostCounts = new Map();
  const stats = {
    attempted: 0,
    fetched: 0,
    relevant: 0,
    candidatesFound: 0,
    newLinks: 0,
    robotsSkipped: 0,
    otherSkipped: 0,
    failed: 0,
    sitemapLinks: 0
  };

  while (frontier.length && stats.attempted < maxPages) {
    const entry = popBest(frontier);
    if (!entry) break;
    queued.delete(entry.url);
    const normalized = normalizeUrl(entry.url);
    if (!normalized) continue;
    const hash = urlHash(normalized);
    if (visited.has(hash)) continue;
    if (entry.depth > maxDepth) continue;

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
      console.warn(`Discovery fetch failed: ${normalized}: ${error.message}`);
      continue;
    }

    if (!result.ok) {
      if (result.skipped) {
        if (String(result.reason).startsWith('robots')) stats.robotsSkipped += 1;
        else stats.otherSkipped += 1;
        visited.add(hash);
      } else {
        stats.failed += 1;
      }
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
          discoveredFrom: result.url
        })) stats.sitemapLinks += 1;
      }
      continue;
    }

    const document = extractDocument(result.text, result.url);
    if (document.noindex && document.nofollow) continue;

    const pageScore = scoreAnimeDocument(document);
    const candidateTitles = document.candidates.map((item) => item.title);
    const relevant = isRelevantDocument(pageScore);
    if (relevant) stats.relevant += 1;

    if (!document.noindex && relevant) {
      mergeDocument(state.documents, {
        url: document.canonical || document.url,
        title: document.ogTitle || document.title,
        score: pageScore,
        candidateTitles,
        lastChecked: now
      });
    }

    for (const candidate of document.candidates) {
      const before = candidateMap.size;
      addCandidate(candidateMap, candidate, document.canonical || document.url, now);
      if (candidateMap.size > before) stats.candidatesFound += 1;
    }

    if (document.nofollow) continue;

    const existingCandidateTitles = [...candidateMap.values()].slice(-200).map((item) => item.title);
    const titleBoostSet = [...new Set([...candidateTitles, ...existingCandidateTitles])].slice(0, 250);
    const sameOrigin = new URL(document.url).origin;
    const rankedLinks = [];
    for (const link of document.links) {
      const linkUrl = normalizeUrl(link.url, document.url);
      if (!linkUrl) continue;
      const linkOrigin = new URL(linkUrl).origin;
      const linkScore = scoreDiscoveredLink(link, pageScore, titleBoostSet);
      const sameSite = linkOrigin === sameOrigin;

      const minScore = relevant ? (sameSite ? 0 : 18) : (sameSite ? 25 : 55);
      if (linkScore < minScore) continue;
      rankedLinks.push({ linkUrl, linkScore, sameSite });
    }

    rankedLinks.sort((a, b) => b.linkScore - a.linkScore);
    let externalAdded = 0;
    for (const item of rankedLinks.slice(0, 200)) {
      if (!item.sameSite && externalAdded >= 30) continue;
      if (addFrontier(frontier, queued, visited, {
        url: item.linkUrl,
        priority: Number(entry.priority || 0) * 0.35 + item.linkScore,
        depth: entry.depth + 1,
        discoveredFrom: document.url
      })) {
        stats.newLinks += 1;
        if (!item.sameSite) externalAdded += 1;
      }
    }

    for (const sitemap of result.sitemaps || []) {
      if (addFrontier(frontier, queued, visited, {
        url: sitemap,
        priority: Math.max(50, Number(entry.priority || 0)),
        depth: Math.min(entry.depth + 1, maxDepth),
        discoveredFrom: document.url
      })) stats.sitemapLinks += 1;
    }
  }

  state.visited = [...visited];
  state.candidates = [...candidateMap.values()];
  state.frontier = frontier;
  state.updatedAt = now;
  return { state, stats };
}
