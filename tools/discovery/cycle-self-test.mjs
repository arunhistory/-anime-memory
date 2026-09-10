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
result = checkpointResearchCycle(cycle, [], { now: start, frontier: 0, bootstrapIncomplete: true, pendingSeries: 0 });
assert.equal(result.cycle.active, true, 'empty web frontier must not stop while Wikidata bootstrap can still add works');

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], { now: start, frontier: 0, bootstrapIncomplete: false, pendingSeries: 1 });
assert.equal(result.cycle.active, true, 'empty web frontier must not stop while a known series still needs expansion');

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], { now: start, frontier: 0, bootstrapIncomplete: false, pendingSeries: 0 });
assert.equal(result.cycle.active, false);
assert.equal(result.cycle.stopReason, 'frontier-empty');

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], {
  now: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS),
  frontier: 0,
  bootstrapIncomplete: true,
  pendingSeries: 0
});
assert.equal(result.cycle.active, false);
assert.equal(result.cycle.stopReason, 'no-new-confirmed-work-24h');

const manyFingerprints = Array.from({ length: 20001 }, (_, index) => index.toString(16).padStart(64, '0'));
cycle = startResearchCycle(manyFingerprints, start);
assert.equal(cycle.seenEligible.length, 20001, 'eligible-work history must not silently truncate at 20,000');
result = checkpointResearchCycle(cycle, manyFingerprints, { now: new Date(start.getTime() + 1000), frontier: 1 });
assert.equal(result.newConfirmed, 0);
assert.equal(result.cycle.seenEligible.length, 20001);

console.log('Research cycle self-test: PASS');
console.log('24-hour no-new-work stop: PASS');
console.log('new confirmed work resets inactivity timer: PASS');
console.log('bootstrap/series work prevents premature frontier-empty stop: PASS');
console.log('eligible history over 20k: PRESERVED');
