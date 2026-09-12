import crypto from 'node:crypto';
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
import { sanitizeWebSearchIndex } from './web-search-index.mjs';
import { sanitizeWikidataBootstrapState } from './wikidata-bootstrap.mjs';
import { sanitizeWikidataSeriesExpansionState } from './wikidata-series-expansion.mjs';

const MAX_CANDIDATE_HINTS = 32;
const LEGACY_SHARDED_STATE_VERSION = 2;
const SHARDED_STATE_VERSION = 3;
const SHARDED_STATE_STORAGE = 'sharded-v1';
const SHARD_DIRECTORY = 'state-shards';
const TARGET_SHARD_BYTES = 4 * 1024 * 1024;
const LEGACY_STATE_ARRAY_SHARD_KINDS = ['frontier', 'visited', 'documents', 'candidates', 'calibrationSeen'];
const STATE_ARRAY_SHARD_KINDS = ['frontier', 'researchFrontier', 'visited', 'documents', 'candidates', 'webSearchIndex', 'calibrationSeen'];
const STRATEGY_SHARD_KINDS = ['researchOperations', 'researchTrust'];
const ALL_SHARD_KINDS = [...STATE_ARRAY_SHARD_KINDS, ...STRATEGY_SHARD_KINDS];

export function emptyDiscoveryState() {
  return {
    version: 1,
    frontier: [],
    researchFrontier: [],
    visited: [],
    documents: [],
    candidates: [],
    webSearchIndex: [],
    researchSearchCursor: 0,
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
  state.researchFrontier = Array.isArray(input.researchFrontier) ? input.researchFrontier : [];
  state.visited = Array.isArray(input.visited) ? input.visited : [];
  state.documents = Array.isArray(input.documents) ? input.documents : [];
  state.candidates = Array.isArray(input.candidates) ? input.candidates : [];
  state.webSearchIndex = sanitizeWebSearchIndex(input.webSearchIndex);
  state.researchSearchCursor = Math.max(0, Math.trunc(Number(input.researchSearchCursor || 0)));
  state.researchStrategy = sanitizeResearchStrategyState(input.researchStrategy);
  state.calibrationSeen = sanitizeCalibrationSeen(input.calibrationSeen);
  state.wikidataBootstrap = sanitizeWikidataBootstrapState(input.wikidataBootstrap);
  state.wikidataSeriesExpansion = sanitizeWikidataSeriesExpansionState(input.wikidataSeriesExpansion);
  state.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : '';
  return state;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function atomicWriteText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function revisionName() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `r-${stamp}-${crypto.randomBytes(6).toString('hex')}`;
}

function descriptorPath(kind, index) {
  return `${SHARD_DIRECTORY}/${kind}-${String(index).padStart(5, '0')}.json`;
}

function shardDescriptorsFor(kind, values, baseDir) {
  const source = Array.isArray(values) ? values : [];
  const descriptors = [];
  let jsonItems = [];
  let bytes = 2;

  const flush = () => {
    if (!jsonItems.length) return;
    const index = descriptors.length;
    const relative = descriptorPath(kind, index);
    const text = `[${jsonItems.join(',')}]\n`;
    const descriptor = {
      file: relative,
      count: jsonItems.length,
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(text)
    };
    atomicWriteText(path.join(baseDir, relative), text);
    descriptors.push(descriptor);
    jsonItems = [];
    bytes = 2;
  };

  for (const item of source) {
    const itemJson = JSON.stringify(item);
    if (itemJson === undefined) continue;
    const itemBytes = Buffer.byteLength(itemJson, 'utf8');
    const projected = bytes + itemBytes + (jsonItems.length ? 1 : 0) + 1;
    if (jsonItems.length && projected > TARGET_SHARD_BYTES) flush();
    jsonItems.push(itemJson);
    bytes += itemBytes + (jsonItems.length > 1 ? 1 : 0);
  }
  flush();
  return descriptors;
}

function validateShardDescriptor(kind, descriptor, index) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new Error(`state-shard-descriptor-invalid:${kind}:${index}`);
  }
  const expectedFile = descriptorPath(kind, index);
  if (descriptor.file !== expectedFile) throw new Error(`state-shard-path-invalid:${kind}:${index}`);
  if (!Number.isInteger(descriptor.count) || descriptor.count < 0) throw new Error(`state-shard-count-invalid:${kind}:${index}`);
  if (!Number.isInteger(descriptor.bytes) || descriptor.bytes < 3) throw new Error(`state-shard-bytes-invalid:${kind}:${index}`);
  if (!/^[a-f0-9]{64}$/.test(String(descriptor.sha256 || ''))) throw new Error(`state-shard-hash-invalid:${kind}:${index}`);
}

