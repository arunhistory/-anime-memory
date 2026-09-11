import assert from 'node:assert/strict';
import {
  addFrontierPriorityEntry,
  buildFrontierPriorityIndex,
  compactFrontier,
  popBestFrontier,
  touchFrontierPriorityEntry
} from './frontier-priority.mjs';
import {
  buildResearchStrategyModel,
  emptyResearchStrategyState,
  recordSourceTrustOutcome,
  scoreResearchRoute
} from './research-strategy.mjs';
import { hostKey } from './url.mjs';

function oldPopBest(frontier, trustModel, hostCounts, perHostLimit) {
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < frontier.length; index += 1) {
    const entry = frontier[index];
    const host = hostKey(entry.url);
    if ((hostCounts.get(host) || 0) >= perHostLimit) continue;
    const score = Number(entry.priority || 0) + scoreResearchRoute(trustModel, { url: entry.url }).boost;
    if (bestIndex < 0 || score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex < 0 ? null : frontier.splice(bestIndex, 1)[0];
}

function cloneEntry(entry) {
  return { ...entry, candidateHints: [...(entry.candidateHints || [])] };
}

const strategyState = emptyResearchStrategyState();
for (let index = 0; index < 5; index += 1) {
  recordSourceTrustOutcome(strategyState, {
    sourceUrl: 'https://trusted.example.test/staff/work',
    field: 'director',
    outcome: 'match',
    strength: 'strong',
    observedAt: '2026-09-11T00:00:00.000Z'
  });
}
let trustModel = buildResearchStrategyModel({ researchStrategy: strategyState });

const smallFixture = [
  { url: 'https://neutral.example.test/works/1', priority: 120, candidateHints: [] },
  { url: 'https://trusted.example.test/staff/1', priority: 100, candidateHints: [] },
  { url: 'https://neutral.example.test/music/2', priority: 118, candidateHints: [] },
  { url: 'https://trusted.example.test/staff/2', priority: 99, candidateHints: [] },
  { url: 'https://other.example.test/onair/3', priority: 115, candidateHints: [] }
];
const oldFrontier = smallFixture.map(cloneEntry);
const newFrontier = smallFixture.map(cloneEntry);
const queued = new Map(newFrontier.map((entry) => [entry.url, entry]));
const priorityIndex = buildFrontierPriorityIndex(newFrontier, queued);
const oldCounts = new Map();
const newCounts = new Map();
for (let step = 0; step < 5; step += 1) {
  const oldEntry = oldPopBest(oldFrontier, trustModel, oldCounts, 3);
  const newEntry = popBestFrontier(priorityIndex, queued, trustModel, newCounts, 3);
  assert.equal(newEntry?.url || null, oldEntry?.url || null, `indexed priority order drifted at step ${step}`);
  if (!oldEntry || !newEntry) break;
  const oldHost = hostKey(oldEntry.url);
  const newHost = hostKey(newEntry.url);
  oldCounts.set(oldHost, (oldCounts.get(oldHost) || 0) + 1);
  newCounts.set(newHost, (newCounts.get(newHost) || 0) + 1);
}

const mutable = { url: 'https://touch.example.test/works/a', priority: 10, candidateHints: [] };
const mutableFrontier = [mutable, { url: 'https://touch.example.test/works/b', priority: 20, candidateHints: [] }];
const mutableQueued = new Map(mutableFrontier.map((entry) => [entry.url, entry]));
const mutableIndex = buildFrontierPriorityIndex(mutableFrontier, mutableQueued);
mutable.priority = 30;
touchFrontierPriorityEntry(mutableIndex, mutable);
assert.equal(popBestFrontier(mutableIndex, mutableQueued, trustModel, new Map(), 10)?.url, mutable.url, 'priority increase must be reflected lazily');

const hostLimitedFrontier = [
  { url: 'https://limited.example.test/works/a', priority: 100, candidateHints: [] },
  { url: 'https://limited.example.test/works/b', priority: 99, candidateHints: [] },
  { url: 'https://free.example.test/works/c', priority: 1, candidateHints: [] }
];
const hostLimitedQueued = new Map(hostLimitedFrontier.map((entry) => [entry.url, entry]));
const hostLimitedIndex = buildFrontierPriorityIndex(hostLimitedFrontier, hostLimitedQueued);
const limitedCounts = new Map([['limited.example.test', 1]]);
assert.equal(
  popBestFrontier(hostLimitedIndex, hostLimitedQueued, trustModel, limitedCounts, 1)?.url,
  'https://free.example.test/works/c',
  'per-host exhausted groups must be skipped without deleting their queued URLs'
);
assert.equal(hostLimitedQueued.has('https://limited.example.test/works/a'), true);
assert.equal(hostLimitedQueued.has('https://limited.example.test/works/b'), true);

const focusedSameGroup = [
  { url: 'https://focus.example.test/broadcast/stale', priority: 1000, candidateHints: ['別作品'] },
  { url: 'https://focus.example.test/broadcast/target', priority: 100, candidateHints: ['集中作品'] }
];
Object.defineProperty(focusedSameGroup, 'focusCandidateKey', {
  value: '集中作品',
  enumerable: false,
  configurable: true,
  writable: true
});
const sameGroupQueued = new Map(focusedSameGroup.map((entry) => [entry.url, entry]));
const sameGroupIndex = buildFrontierPriorityIndex(focusedSameGroup, sameGroupQueued);
assert.equal(
  popBestFrontier(sameGroupIndex, sameGroupQueued, trustModel, new Map(), 10)?.url,
  'https://focus.example.test/broadcast/target',
  'ephemeral focus must outrank stale priority 1000 inside the same host/route heap'
);
assert.equal(focusedSameGroup[0].priority, 1000, 'stale base priority must remain unchanged');
assert.equal(focusedSameGroup[1].priority, 100, 'focused base priority must remain unchanged');
assert.equal(JSON.stringify(focusedSameGroup).includes('focusCandidateKey'), false, 'ephemeral focus must not serialize into crawler state');

const focusedAcrossGroups = [
  { url: 'https://stale.example.test/works/old', priority: 1000, candidateHints: ['別作品'] },
  { url: 'https://target.example.net/staff/new', priority: 1, candidateHints: ['集中作品'] }
];
Object.defineProperty(focusedAcrossGroups, 'focusCandidateKey', {
  value: '集中作品',
  enumerable: false,
  configurable: true,
  writable: true
});
const acrossQueued = new Map(focusedAcrossGroups.map((entry) => [entry.url, entry]));
const acrossIndex = buildFrontierPriorityIndex(focusedAcrossGroups, acrossQueued);
assert.equal(
  popBestFrontier(acrossIndex, acrossQueued, trustModel, new Map(), 10)?.url,
  'https://target.example.net/staff/new',
  'ephemeral focus must outrank stale priority 1000 across groups'
);

const lateFocusFrontier = [
  { url: 'https://late.example.test/broadcast/stale', priority: 1000, candidateHints: ['別作品'] }
];
Object.defineProperty(lateFocusFrontier, 'focusCandidateKey', {
  value: '集中作品',
  enumerable: false,
  configurable: true,
  writable: true
});
const lateFocusQueued = new Map(lateFocusFrontier.map((entry) => [entry.url, entry]));
const lateFocusIndex = buildFrontierPriorityIndex(lateFocusFrontier, lateFocusQueued);
const lateEntry = { url: 'https://late.example.test/broadcast/new', priority: 5, candidateHints: ['集中作品'] };
lateFocusFrontier.push(lateEntry);
lateFocusQueued.set(lateEntry.url, lateEntry);
addFrontierPriorityEntry(lateFocusIndex, lateEntry);
assert.equal(
  popBestFrontier(lateFocusIndex, lateFocusQueued, trustModel, new Map(), 10)?.url,
  lateEntry.url,
  'newly queued focused URL must enter the ephemeral focus lane immediately'
);
assert.equal(lateEntry.priority, 5, 'late focused URL base priority must stay unchanged');

const scaleFrontier = [];
const hostCount = 100;
const routeParts = ['works', 'staff', 'music', 'onair'];
for (let index = 0; index < 200000; index += 1) {
  const host = `h${index % hostCount}.scale.example.test`;
  const route = routeParts[index % routeParts.length];
  scaleFrontier.push({
    url: `https://${host}/${route}/${index}`,
    priority: index % 1000,
    candidateHints: []
  });
}
const scaleQueued = new Map(scaleFrontier.map((entry) => [entry.url, entry]));
const scaleIndex = buildFrontierPriorityIndex(scaleFrontier, scaleQueued);
assert.ok(scaleIndex.groups.size <= hostCount * routeParts.length, 'frontier grouping unexpectedly exploded');
const scaleCounts = new Map();
for (let step = 0; step < 100; step += 1) {
  const entry = popBestFrontier(scaleIndex, scaleQueued, trustModel, scaleCounts, 10);
  assert.ok(entry, `200k frontier selection stopped early at ${step}`);
  const host = hostKey(entry.url);
  scaleCounts.set(host, (scaleCounts.get(host) || 0) + 1);
}
assert.equal(scaleIndex.selectionStats.pops, 100);
assert.ok(
  scaleIndex.selectionStats.groupEvaluations <= scaleIndex.groups.size * 100,
  'selection must evaluate group heads, not every frontier URL'
);
assert.ok(
  scaleIndex.selectionStats.groupEvaluations < 100000,
  `200k frontier selection performed too many group evaluations: ${scaleIndex.selectionStats.groupEvaluations}`
);
assert.equal(scaleQueued.size, 199900);
assert.equal(compactFrontier(scaleFrontier, scaleQueued).length, 199900, 'batch-end compaction must remove processed URLs exactly once');

const dynamicState = emptyResearchStrategyState();
const dynamicFrontier = [
  { url: 'https://dynamic-a.example.test/staff/work', priority: 100, candidateHints: [] },
  { url: 'https://dynamic-b.example.test/staff/work', priority: 100, candidateHints: [] }
];
const dynamicQueued = new Map(dynamicFrontier.map((entry) => [entry.url, entry]));
const dynamicIndex = buildFrontierPriorityIndex(dynamicFrontier, dynamicQueued);
for (let index = 0; index < 10; index += 1) {
  recordSourceTrustOutcome(dynamicState, {
    sourceUrl: 'https://dynamic-b.example.test/staff/work',
    field: 'director',
    outcome: 'match',
    strength: 'strong',
    observedAt: '2026-09-11T00:00:00.000Z'
  });
  recordSourceTrustOutcome(dynamicState, {
    sourceUrl: 'https://dynamic-a.example.test/staff/work',
    field: 'director',
    outcome: 'conflict',
    strength: 'strong',
    observedAt: '2026-09-11T00:00:00.000Z'
  });
}
trustModel = buildResearchStrategyModel({ researchStrategy: dynamicState });
assert.equal(
  popBestFrontier(dynamicIndex, dynamicQueued, trustModel, new Map(), 10)?.url,
  'https://dynamic-b.example.test/staff/work',
  'current trust model must be re-evaluated when selecting group heads'
);

console.log('Frontier priority index self-test: PASS');
console.log('legacy selection semantics: PASS');
console.log('dynamic trust reprioritization: PASS');
console.log('per-host bound: PASS');
console.log('priority update lazy heap refresh: PASS');
console.log('ephemeral focused lane over stale priority 1000: PASS');
console.log('focused base priority persistence mutation: NONE');
console.log('late focused URL indexing: PASS');
console.log('200k frontier: GROUP-HEAD SELECTION');
console.log(`200k groups: ${scaleIndex.groups.size}`);
console.log(`100 pops group evaluations: ${scaleIndex.selectionStats.groupEvaluations}`);
