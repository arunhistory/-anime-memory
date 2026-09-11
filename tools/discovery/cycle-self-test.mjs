import assert from 'node:assert/strict';
import {
  RESEARCH_INACTIVITY_LIMIT_MS,
  checkpointResearchCycle,
  publishableCandidateFingerprints,
  startResearchCycle,
  timeoutResearchCycle
} from './cycle.mjs';
import { recordCandidateResearch } from './research-completion.mjs';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const start = new Date('2026-09-10T00:00:00Z');
let cycle = startResearchCycle([hashA], start);
assert.equal(cycle.active, true);
assert.equal(cycle.lastNewDiscoveryAt, start.toISOString());
assert.equal(cycle.waitingForInactivity, false);
assert.equal(cycle.resumeAfter, '');

let result = checkpointResearchCycle(cycle, [hashA], {
  now: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS - 1),
  frontier: 10
});
assert.equal(result.cycle.active, true);
assert.equal(result.newConfirmed, 0);
assert.equal(result.workRemaining, true);

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
assert.equal(result.cycle.stopReason, 'no-new-publishable-work-24h');

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], { now: start, frontier: 0, bootstrapIncomplete: true, pendingSeries: 0 });
assert.equal(result.cycle.active, true, 'empty web frontier must not stop while Wikidata bootstrap can still add works');
assert.equal(result.workRemaining, true);
assert.equal(result.cycle.waitingForInactivity, false);

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], { now: start, frontier: 0, bootstrapIncomplete: false, pendingSeries: 1 });
assert.equal(result.cycle.active, true, 'empty web frontier must not stop while a known series still needs expansion');
assert.equal(result.workRemaining, true);
assert.equal(result.cycle.waitingForInactivity, false);

const backoffUntil = new Date(start.getTime() + 5 * 60 * 1000).toISOString();
cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], {
  now: start,
  frontier: 0,
  bootstrapIncomplete: true,
  pendingSeries: 0,
  wikidataBackoffUntil: backoffUntil
});
assert.equal(result.cycle.active, true);
assert.equal(result.workRemaining, false, 'Wikidata-only work must not trigger immediate redispatch during Retry-After');
assert.equal(result.cycle.waitingForInactivity, true);
assert.equal(result.cycle.resumeAfter, backoffUntil);
let backoffTimeout = timeoutResearchCycle(result.cycle, { now: new Date(start.getTime() + 4 * 60 * 1000) });
assert.equal(backoffTimeout.resumeResearch, false, 'watcher must not resume before Retry-After');
backoffTimeout = timeoutResearchCycle(result.cycle, { now: new Date(start.getTime() + 5 * 60 * 1000) });
assert.equal(backoffTimeout.resumeResearch, true, 'watcher must resume research when Retry-After expires');
assert.equal(backoffTimeout.stopped, false);

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], {
  now: start,
  frontier: 2,
  bootstrapIncomplete: true,
  pendingSeries: 0,
  wikidataBackoffUntil: backoffUntil
});
assert.equal(result.workRemaining, true, 'web frontier work must continue while Wikidata is throttled');
assert.equal(result.cycle.waitingForInactivity, false);
assert.equal(result.cycle.resumeAfter, '');

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], { now: start, frontier: 0, bootstrapIncomplete: false, pendingSeries: 0 });
assert.equal(result.cycle.active, true, 'research exhaustion must wait for the 24-hour no-new-work condition');
assert.equal(result.cycle.stopReason, '');
assert.equal(result.workRemaining, false);
assert.equal(result.cycle.waitingForInactivity, true);
assert.equal(result.cycle.resumeAfter, '');

let timeout = timeoutResearchCycle(result.cycle, {
  now: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS - 1)
});
assert.equal(timeout.cycle.active, true, 'timeout watcher must not stop before 24 hours');
assert.equal(timeout.stopped, false);
assert.equal(timeout.resumeResearch, false);

timeout = timeoutResearchCycle(result.cycle, {
  now: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS)
});
assert.equal(timeout.cycle.active, false);
assert.equal(timeout.cycle.stopReason, 'no-new-publishable-work-24h');
assert.equal(timeout.stopped, true);
assert.equal(timeout.resumeResearch, false);

cycle = startResearchCycle([], start);
result = checkpointResearchCycle(cycle, [], {
  now: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS),
  frontier: 0,
  bootstrapIncomplete: true,
  pendingSeries: 0,
  wikidataBackoffUntil: new Date(start.getTime() + RESEARCH_INACTIVITY_LIMIT_MS + 60_000).toISOString()
});
assert.equal(result.cycle.active, false, '24-hour inactivity stop must take precedence over future Retry-After');
assert.equal(result.cycle.stopReason, 'no-new-publishable-work-24h');
assert.equal(result.cycle.resumeAfter, '');