function readShardKind(baseDir, kind, descriptors, expectedCount) {
  if (!Array.isArray(descriptors)) throw new Error(`state-shard-list-invalid:${kind}`);
  const output = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    validateShardDescriptor(kind, descriptor, index);
    const absolute = path.resolve(baseDir, descriptor.file);
    const shardRoot = `${path.resolve(baseDir, SHARD_DIRECTORY)}${path.sep}`;
    if (!absolute.startsWith(shardRoot)) throw new Error(`state-shard-path-escape:${kind}:${index}`);
    if (!fs.existsSync(absolute)) throw new Error(`state-shard-missing:${kind}:${index}`);
    const text = fs.readFileSync(absolute, 'utf8');
    if (Buffer.byteLength(text, 'utf8') !== descriptor.bytes) throw new Error(`state-shard-size-mismatch:${kind}:${index}`);
    if (sha256(text) !== descriptor.sha256) throw new Error(`state-shard-hash-mismatch:${kind}:${index}`);
    const values = JSON.parse(text);
    if (!Array.isArray(values) || values.length !== descriptor.count) throw new Error(`state-shard-content-mismatch:${kind}:${index}`);
    output.push(...values);
  }
  if (Number.isInteger(expectedCount) && output.length !== expectedCount) {
    throw new Error(`state-shard-total-count-mismatch:${kind}`);
  }
  return output;
}

function entriesToRecord(entries, kind) {
  const output = Object.create(null);
  const seen = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const pair = entries[index];
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`state-shard-entry-invalid:${kind}:${index}`);
    const key = String(pair[0] || '');
    if (!key || seen.has(key)) throw new Error(`state-shard-entry-key-invalid:${kind}:${index}`);
    seen.add(key);
    output[key] = pair[1];
  }
  return output;
}

function loadShardedState(filePath, manifest) {
  if (manifest.storage !== SHARDED_STATE_STORAGE || ![LEGACY_SHARDED_STATE_VERSION, SHARDED_STATE_VERSION].includes(manifest.version)) {
    throw new Error('discovery-state-storage-unsupported');
  }
  const baseDir = path.dirname(filePath);
  const revision = String(manifest.revision || '');
  if (!/^r-\d{14}-[a-f0-9]{12}$/.test(revision)) throw new Error('discovery-state-revision-invalid');
  const shards = manifest.shards;
  const counts = manifest.counts;
  if (!shards || typeof shards !== 'object' || Array.isArray(shards)) throw new Error('discovery-state-shards-missing');
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new Error('discovery-state-counts-missing');
  const reconstructed = {
    version: 1,
    researchFrontier: [],
    webSearchIndex: [],
    researchSearchCursor: manifest.version === SHARDED_STATE_VERSION
      ? Math.max(0, Math.trunc(Number(manifest.researchSearchCursor || 0)))
      : 0,
    researchStrategy: {
      version: 1,
      operations: {},
      trust: {},
      updatedAt: String(manifest.researchStrategy?.updatedAt || '').slice(0, 40)
    },
    wikidataBootstrap: manifest.wikidataBootstrap,
    wikidataSeriesExpansion: manifest.wikidataSeriesExpansion,
    updatedAt: manifest.updatedAt
  };
  const arrayKinds = manifest.version === LEGACY_SHARDED_STATE_VERSION
    ? LEGACY_STATE_ARRAY_SHARD_KINDS
    : STATE_ARRAY_SHARD_KINDS;
  for (const kind of arrayKinds) {
    reconstructed[kind] = readShardKind(baseDir, kind, shards[kind], counts[kind]);
  }
  const operationEntries = readShardKind(baseDir, 'researchOperations', shards.researchOperations, counts.researchOperations);
  const trustEntries = readShardKind(baseDir, 'researchTrust', shards.researchTrust, counts.researchTrust);
  reconstructed.researchStrategy.operations = entriesToRecord(operationEntries, 'researchOperations');
  reconstructed.researchStrategy.trust = entriesToRecord(trustEntries, 'researchTrust');
  return sanitizeState(reconstructed);
}

export function loadDiscoveryState(filePath) {
  if (!fs.existsSync(filePath)) return emptyDiscoveryState();
  const input = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if ([LEGACY_SHARDED_STATE_VERSION, SHARDED_STATE_VERSION].includes(input?.version)) return loadShardedState(filePath, input);
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
    research = recordCandidateResearch(research, { url: sourceUrl, evidence: pageEvidence, observedAt });
  }
  return research;
}

