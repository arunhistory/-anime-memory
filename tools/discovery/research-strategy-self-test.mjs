import assert from 'node:assert/strict';
import {
  buildResearchStrategyModel,
  emptyResearchStrategyState,
  learnSourceTrustFromKnownRecord,
  recordResearchOperation,
  recordSourceTrustOutcome,
  sanitizeResearchStrategyState,
  scoreResearchRoute,
  scoreSourceCredibility
} from './research-strategy.mjs';
import { resolveEvidenceWithTrust } from './trust-resolution.mjs';

const state = { researchStrategy: emptyResearchStrategyState() };
let model = buildResearchStrategyModel(state);

const unknown = scoreSourceCredibility(model, {
  sourceUrl: 'https://unknown.test/news/star',
  field: 'director',
  sourceClass: 'secondary'
});
assert.ok(unknown.credibility >= 35 && unknown.credibility <= 55, 'unknown secondary source must start neutral-to-conservative');

const unknownOfficial = resolveEvidenceWithTrust([
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://claims-official.test/anime/star', sourceClass: 'primary' }
], model);
assert.equal(unknownOfficial.release_start.status, 'observed', 'a self-declared official page with no trust history must not confirm by itself');

for (let i = 0; i < 4; i += 1) {
  recordSourceTrustOutcome(state.researchStrategy, {
    sourceUrl: 'https://good.test/staff/star',
    field: 'director',
    outcome: 'match',
    strength: 'strong',
    observedAt: '2026-09-10T00:00:00.000Z'
  });
  recordSourceTrustOutcome(state.researchStrategy, {
    sourceUrl: 'https://bad.test/news/star',
    field: 'director',
    outcome: 'conflict',
    strength: 'strong',
    observedAt: '2026-09-10T00:00:00.000Z'
  });
}
model = buildResearchStrategyModel(state);
const goodDirector = scoreSourceCredibility(model, {
  sourceUrl: 'https://good.test/staff/star',
  field: 'director',
  sourceClass: 'secondary'
});
const badDirector = scoreSourceCredibility(model, {
  sourceUrl: 'https://bad.test/news/star',
  field: 'director',
  sourceClass: 'secondary'
});
assert.ok(goodDirector.credibility >= 65, 'repeated correct site/route/field history must raise credibility');
assert.ok(badDirector.credibility <= 35, 'repeated conflicting site/route/field history must lower credibility');

const goodStreaming = scoreSourceCredibility(model, {
  sourceUrl: 'https://good.test/staff/star',
  field: 'streaming_services',
  sourceClass: 'secondary'
});
assert.ok(goodDirector.credibility > goodStreaming.credibility, 'trust must be field-specific, not only site-wide');

for (let i = 0; i < 3; i += 1) {
  recordResearchOperation(state.researchStrategy, {
    url: 'https://good.test/staff/star',
    fetched: true,
    evidenceClaims: 5,
    observedAt: '2026-09-10T00:00:00.000Z'
  });
  recordResearchOperation(state.researchStrategy, {
    url: 'https://bad.test/news/star',
    failed: true,
    observedAt: '2026-09-10T00:00:00.000Z'
  });
}
model = buildResearchStrategyModel(state);
assert.ok(
  scoreResearchRoute(model, { url: 'https://good.test/staff/star' }).score
    > scoreResearchRoute(model, { url: 'https://bad.test/news/star' }).score,
  'research ordering must combine credibility and operational success'
);

const knownRecord = {
  title_ja: '星の旅',
  aliases: 'スター・ジャーニー|星旅',
  director: '星野監督',
  animation_studio: 'Studio Star',
  release_start: '2027-04-03'
};
const trainingEvidence = [
  { field: 'title_ja', value: '星旅', sourceUrl: 'https://teacher.test/staff/star', sourceClass: 'secondary' },
  { field: 'director', value: '星野監督', sourceUrl: 'https://teacher.test/staff/star', sourceClass: 'secondary' },
  { field: 'animation_studio', value: 'Studio Star', sourceUrl: 'https://teacher.test/staff/star', sourceClass: 'secondary' },
  { field: 'release_start', value: '2027-04-04', sourceUrl: 'https://teacher.test/staff/star', sourceClass: 'secondary' }
];
const trained = learnSourceTrustFromKnownRecord(state.researchStrategy, trainingEvidence, knownRecord, '2026-09-10T00:00:00.000Z');
assert.equal(trained, 4, 'registered CSV must act as a teacher for fields that already have known values');
model = buildResearchStrategyModel(state);
assert.ok(
  scoreSourceCredibility(model, { sourceUrl: 'https://teacher.test/staff/star', field: 'director' }).credibility
    > scoreSourceCredibility(model, { sourceUrl: 'https://teacher.test/staff/star', field: 'release_start' }).credibility,
  'the same site/path must learn different trust by field according to agreement history'
);