const manyFingerprints = Array.from({ length: 20001 }, (_, index) => index.toString(16).padStart(64, '0'));
cycle = startResearchCycle(manyFingerprints, start);
assert.equal(cycle.seenEligible.length, 20001, 'eligible-work history must not silently truncate at 20,000');
result = checkpointResearchCycle(cycle, manyFingerprints, { now: new Date(start.getTime() + 1000), frontier: 1 });
assert.equal(result.newConfirmed, 0);
assert.equal(result.cycle.seenEligible.length, 20001);

function confirmed(value) {
  return { status: 'confirmed', value, sourceCount: 2, hostCount: 2, primarySourceCount: 0, confidence: 90, trainingSamples: 40, alternatives: [] };
}

let research = {};
for (const [url, field] of [
  ['https://official.example/staff/', 'director'],
  ['https://independent.example/music/', 'opening_themes']
]) {
  research = recordCandidateResearch(research, {
    url,
    evidence: [{ field, value: 'fixture' }],
    observedAt: '2026-09-11T00:00:00.000Z'
  });
}

const richCandidate = {
  key: 'cycle-rich-work',
  title: 'Cycle Rich Work',
  evidence: [
    { field: 'title_ja', value: 'Cycle Rich Work', sourceUrl: 'https://official.example/', directness: 99, rule: 'label-title' },
    { field: 'title_ja', value: 'Cycle Rich Work', sourceUrl: 'https://independent.example/title', directness: 95, rule: 'label-title' },
    { field: 'origin_country', value: 'JP', sourceUrl: 'https://official.example/', directness: 98, rule: 'origin-country-labeled-japan' },
    { field: 'media_type', value: 'TV', sourceUrl: 'https://official.example/', directness: 99, rule: 'label-media-type' },
    { field: 'media_type', value: 'TV', sourceUrl: 'https://independent.example/type', directness: 95, rule: 'label-media-type' }
  ],
  facts: {
    title_ja: confirmed('Cycle Rich Work'),
    origin_country: confirmed('JP'),
    media_type: confirmed('TV'),
    release_start: confirmed('2027-01-01'),
    episode_count: confirmed('12'),
    animation_studio: confirmed('Studio A'),
    production_name: confirmed('Production A'),
    director: confirmed('Director A'),
    series_composition: confirmed('Writer A'),
    characters: confirmed('Hero::MAIN::Actor A'),
    music: confirmed('Composer A'),
    opening_themes: confirmed('OP::Song A::Artist A::::::'),
    original_type: confirmed('漫画'),
    original_author: confirmed('Author A'),
    official_url: confirmed('https://official.example/'),
    broadcast_networks: confirmed('Network A')
  },
  research,
  series: {
    ref: 'https://www.wikidata.org/entity/Q999991',
    title: 'Cycle Rich Work',
    inferredStem: 'Cycle Rich Work',
    members: [{ title: 'Cycle Rich Work', url: '', kind: 'OTHER' }]
  }
};
const sparseCandidate = structuredClone(richCandidate);
sparseCandidate.key = 'cycle-sparse-work';
sparseCandidate.title = 'Cycle Sparse Work';
sparseCandidate.evidence = sparseCandidate.evidence.map((item) => ({ ...item, value: item.field === 'title_ja' ? 'Cycle Sparse Work' : item.value }));
sparseCandidate.facts = {
  title_ja: confirmed('Cycle Sparse Work'),
  origin_country: confirmed('JP'),
  media_type: confirmed('TV'),
  release_start: confirmed('2027-01-01')
};
sparseCandidate.series = {};

const eligibleFingerprints = publishableCandidateFingerprints({
  candidates: [richCandidate, sparseCandidate],
  wikidataSeriesExpansion: { expandedRefs: ['https://www.wikidata.org/entity/Q999991'] }
});
assert.equal(eligibleFingerprints.length, 1, 'cycle progress must count publishable works, not identity-only sparse candidates');

console.log('Research cycle self-test: PASS');
console.log('24-hour no-new-publishable-work stop: PASS');
console.log('new publishable work resets inactivity timer: PASS');
console.log('identity-only sparse work does not reset inactivity: PASS');
console.log('Wikidata Retry-After pause/resume: PASS');
console.log('web work continues during Wikidata backoff: PASS');
console.log('exhausted research waits without redispatch until inactivity timeout: PASS');
console.log('eligible history over 20k: PRESERVED');
