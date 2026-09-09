import fs from 'node:fs';
import path from 'node:path';
import { PoliteFetcher } from './fetch-page.mjs';
import { runDiscovery } from './engine.mjs';
import { loadDiscoveryState, saveDiscoveryState, seedFrontier } from './state.mjs';
import { normalizeUrl } from './url.mjs';

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
  const rawSeeds = [...readSeedFile(seedPath), ...readInputSeeds()];
  const seeds = [...new Set(rawSeeds.map((value) => normalizeUrl(value)).filter(Boolean))];
  seedFrontier(state, seeds, 100);

  if (state.frontier.length === 0) {
    throw new Error('探索開始URLがありません。crawler/seeds.txt または DISCOVERY_SEED_URLS に最低1件の公開Web URLが必要です。');
  }

  const fetcher = new PoliteFetcher({
    timeoutMs: process.env.DISCOVERY_TIMEOUT_MS || 12000,
    maxBytes: process.env.DISCOVERY_MAX_BYTES || 1048576,
    minDelayMs: process.env.DISCOVERY_MIN_DELAY_MS || 500,
    allowedHosts
  });

  const before = JSON.stringify(state);
  const result = await runDiscovery({ state, fetcher, maxPages, maxDepth, perHostLimit });

  if (!dryRun) saveDiscoveryState(statePath, result.state);
  const changed = before !== JSON.stringify(result.state);

  console.log('Web discovery engine: PASS');
  console.log(`mode: ${dryRun ? 'dry-run' : 'persist'}`);
  console.log(`state: ${path.relative(root, statePath)}`);
  console.log(`seed URLs: ${seeds.length}`);
  console.log(`allowed hosts: ${allowedHosts.length ? allowedHosts.join(',') : 'unrestricted-public-web'}`);
  console.log(`attempted: ${result.stats.attempted}`);
  console.log(`fetched: ${result.stats.fetched}`);
  console.log(`relevant pages: ${result.stats.relevant}`);
  console.log(`new anime candidates: ${result.stats.candidatesFound}`);
  console.log(`evidence claims: ${result.stats.evidenceClaims}`);
  console.log(`new links queued: ${result.stats.newLinks}`);
  console.log(`robots skipped: ${result.stats.robotsSkipped}`);
  console.log(`other skipped: ${result.stats.otherSkipped}`);
  console.log(`failed: ${result.stats.failed}`);
  console.log(`frontier remaining: ${result.state.frontier.length}`);
  console.log(`known candidates: ${result.state.candidates.length}`);
  console.log(`changed: ${changed}`);
  console.log('External search API: NONE');
  console.log('Gemini: DISCONNECTED');
}

main().catch((error) => {
  console.error(`Web discovery engine: FAIL\n${error.message}`);
  process.exit(1);
});
