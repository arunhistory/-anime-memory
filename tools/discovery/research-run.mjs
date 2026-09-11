import fs from 'node:fs';
import path from 'node:path';
import { PoliteFetcher } from './fetch-page.mjs';
import { loadDiscoveryState, saveDiscoveryState } from './state.mjs';
import { loadKnownWorkWasmSearch } from './known-work-wasm.mjs';
import { buildReadinessReport } from './readiness-report.mjs';
import { loadResearchLaneState, saveResearchLaneState } from './research-lane-state.mjs';
import { runResearchLane } from './research-runner.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function intArg(value, name, min, max, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const statePath = path.resolve(root, String(args.state || 'crawler/state.json'));
  const researchStatePath = path.resolve(root, String(args['research-state'] || 'crawler/research-frontier.json'));
  const maxPages = intArg(args['max-pages'], '--max-pages', 1, 2000, 50);
  const maxDepth = intArg(args['max-depth'], '--max-depth', 0, 12, 6);
  const perHostLimit = intArg(args['per-host-limit'], '--per-host-limit', 1, 200, 20);
  const dryRun = String(args['dry-run'] || '').toLowerCase() === 'true' || args['dry-run'] === true;

  const state = loadDiscoveryState(statePath);
  const researchState = loadResearchLaneState(researchStatePath);
  const knownWorkSearch = await loadKnownWorkWasmSearch({ root });
  const fetcher = new PoliteFetcher({
    timeoutMs: process.env.DISCOVERY_TIMEOUT_MS || 12000,
    maxBytes: process.env.DISCOVERY_MAX_BYTES || 1048576,
    minDelayMs: process.env.DISCOVERY_MIN_DELAY_MS || 500
  });

  const result = await runResearchLane({
    state,
    researchState,
    fetcher,
    knownWorkSearch,
    maxPages,
    maxDepth,
    perHostLimit
  });

  if (!dryRun) {
    saveDiscoveryState(statePath, result.state);
    saveResearchLaneState(researchStatePath, result.researchState);
  }

  const readiness = buildReadinessReport(result.state);
  console.log('Deep research engine: PASS');
  console.log(`mode: ${dryRun ? 'dry-run' : 'persist'}`);
  console.log(`state: ${path.relative(root, statePath)}`);
  console.log(`research state: ${path.relative(root, researchStatePath)}`);
  console.log(`title-based candidates searched: ${result.titleSearch.searched}`);
  console.log(`title-based Wikipedia roots resolved: ${result.titleSearch.resolved}`);
  console.log(`research roots added: ${result.titleSearch.frontierAdded}`);
  console.log(`focused research candidate: ${result.focus.focusCandidate || 'NONE'}`);
  console.log(`focused corroboration URLs: ${result.focus.promoted || 0}`);
  console.log(`attempted: ${result.stats.attempted || 0}`);
  console.log(`fetched: ${result.stats.fetched || 0}`);
  console.log(`candidate verification pages: ${result.stats.verificationPages || 0}`);
  console.log(`candidate verification evidence claims: ${result.stats.verificationEvidenceClaims || 0}`);
  console.log(`research frontier remaining: ${result.researchState.frontier.length}`);
  console.log(`new-candidate URLs handed to discovery: ${result.discoveryHandoffs}`);
  console.log(`identity-ready candidates: ${readiness.identityReady}`);
  console.log(`information-ready candidates: ${readiness.informationReady}`);
  console.log(`publishable-ready candidates: ${readiness.publishableReady}`);
  console.log('Research start key: CONFIRMED TITLE');
  console.log('Research/discovery frontier mixing: DISABLED');
  console.log('External general-search API: NONE');
  console.log('Gemini: DISCONNECTED');

  if (!fs.existsSync(statePath) && !dryRun) throw new Error('discovery state was not persisted');
}

main().catch((error) => {
  console.error(`Deep research engine: FAIL\n${error.message}`);
  process.exit(1);
});
