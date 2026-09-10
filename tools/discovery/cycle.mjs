import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadColumns, readDataRecords } from '../csv/csv.mjs';
import { deduplicateIncoming } from '../collect/deduplicate.mjs';
import { loadDiscoveryState } from './state.mjs';
import { candidateToCommonRecord, discoveryCandidateReadiness } from './to-record.mjs';

export const RESEARCH_INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000;
const MAX_SEEN = 20000;

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

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function emptyResearchCycle() {
  return {
    version: 1,
    active: false,
    cycleId: '',
    startedAt: '',
    lastNewDiscoveryAt: '',
    stoppedAt: '',
    stopReason: '',
    seenEligible: []
  };
}

export function loadResearchCycle(filePath) {
  if (!fs.existsSync(filePath)) return emptyResearchCycle();
  const input = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!input || input.version !== 1) throw new Error('research-cycle-state-invalid');
  return {
    version: 1,
    active: Boolean(input.active),
    cycleId: String(input.cycleId || '').slice(0, 80),
    startedAt: validIso(input.startedAt) ? input.startedAt : '',
    lastNewDiscoveryAt: validIso(input.lastNewDiscoveryAt) ? input.lastNewDiscoveryAt : '',
    stoppedAt: validIso(input.stoppedAt) ? input.stoppedAt : '',
    stopReason: String(input.stopReason || '').slice(0, 80),
    seenEligible: [...new Set((Array.isArray(input.seenEligible) ? input.seenEligible : [])
      .map(String)
      .filter((value) => /^[a-f0-9]{64}$/.test(value)))]
      .slice(-MAX_SEEN)
  };
}

export function saveResearchCycle(filePath, cycle) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(cycle, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function candidateFingerprint(candidate) {
  return crypto.createHash('sha256').update(`candidate:${String(candidate?.key || '')}`).digest('hex');
}

export function eligibleDiscoveryRecords({ root = process.cwd(), now = new Date() } = {}) {
  const columns = loadColumns(root);
  const state = loadDiscoveryState(path.join(root, 'crawler', 'state.json'));
  const existing = readDataRecords(path.join(root, 'data'), columns);
  const accepted = [];
  const fingerprints = [];
  for (const candidate of state.candidates) {
    if (!discoveryCandidateReadiness(candidate).ready) continue;
    const record = candidateToCommonRecord(candidate, columns, now.toISOString().slice(0, 10));
    const known = [...existing, ...accepted.map((item) => ({ fileName: 'pending', record: item }))];
    const result = deduplicateIncoming([record], known, columns, { warn: () => {} });
    if (!result.accepted.length) continue;
    accepted.push(result.accepted[0]);
    fingerprints.push(candidateFingerprint(candidate));
  }
  return {
    records: accepted,
    fingerprints,
    frontier: state.frontier.length
  };
}

export function startResearchCycle(fingerprints, now = new Date()) {
  const iso = now.toISOString();
  return {
    version: 1,
    active: true,
    cycleId: iso.replace(/[-:.]/g, '').replace('Z', 'Z'),
    startedAt: iso,
    lastNewDiscoveryAt: iso,
    stoppedAt: '',
    stopReason: '',
    seenEligible: [...new Set(fingerprints)].slice(-MAX_SEEN)
  };
}

export function checkpointResearchCycle(cycle, fingerprints, { now = new Date(), frontier = 1 } = {}) {
  if (!cycle.active) return { cycle, newConfirmed: 0, inactiveMs: 0 };
  const seen = new Set(cycle.seenEligible);
  const additions = [...new Set(fingerprints)].filter((value) => !seen.has(value));
  for (const value of additions) seen.add(value);
  const next = {
    ...cycle,
    seenEligible: [...seen].slice(-MAX_SEEN)
  };
  if (additions.length) next.lastNewDiscoveryAt = now.toISOString();
  const inactiveMs = Math.max(0, now.getTime() - Date.parse(next.lastNewDiscoveryAt || next.startedAt));
  if (frontier === 0) {
    next.active = false;
    next.stoppedAt = now.toISOString();
    next.stopReason = 'frontier-empty';
  } else if (inactiveMs >= RESEARCH_INACTIVITY_LIMIT_MS) {
    next.active = false;
    next.stoppedAt = now.toISOString();
    next.stopReason = 'no-new-confirmed-work-24h';
  }
  return { cycle: next, newConfirmed: additions.length, inactiveMs };
}

function setGithubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`, 'utf8');
}

async function main() {
  const [command = 'status', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const root = process.cwd();
  const filePath = path.resolve(root, String(args.state || 'crawler/research-cycle.json'));
  const now = args.now ? new Date(String(args.now)) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('--now must be an ISO date');
  let cycle = loadResearchCycle(filePath);
  let newConfirmed = 0;
  let inactiveMs = 0;

  if (command === 'start') {
    const eligible = eligibleDiscoveryRecords({ root, now });
    cycle = startResearchCycle(eligible.fingerprints, now);
    saveResearchCycle(filePath, cycle);
  } else if (command === 'checkpoint') {
    const eligible = eligibleDiscoveryRecords({ root, now });
    const result = checkpointResearchCycle(cycle, eligible.fingerprints, { now, frontier: eligible.frontier });
    cycle = result.cycle;
    newConfirmed = result.newConfirmed;
    inactiveMs = result.inactiveMs;
    saveResearchCycle(filePath, cycle);
  } else if (command === 'stop') {
    cycle.active = false;
    cycle.stoppedAt = now.toISOString();
    cycle.stopReason = String(args.reason || 'manual-stop').slice(0, 80);
    saveResearchCycle(filePath, cycle);
  } else if (command !== 'status') {
    throw new Error('cycle command must be start, checkpoint, stop, or status');
  }

  setGithubOutput('active', cycle.active ? 'true' : 'false');
  setGithubOutput('new_confirmed', newConfirmed);
  setGithubOutput('inactive_seconds', Math.floor(inactiveMs / 1000));
  setGithubOutput('stop_reason', cycle.stopReason);
  console.log(JSON.stringify({ ...cycle, newConfirmed, inactiveSeconds: Math.floor(inactiveMs / 1000) }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Research cycle: FAIL\n${error.message}`);
    process.exit(1);
  });
}
