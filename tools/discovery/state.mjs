import fs from 'node:fs';
import path from 'node:path';
import { normalizeUrl, urlHash } from './url.mjs';
import { normalizeTitleKey } from './html.mjs';
import { mergeEvidence } from './evidence.mjs';
import { collapseSameFamilyEvidence } from './source-family.mjs';
import { sanitizeSeriesKnowledge } from './series-learning.mjs';
import { recordCandidateResearch, sanitizeCandidateResearch } from './research-completion.mjs';
import {
  buildResearchStrategyModel,
  emptyResearchStrategyState,
  sanitizeResearchStrategyState
} from './research-strategy.mjs';
import { resolveEvidenceWithTrust } from './trust-resolution.mjs';
import { sanitizeWikidataBootstrapState } from './wikidata-bootstrap.mjs';
import { sanitizeWikidataSeriesExpansionState } from './wikidata-series-expansion.mjs';

const MAX_CANDIDATE_HINTS = 32;
const MAX_DOCUMENT_METADATA = 20000;

export function emptyDiscoveryState() {
  return {
    version: 1,
    frontier: [],
    visited: [],
    documents: [],
    candidates: [],
    researchStrategy: emptyResearchStrategyState(),
    calibrationSeen: [],
    wikidataBootstrap: sanitizeWikidataBootstrapState(),
    wikidataSeriesExpansion: sanitizeWikidataSeriesExpansionState(),
    updatedAt: ''
  };
}

function sanitizeCalibrationSeen(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^[a-f0-9]{32}$/.test(value)))];
}

function sanitizeState(input) {
  const state = emptyDiscoveryState();
  if (!input || input.version !== 1) return state;
  state.frontier = Array.isArray(input.frontier) ? input.frontier : [];
  state.visited = Array.isArray(input.visited) ? input.visited : [];
  state.documents = Array.isArray(input.documents) ? input.documents : [];
  state.candidates = Array.isArray(input.candidates) ? input.candidates : [];
  state.researchStrategy = sanitizeResearchStrategyState(input.researchStrategy);
  state.calibrationSeen = sanitizeCalibrationSeen(input.calibrationSeen);
  state.wikidataBootstrap = sanitizeWikidataBootstrapState(input.wikidataBootstrap);
  state.wikidataSeriesExpansion = sanitizeWikidataSeriesExpansionState(input.wikidataSeriesExpansion);
  state.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : '';
  return state;
}

export function loadDiscoveryState(filePath) {
  if (!fs.existsSync(filePath)) return emptyDiscoveryState();
  const input = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return sanitizeState(input);
}

function sanitizeFacts(facts) {
  const output = {};
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return output;
  for (const [field, value] of Object.entries(facts)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const status = ['observed', 'confirmed', 'conflict'].includes(value.status) ? value.status : 'observed';
    output[String(field).slice(0, 80)] = {
      status,
      value: status === 'conflict' ? '' : String(value.value || '').slice(0, 2400),
      sourceCount: Math.max(0, Number(value.sourceCount || 0)),
      hostCount: Math.max(0, Number(value.hostCount || 0)),
      primarySourceCount: Math.max(0, Number(value.primarySourceCount || 0)),
      confidence: Math.max(0, Math.min(100, Number(value.confidence || 0))),
      trainingSamples: Math.max(0, Math.min(1_000_000_000, Number(value.trainingSamples || 0))),
      alternatives: Array.isArray(value.alternatives)
        ? value.alternatives.slice(0, 10).map((item) => ({
          value: String(item?.value || '').slice(0, 2400),
          sourceCount: Math.max(0, Number(item?.sourceCount || 0)),
          hostCount: Math.max(0, Number(item?.hostCount || 0)),
          primarySourceCount: Math.max(0, Number(item?.primarySourceCount || 0)),
          trustedSecondaryCount: Math.max(0, Number(item?.trustedSecondaryCount || 0)),
          credibility: Math.max(0, Math.min(100, Number(item?.credibility || 0))),
          maxCredibility: Math.max(0, Math.min(100, Number(item?.maxCredibility || 0))),
          evidenceCount: Math.max(0, Number(item?.evidenceCount || 0)),
          trainingSamples: Math.max(0, Math.min(1_000_000_000, Number(item?.trainingSamples || 0)))
        }))
        : []
    };
  }
  return output;
}