for (const host of ['trusted-one.test', 'trusted-two.test']) {
  for (let i = 0; i < 4; i += 1) {
    recordSourceTrustOutcome(state.researchStrategy, {
      sourceUrl: `https://${host}/onair/star`,
      field: 'release_start',
      outcome: 'match',
      strength: 'strong',
      observedAt: '2026-09-10T00:00:00.000Z'
    });
  }
}
for (let i = 0; i < 4; i += 1) {
  recordSourceTrustOutcome(state.researchStrategy, {
    sourceUrl: 'https://wrong.test/news/star',
    field: 'release_start',
    outcome: 'conflict',
    strength: 'strong',
    observedAt: '2026-09-10T00:00:00.000Z'
  });
  recordSourceTrustOutcome(state.researchStrategy, {
    sourceUrl: 'https://official.test/anime/star',
    field: 'release_start',
    outcome: 'match',
    strength: 'strong',
    observedAt: '2026-09-10T00:00:00.000Z'
  });
}
model = buildResearchStrategyModel(state);

const trustedSecondary = resolveEvidenceWithTrust([
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://trusted-one.test/onair/star', sourceClass: 'secondary' },
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://trusted-two.test/onair/star', sourceClass: 'secondary' }
], model);
assert.equal(trustedSecondary.release_start.status, 'confirmed', 'two independently learned trustworthy secondary sites may confirm together');

const unknownSecondary = resolveEvidenceWithTrust([
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://new-one.test/news/star', sourceClass: 'secondary' },
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://new-two.test/news/star', sourceClass: 'secondary' }
], model);
assert.equal(unknownSecondary.release_start.status, 'confirmed', 'two independent secondary families must break the empty-dataset bootstrap deadlock');

const officialAgainstBad = resolveEvidenceWithTrust([
  { field: 'release_start', value: '2027-04-03', sourceUrl: 'https://official.test/anime/star', sourceClass: 'primary' },
  { field: 'release_start', value: '2027-04-04', sourceUrl: 'https://wrong.test/news/star', sourceClass: 'secondary' }
], model);
assert.equal(officialAgainstBad.release_start.status, 'confirmed', 'a learned trusted primary source must not be overturned by a learned low-credibility site');
assert.equal(officialAgainstBad.release_start.value, '2027-04-03');

const largeStrategy = emptyResearchStrategyState();
for (let index = 0; index < 20001; index += 1) {
  largeStrategy.operations[`host-${index}.test\u0000general`] = {
    attempts: 1, fetched: 1, evidencePages: 0, evidenceClaims: 0, failures: 0, blocked: 0, lastUpdated: ''
  };
}
for (let index = 0; index < 50001; index += 1) {
  largeStrategy.trust[`host\u0000source-${index}.test`] = {
    strongMatches: 0, weakMatches: 1, strongConflicts: 0, weakConflicts: 0, samples: 1, lastUpdated: ''
  };
}
const preservedStrategy = sanitizeResearchStrategyState(largeStrategy);
assert.equal(Object.keys(preservedStrategy.operations).length, 20001, 'operation learning beyond 20k must not be truncated');
assert.equal(Object.keys(preservedStrategy.trust).length, 50001, 'source trust learning beyond 50k must not be truncated');

console.log('Research strategy self-test: PASS');
console.log('site/family/route/field credibility learning: PASS');
console.log('registered CSV teacher feedback: PASS');
console.log('unknown official self-claim auto-confirmation: BLOCKED');
console.log('independent secondary cold-start corroboration: PASS');
console.log('low-trust conflict overriding trusted primary: BLOCKED');
console.log('research operations over 20k: PRESERVED');
console.log('source trust entries over 50k: PRESERVED');
