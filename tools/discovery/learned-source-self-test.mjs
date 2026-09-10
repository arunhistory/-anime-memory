import assert from 'node:assert/strict';
import {
  buildResearchStrategyModel,
  emptyResearchStrategyState,
  recordSourceTrustOutcome
} from './research-strategy.mjs';
import { resolveEvidenceWithTrust } from './trust-resolution.mjs';

const sourceUrl = 'https://reliable.example.jp/anime/works/1';
const evidence = [{
  field: 'title_ja',
  value: '学習済みソース作品',
  sourceUrl,
  sourceClass: 'secondary',
  directness: 96,
  rule: 'structured-title',
  observedAt: '2026-09-11T00:00:00.000Z'
}];

const coldState = emptyResearchStrategyState();
const cold = resolveEvidenceWithTrust(evidence, buildResearchStrategyModel({ researchStrategy: coldState }));
assert.equal(cold.title_ja.status, 'observed', 'one untrained secondary source must not confirm a fact');

const trainedState = emptyResearchStrategyState();
for (let index = 0; index < 10; index += 1) {
  recordSourceTrustOutcome(trainedState, {
    sourceUrl,
    field: 'title_ja',
    outcome: 'match',
    strength: 'strong',
    observedAt: `2026-09-11T00:${String(index).padStart(2, '0')}:00.000Z`
  });
}
const trainedModel = buildResearchStrategyModel({ researchStrategy: trainedState });
const learned = resolveEvidenceWithTrust(evidence, trainedModel);
assert.equal(learned.title_ja.status, 'confirmed', 'high-directness facts from a sufficiently trained source should be confirmable');
assert.ok(learned.title_ja.trainingSamples >= 40);
assert.ok(learned.title_ja.confidence >= 82);

const random = resolveEvidenceWithTrust([{ ...evidence[0], sourceUrl: 'https://unknown.example.jp/work/1' }], trainedModel);
assert.equal(random.title_ja.status, 'observed', 'training must not transfer blindly to an unrelated source family');

const conflict = resolveEvidenceWithTrust([
  ...evidence,
  { ...evidence[0], value: '矛盾する別タイトル' }
], trainedModel);
assert.equal(conflict.title_ja.status, 'conflict', 'a trained source must not suppress credible conflicting values');

console.log('Learned source confirmation self-test: PASS');
console.log('cold-start single-source block: PASS');
console.log('trained high-directness source: PASS');
console.log('unrelated-source trust isolation: PASS');
console.log('credible conflict block: PASS');
