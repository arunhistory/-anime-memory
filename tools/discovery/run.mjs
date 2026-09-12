import fs from 'node:fs';
import path from 'node:path';
import { PoliteFetcher } from './fetch-page.mjs';
import { runDiscovery } from './engine.mjs';
import { loadDiscoveryState, saveDiscoveryState, seedFrontier } from './state.mjs';
import { loadKnownWorkWasmSearch } from './known-work-wasm.mjs';
import { normalizeUrl } from './url.mjs';
import { bootstrapFromWikidata } from './wikidata-bootstrap.mjs';
import { expandSeriesFromWikidata } from './wikidata-series-expansion.mjs';
import { buildReadinessReport } from './readiness-report.mjs';
import { prepareResearchFrontierFromOwnIndex } from './research-search.mjs';
import { refreshWebSearchIndexFromDocuments } from './web-search-index.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readSeedFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line && !line.startsWith('#'));
}

function readInputSeeds() {
  return String(process.env.DISCOVERY_SEED_URLS || '')
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readAllowedHosts() {
  return String(process.env.DISCOVERY_ALLOWED_HOSTS || '')
    .split(/[\s,]+/)
    .map((value) => value.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

function validateNumber(value, name, min, max, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

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

function promoteResearchFrontier(state) {
  if (!Array.isArray(state.frontier)) state.frontier = [];
  if (!Array.isArray(state.researchFrontier)) state.researchFrontier = [];
  const byUrl = new Map(state.frontier.map((entry) => [normalizeUrl(entry?.url), entry]).filter(([url]) => url));
  let promoted = 0;
  for (const researchEntry of state.researchFrontier) {
    const url = normalizeUrl(researchEntry?.url);
    if (!url) continue;
    const current = byUrl.get(url);
    if (current) {
      current.priority = Math.max(Number(current.priority || 0), Number(researchEntry.priority || 0));
      current.candidateHints = mergeHints(current.candidateHints, researchEntry.candidateHints);
      current.researchSearch = true;
      continue;
    }
    const entry = { ...researchEntry, url, researchSearch: true };
    state.frontier.push(entry);
    byUrl.set(url, entry);
    promoted += 1;
  }
  state.researchFrontier = [];
  return promoted;
}

function restoreUnprocessedResearchFrontier(state) {
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

function emptyDiscoveryStats() {
  return {
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
    informationPriorityLinks: 0,
    seriesPriorityLinks: 0,
    seriesShellCandidates: 0,
    newLinks: 0,
    robotsSkipped: 0,
    otherSkipped: 0,
    hostFiltered: 0,
    failed: 0,
    sitemapLinks: 0,
    knownWorkCandidatesSeen: 0,
    knownWorkEvidenceReused: 0,
    knownStateCandidatesRetained: 0,
    knownWorkCandidatesSkipped: 0,
    knownStateCandidatesPruned: 0,
    frontierPriorityGroups: 0,
    frontierPriorityGroupEvaluations: 0
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const statePath = path.resolve(root, String(args.state || 'crawler/state.json'));
  const seedPath = path.resolve(root, String(args.seeds || 'crawler/seeds.txt'));
  const maxPages = validateNumber(args['max-pages'], '--max-pages', 1, 2000, 200);
  const maxDepth = validateNumber(args['max-depth'], '--max-depth', 0, 12, 5);
  const perHostLimit = validateNumber(args['per-host-limit'], '--per-host-limit', 1, 200, 40);
  const dryRun = String(args['dry-run'] || '').toLowerCase() === 'true' || args['dry-run'] === true;
  const allowedHosts = readAllowedHosts();

  const state = loadDiscoveryState(statePath);
  state.webSearchIndex = refreshWebSearchIndexFromDocuments(state.webSearchIndex, state.documents);
  const before = JSON.stringify(state);
  let wikidata = {
    fetched: 0,
    candidatesAdded: 0,
    evidenceAdded: 0,
    officialFrontierAdded: 0,
    seriesFrontierAdded: 0,
    completed: Boolean(state.wikidataBootstrap?.completed),
    offset: state.wikidataBootstrap?.offset || 0
  };
  if (String(process.env.WIKIDATA_BOOTSTRAP_DISABLED || '').toLowerCase() !== 'true') {
    try {
      wikidata = await bootstrapFromWikidata(state, {
        limit: validateNumber(process.env.WIKIDATA_BOOTSTRAP_LIMIT, 'WIKIDATA_BOOTSTRAP_LIMIT', 1, 500, 200)
      });
    } catch (error) {
      console.warn(`Wikidata bootstrap deferred: ${error.message}`);
    }
  }

  let seriesExpansion = {
    seriesRequested: 0,
    rows: 0,
    seriesExpanded: 0,
    candidatesAdded: 0,
    evidenceAdded: 0,
    officialFrontierAdded: 0,
    memberCount: 0
  };
  if (String(process.env.WIKIDATA_SERIES_EXPANSION_DISABLED || '').toLowerCase() !== 'true') {
    try {
      seriesExpansion = await expandSeriesFromWikidata(state, {
        limit: validateNumber(process.env.WIKIDATA_SERIES_EXPANSION_LIMIT, 'WIKIDATA_SERIES_EXPANSION_LIMIT', 1, 50, 12)
      });
    } catch (error) {
      console.warn(`Wikidata full-series expansion deferred: ${error.message}`);
    }
  }

  const rawSeeds = [...readSeedFile(seedPath), ...readInputSeeds()];
  const seeds = [...new Set(rawSeeds.map((value) => normalizeUrl(value)).filter(Boolean))];
  seedFrontier(state, seeds, 100);

  const ownSearch = prepareResearchFrontierFromOwnIndex(state, {
    maxCandidates: validateNumber(process.env.RESEARCH_SEARCH_MAX_CANDIDATES, 'RESEARCH_SEARCH_MAX_CANDIDATES', 1, 200000, 5000),
    maxQueriesPerCandidate: validateNumber(process.env.RESEARCH_SEARCH_MAX_QUERIES, 'RESEARCH_SEARCH_MAX_QUERIES', 1, 64, 12),
    resultsPerQuery: validateNumber(process.env.RESEARCH_SEARCH_RESULTS_PER_QUERY, 'RESEARCH_SEARCH_RESULTS_PER_QUERY', 1, 100, 20)
  });
  const promotedResearchUrls = promoteResearchFrontier(state);

  let knownWorkSearch = { fileCount: 0 };
  let result = { state, stats: emptyDiscoveryStats() };
  if (state.frontier.length > 0) {
    knownWorkSearch = await loadKnownWorkWasmSearch({ root });
    const fetcher = new PoliteFetcher({
      timeoutMs: process.env.DISCOVERY_TIMEOUT_MS || 12000,
      maxBytes: process.env.DISCOVERY_MAX_BYTES || 1048576,
      minDelayMs: process.env.DISCOVERY_MIN_DELAY_MS || 500,
      allowedHosts
    });

    result = await runDiscovery({
      state,
      fetcher,
      knownWorkSearch,
      maxPages,
      maxDepth,
      perHostLimit
    });
  }

  result.state.webSearchIndex = refreshWebSearchIndexFromDocuments(result.state.webSearchIndex, result.state.documents);
  const researchFrontierRemaining = restoreUnprocessedResearchFrontier(result.state);
  if (!dryRun) saveDiscoveryState(statePath, result.state);
  const changed = before !== JSON.stringify(result.state);
  const readiness = buildReadinessReport(result.state);

  console.log('Web discovery engine: PASS');
  console.log(`mode: ${dryRun ? 'dry-run' : 'persist'}`);
  console.log(`state: ${path.relative(root, statePath)}`);
  console.log(`seed URLs: ${seeds.length}`);
  console.log(`allowed hosts: ${allowedHosts.length ? allowedHosts.join(',') : 'unrestricted-public-web'}`);
  console.log(`registered CSV files loaded into search.wasm: ${knownWorkSearch.fileCount}`);
  console.log(`own web-search index pages: ${result.state.webSearchIndex.length}`);
  console.log(`own deep-search candidates considered: ${ownSearch.candidatesConsidered}`);
  console.log(`own deep-search queries executed: ${ownSearch.searches}`);
  console.log(`own deep-search URLs queued: ${ownSearch.urlsQueued}`);
  console.log(`own deep-search URLs promoted this batch: ${promotedResearchUrls}`);
  console.log(`own deep-search frontier remaining: ${researchFrontierRemaining}`);
  console.log(`Wikidata bootstrap rows: ${wikidata.fetched}`);
  console.log(`Wikidata bootstrap candidates added: ${wikidata.candidatesAdded}`);
  console.log(`Wikidata bootstrap evidence added: ${wikidata.evidenceAdded}`);
  console.log(`Wikidata official verification URLs added: ${wikidata.officialFrontierAdded}`);
  console.log(`Wikidata series verification URLs added: ${wikidata.seriesFrontierAdded || 0}`);
  console.log(`Wikidata bootstrap offset: ${wikidata.offset}`);
  console.log(`Wikidata bootstrap completed: ${wikidata.completed}`);
  console.log(`Wikidata full-series requests: ${seriesExpansion.seriesRequested}`);
  console.log(`Wikidata full-series rows: ${seriesExpansion.rows}`);
  console.log(`Wikidata full-series expanded: ${seriesExpansion.seriesExpanded}`);
  console.log(`Wikidata full-series members learned: ${seriesExpansion.memberCount}`);
  console.log(`Wikidata full-series candidates added: ${seriesExpansion.candidatesAdded}`);
  console.log(`Wikidata full-series official URLs added: ${seriesExpansion.officialFrontierAdded}`);
  console.log(`attempted: ${result.stats.attempted}`);
  console.log(`fetched: ${result.stats.fetched}`);
  console.log(`relevant pages: ${result.stats.relevant}`);
  console.log(`discovery-only pages: ${result.stats.discoveryOnlyPages}`);
  console.log(`new anime candidates: ${result.stats.candidatesFound}`);
  console.log(`registered-work candidates seen: ${result.stats.knownWorkCandidatesSeen}`);
  console.log(`registered-work evidence reused: ${result.stats.knownWorkEvidenceReused}`);
  console.log(`registered candidates retained for enrichment: ${result.stats.knownStateCandidatesRetained}`);
  console.log(`series member shells added: ${result.stats.seriesShellCandidates}`);
  console.log(`series-priority links detected: ${result.stats.seriesPriorityLinks}`);
  console.log(`missing-information priority links: ${result.stats.informationPriorityLinks}`);
  console.log(`frontier priority groups: ${result.stats.frontierPriorityGroups}`);
  console.log(`frontier group-head evaluations: ${result.stats.frontierPriorityGroupEvaluations}`);
  console.log(`entity merges: ${result.stats.entityMerges}`);
  console.log(`evidence claims: ${result.stats.evidenceClaims}`);
  console.log(`candidate verification pages: ${result.stats.verificationPages}`);
  console.log(`candidate verification evidence claims: ${result.stats.verificationEvidenceClaims}`);
  console.log(`candidate verification links promoted: ${result.stats.verificationLinksPromoted}`);
  console.log(`new links queued: ${result.stats.newLinks}`);
  console.log(`host-filtered deferred: ${result.stats.hostFiltered}`);
  console.log(`robots skipped: ${result.stats.robotsSkipped}`);
  console.log(`other skipped: ${result.stats.otherSkipped}`);
  console.log(`failed: ${result.stats.failed}`);
  console.log(`frontier remaining: ${result.state.frontier.length}`);
  console.log(`known candidates: ${result.state.candidates.length}`);
  console.log(`identity-ready candidates: ${readiness.identityReady} (${readiness.identityReadyRate})`);
  console.log(`information-ready candidates: ${readiness.informationReady}`);
  console.log(`publishable-ready candidates: ${readiness.publishableReady} (${readiness.publishableReadyRate})`);
  console.log(`average confirmed information fields: ${readiness.averageConfirmedInformationFields}`);
  console.log(`series-learned candidates: ${readiness.seriesLearned} (${readiness.seriesLearnedRate})`);
  console.log(`identity blocked reasons: ${JSON.stringify(readiness.identityBlockedReasons)}`);
  console.log(`publication blocked reasons: ${JSON.stringify(readiness.publicationBlockedReasons)}`);
  console.log(`changed: ${changed}`);
  if (result.stats.attempted === 0) console.log('Web frontier empty: bootstrap/series/search-index progress persisted without treating this batch as an error');
  console.log('Existing-work lookup: search.wasm + enrichment reuse');
  console.log('Series-first research: FULL-SERIES PRE-EXPANSION ENABLED');
  console.log('Web deep-search engine: BUILT-IN CRAWL INDEX (NO EXTERNAL SEARCH API)');
  console.log('Gemini: DISCONNECTED');
}

main().catch((error) => {
  console.error(`Web discovery engine: FAIL\n${error.message}`);
  process.exit(1);
});
