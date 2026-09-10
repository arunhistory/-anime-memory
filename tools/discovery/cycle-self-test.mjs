import assert from 'node:assert/strict';
import {
  RESEARCH_INACTIVITY_LIMIT_MS,
  checkpointResearchCycle,
  startResearchCycle
} from './cycle.mjs';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const start = new Date('2026-09-10T00:00:00Z');
let cycle = startResearchCycle([hashA], start);
assert.equal(cycle.active, true);
assert.equal(cycle.lastNewDiscoveryAt, start.toISOString());

let result = checkpointResearchCycle(cycle, [hashA], {
  now: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS - 1),
  frontier: 10
});
assert.equal(result.cycle.active, true);
assert.equal(result.newConfirmed, 0);

result = checkpointResearchCycle(result.cycle, [hashA, hashB], {
  now: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS - 1),
  frontier: 10
});
assert.equal(result.newConfirmed, 1);
assert.equal(result.cycle.active, true);
cycle = result.cycle;

result = checkpointResearchCycle(cycle, [hashA, hashB], {
  now: new Date(Date.parse(cycle.lastNewDiscoveryAt) + RESEARCH_INACTIVITY_LIMIT_MS),
  frontier: 10
});
assert.equal(result.cycle.active, false);
assert.equal(result.cycle.stopReason, 'no-new-confirmed-work-24h');

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], { now: start, frontier: 0 });
assert.equal(result.cycle.active, false);
assert.equal(result.cycle.stopReason, 'frontier-empty');

console.log('Research cycle self-test: PASS');
console.log('24-hour no-new-work stop: PASS');
console.log('new confirmed work resets inactivity timer: PASS');