function sanitizeCandidateHints(values) {
  const source = Array.isArray(values) ? values : [];
  const output = [];
  const seen = new Set();
  for (const value of source) {
    const title = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(title);
    if (output.length >= MAX_CANDIDATE_HINTS) break;
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
      depth: Math.max(0, Number(raw?.depth || 0)),
      discoveredFrom: normalizeUrl(raw?.discoveredFrom) || '',
      candidateHints: sanitizeCandidateHints(raw?.candidateHints)
    };
    const current = byUrl.get(url);
    if (!current) {
      byUrl.set(url, clean);
      continue;
    }
    current.priority = Math.max(current.priority, clean.priority);
    current.depth = Math.min(current.depth, clean.depth);
    if (!current.discoveredFrom && clean.discoveredFrom) current.discoveredFrom = clean.discoveredFrom;
    current.candidateHints = sanitizeCandidateHints([...current.candidateHints, ...clean.candidateHints]);
  }
  return [...byUrl.values()].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
}

function deriveCandidateResearch(candidate, evidence, sources) {
  let research = sanitizeCandidateResearch(candidate?.research);
  const observedAt = String(candidate?.lastSeen || '');
  for (const sourceUrl of sources) {
    const pageEvidence = evidence.filter((item) => normalizeUrl(item?.sourceUrl) === sourceUrl);
    research = recordCandidateResearch(research, {
      url: sourceUrl,
      evidence: pageEvidence,
      observedAt
    });
  }
  return research;
}

export function saveDiscoveryState(filePath, state) {
  const clean = sanitizeState(state);
  clean.updatedAt = new Date().toISOString();
  clean.researchStrategy = sanitizeResearchStrategyState(clean.researchStrategy);
  clean.calibrationSeen = sanitizeCalibrationSeen(clean.calibrationSeen);
  clean.wikidataBootstrap = sanitizeWikidataBootstrapState(clean.wikidataBootstrap);
  clean.wikidataSeriesExpansion = sanitizeWikidataSeriesExpansionState(clean.wikidataSeriesExpansion);
  const trustModel = buildResearchStrategyModel(clean);

  clean.frontier = sanitizeFrontier(clean.frontier);
  clean.visited = [...new Set(clean.visited.map(String))];
  clean.documents = clean.documents
    .map((doc) => ({
      url: normalizeUrl(doc.url),
      title: String(doc.title || '').slice(0, 500),
      score: Number(doc.score || 0),
      candidateTitles: [...new Set((doc.candidateTitles || []).map(String))].slice(0, 30),
      discoveryOnly: Boolean(doc.discoveryOnly),
      lastChecked: String(doc.lastChecked || '')
    }))
    .filter((doc) => doc.url)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DOCUMENT_METADATA);
  clean.candidates = clean.candidates
    .map((candidate) => {
      const evidence = collapseSameFamilyEvidence(mergeEvidence(candidate.evidence || []));
      const resolved = resolveEvidenceWithTrust(evidence, trustModel);
      const sources = [...new Set((candidate.sources || []).map((value) => normalizeUrl(value)).filter(Boolean))].slice(0, 50);
      return {
        key: normalizeTitleKey(candidate.title || candidate.key),
        title: String(candidate.title || '').slice(0, 120),
        sources,
        evidence,
        facts: sanitizeFacts(resolved),
        series: sanitizeSeriesKnowledge(candidate.series),
        research: deriveCandidateResearch(candidate, evidence, sources),
        lastSeen: String(candidate.lastSeen || '')
      };
    })
    .filter((candidate) => candidate.key && candidate.title);

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
    state.frontier.push({ url, priority, depth: 0, discoveredFrom: '', candidateHints: [] });
    seen.add(url);
  }
}