function sanitizeDocuments(values) {
  return (Array.isArray(values) ? values : [])
    .map((doc) => ({
      url: normalizeUrl(doc?.url),
      title: String(doc?.title || '').slice(0, 500),
      score: Number(doc?.score || 0),
      candidateTitles: [...new Set((doc?.candidateTitles || []).map(String))].slice(0, 30),
      discoveryOnly: Boolean(doc?.discoveryOnly),
      lastChecked: String(doc?.lastChecked || '')
    }))
    .filter((doc) => doc.url)
    .sort((a, b) => b.score - a.score);
}

function sanitizeCandidates(values, trustModel) {
  return (Array.isArray(values) ? values : [])
    .map((candidate) => {
      const evidence = collapseSameFamilyEvidence(mergeEvidence(candidate?.evidence || []));
      const resolved = resolveEvidenceWithTrust(evidence, trustModel);
      const sources = [...new Set((candidate?.sources || []).map((value) => normalizeUrl(value)).filter(Boolean))].slice(0, 50);
      return {
        key: normalizeTitleKey(candidate?.title || candidate?.key),
        title: String(candidate?.title || '').slice(0, 120),
        sources,
        evidence,
        facts: sanitizeFacts(resolved),
        series: sanitizeSeriesKnowledge(candidate?.series),
        research: deriveCandidateResearch(candidate, evidence, sources),
        lastSeen: String(candidate?.lastSeen || '')
      };
    })
    .filter((candidate) => candidate.key && candidate.title);
}

function cleanStaleShardFiles(baseDir, activeFiles) {
  const shardDir = path.join(baseDir, SHARD_DIRECTORY);
  if (!fs.existsSync(shardDir)) return;
  const active = new Set(activeFiles);
  for (const name of fs.readdirSync(shardDir)) {
    if (!/^(?:frontier|researchFrontier|visited|documents|candidates|webSearchIndex|calibrationSeen|researchOperations|researchTrust)-\d{5}\.json$/.test(name)) continue;
    const relative = `${SHARD_DIRECTORY}/${name}`;
    if (!active.has(relative)) fs.rmSync(path.join(shardDir, name), { force: true });
  }
}

function writeShardedState(filePath, clean) {
  const baseDir = path.dirname(filePath);
  fs.mkdirSync(baseDir, { recursive: true });
  const revision = revisionName();
  const shards = {};
  const counts = {};
  for (const kind of STATE_ARRAY_SHARD_KINDS) {
    counts[kind] = Array.isArray(clean[kind]) ? clean[kind].length : 0;
    shards[kind] = shardDescriptorsFor(kind, clean[kind], baseDir);
  }

  const strategyArrays = {
    researchOperations: Object.entries(clean.researchStrategy?.operations || {}),
    researchTrust: Object.entries(clean.researchStrategy?.trust || {})
  };
  for (const kind of STRATEGY_SHARD_KINDS) {
    counts[kind] = strategyArrays[kind].length;
    shards[kind] = shardDescriptorsFor(kind, strategyArrays[kind], baseDir);
  }

  for (const kind of ALL_SHARD_KINDS) {
    if (!Array.isArray(shards[kind])) throw new Error(`state-shard-write-missing:${kind}`);
  }

  const manifest = {
    version: SHARDED_STATE_VERSION,
    storage: SHARDED_STATE_STORAGE,
    revision,
    shardTargetBytes: TARGET_SHARD_BYTES,
    counts,
    shards,
    researchSearchCursor: Math.max(0, Math.trunc(Number(clean.researchSearchCursor || 0))),
    researchStrategy: {
      version: 1,
      updatedAt: String(clean.researchStrategy?.updatedAt || '').slice(0, 40)
    },
    wikidataBootstrap: clean.wikidataBootstrap,
    wikidataSeriesExpansion: clean.wikidataSeriesExpansion,
    updatedAt: clean.updatedAt
  };

  atomicWriteText(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  loadShardedState(filePath, manifest);
  const activeFiles = Object.values(shards).flat().map((descriptor) => descriptor.file);
  cleanStaleShardFiles(baseDir, activeFiles);
  return manifest;
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
  clean.researchFrontier = sanitizeFrontier(clean.researchFrontier);
  clean.visited = [...new Set(clean.visited.map(String))];
  clean.documents = sanitizeDocuments(clean.documents);
  clean.candidates = sanitizeCandidates(clean.candidates, trustModel);
  clean.webSearchIndex = sanitizeWebSearchIndex(clean.webSearchIndex);
  clean.researchSearchCursor = Math.max(0, Math.trunc(Number(clean.researchSearchCursor || 0)));
  return writeShardedState(filePath, clean);
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
