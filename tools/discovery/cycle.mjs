import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadColumns, readDataRecords } from '../csv/csv.mjs';
import { externalIdSet } from '../normalize/record.mjs';
import { loadDiscoveryState } from './state.mjs';
import { publishableDiscoveryReadiness } from './to-record.mjs';
import { discoveryExternalIdForKey } from './series-record.mjs';
import { pendingWikidataSeriesRefs } from './wikidata-series-expansion.mjs';

export const RESEARCH_INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000;

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

function inactivityMs(cycle, now) {
  const anchor = cycle.lastNewDiscoveryAt || cycle.startedAt;
  if (!validIso(anchor)) return 0;
  return Math.max(0, now.getTime() - Date.parse(anchor));
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
    waitingForInactivity: false,
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
    waitingForInactivity: Boolean(input.waitingForInactivity),
    seenEligible: [...new Set((Array.isArray(input.seenEligible) ? input.seenEligible : [])
      .map(String)
      .filter((value) => /^[a-f0-9]{64}$/.test(value)))]
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

export function publishableCandidateFingerprints(state, registeredDiscoveryIds = new Set()) {
  const fingerprints = [];
  const expandedSeriesRefs = state?.wikidataSeriesExpansion?.expandedRefs || [];
  for (const candidate of state?.candidates || []) {
    if (!publishableDiscoveryReadiness(candidate, { expandedSeriesRefs }).ready) continue;
    const discoveryId = discoveryExternalIdForKey(candidate?.key);
    if (discoveryId && registeredDiscoveryIds.has(discoveryId)) continue;
    fingerprints.push(candidateFingerprint(candidate));
  }
  return [...new Set(fingerprints)];
}

export function eligibleDiscoveryRecords({ root = process.cwd() } = {}) {
  const columns = loadColumns(root);
  const state = loadDiscoveryState(path.join(root, 'crawler', 'state.json'));
  const existing = readDataRecords(path.join(root, 'data'), columns);
  const registeredDiscoveryIds = new Set();
  for (const { record } of existing) {
    for (const externalId of externalIdSet(record)) {
      if (/^discovery-key::[a-f0-9]{64}$/.test(externalId)) registeredDiscoveryIds.add(externalId);
    }
  }

  return {
    fingerprints: publishableCandidateFingerprints(state, registeredDiscoveryIds),
    frontier: state.frontier.length,
    bootstrapIncomplete: !Boolean(state.wikidataBootstrap?.completed),
    pendingSeries: pendingWikidataSeriesRefs(state).length
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
    waitingForInactivity: false,
    seenEligible: [...new Set(fingerprints)]
  };
}

export function checkpointResearchCycle(cycle, fingerprints, {
  now = new Date(),
  frontier = 1,
  bootstrapIncomplete = false,
  pendingSeries = 0
} = {}) {
  const workRemaining = frontier > 0 || Boolean(bootstrapIncomplete) || Number(pendingSeries || 0) > 0;
  if (!cycle.active) return { cycle, newConfirmed: 0, inactiveMs: 0, workRemaining };

  const seen = new Set(cycle.seenEligible);
  const additions = [...new Set(fingerprints)].filter((value) => !seen.has(value));
  for (const value of additions) seen.add(value);
  const next = {
    ...cycle,
    waitingForInactivity: !workRemaining,
    seenEligible: [...seen]
  };
  if (additions.length) next.lastNewDiscoveryAt = now.toISOString();
  const inactiveMs = inactivityMs(next, now);

  if (inactiveMs >= RESEARCH_INACTIVITY_LIMIT_MS) {
    next.active = false;
    next.stoppedAt = now.toISOString();
    next.stopReason = 'no-new-publishable-work-24h';
    next.waitingForInactivity = false;
  }
  return { cycle: next, newConfirmed: additions.length, inactiveMs, workRemaining };
}

export function timeoutResearchCycle(cycle, { now = new Date() } = {}) {
  if (!cycle.active || !cycle.waitingForInactivity) {
    return { cycle, inactiveMs: inactivityMs(cycle, now), stopped: false };
  }
  const inactiveMs = inactivityMs(cycle, now);
  if (inactiveMs < RESEARCH_INACTIVITY_LIMIT_MS) {
    return { cycle, inactiveMs, stopped: false };
  }
  const next = {
    ...cycle,
    active: false,
    stoppedAt: now.toISOString(),
    stopReason: 'no-new-publishable-work-24h',
    waitingForInactivity: false
  };
  return { cycle: next, inactiveMs, stopped: true };
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
  let inactiveMs = inactivityMs(cycle, now);
  let workRemaining = !cycle.waitingForInactivity;

  if (command === 'start') {
    const eligible = eligibleDiscoveryRecords({ root });
    cycle = startResearchCycle(eligible.fingerprints, now);
    workRemaining = eligible.frontier > 0 || eligible.bootstrapIncomplete || eligible.pendingSeries > 0;
    saveResearchCycle(filePath, cycle);
  } else if (command === 'checkpoint') {
    const eligible = eligibleDiscoveryRecords({ root });
    const result = checkpointResearchCycle(cycle, eligible.fingerprints, {
      now,
      frontier: eligible.frontier,
      bootstrapIncomplete: eligible.bootstrapIncomplete,
      pendingSeries: eligible.pendingSeries
    });
    cycle = result.cycle;
    newConfirmed = result.newConfirmed;
    inactiveMs = result.inactiveMs;
    workRemaining = result.workRemaining;
    saveResearchCycle(filePath, cycle);
  } else if (command === 'timeout') {
    const result = timeoutResearchCycle(cycle, { now });
    cycle = result.cycle;
    inactiveMs = result.inactiveMs;
    if (result.stopped) saveResearchCycle(filePath, cycle);
  } else if (command === 'stop') {
    cycle.active = false;
    cycle.stoppedAt = now.toISOString();
    cycle.stopReason = String(args.reason || 'manual-stop').slice(0, 80);
    cycle.waitingForInactivity = false;
    saveResearchCycle(filePath, cycle);
  } else if (command !== 'status') {
    throw new Error('cycle command must be start, checkpoint, timeout, stop, or status');
  }

  setGithubOutput('active', cycle.active ? 'true' : 'false');
  setGithubOutput('new_confirmed', newConfirmed);
  setGithubOutput('inactive_seconds', Math.floor(inactiveMs / 1000));
  setGithubOutput('stop_reason', cycle.stopReason);
  setGithubOutput('waiting_for_inactivity', cycle.waitingForInactivity ? 'true' : 'false');
  setGithubOutput('work_remaining', workRemaining ? 'true' : 'false');
  console.log(JSON.stringify({
    ...cycle,
    newConfirmed,
    inactiveSeconds: Math.floor(inactiveMs / 1000),
    workRemaining
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Research cycle: FAIL\n${error.message}`);
    process.exit(1);
  });
}
