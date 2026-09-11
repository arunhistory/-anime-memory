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
const coldModel = buildResearchStrategyModel({ researchStrategy: coldState });
const cold = resolveEvidenceWithTrust(evidence, coldModel);
assert.equal(cold.title_ja.status, 'observed', 'one untrained secondary source must not confirm a fact');

const selfDeclaredPrimary = resolveEvidenceWithTrust([{
  field: 'director',
  value: '自称一次情報監督',
  sourceUrl: 'https://claims-official.example.jp/staff',
  sourceClass: 'primary',
  directness: 100,
  rule: 'label-director',
  observedAt: '2026-09-11T00:00:00.000Z'
}], coldModel);
assert.equal(selfDeclaredPrimary.director.status, 'observed', 'a self-declared primary source must not confirm at cold start');

const verifiedPrimary = resolveEvidenceWithTrust([{
  field: 'director',
  value: '検証済み一次情報監督',
  sourceUrl: 'https://official.example.jp/staff',
  sourceClass: 'primary',
  directness: 100,
  verifiedPrimary: true,
  rule: 'label-director',
  observedAt: '2026-09-11T00:00:00.000Z'
}], coldModel);
assert.equal(verifiedPrimary.director.status, 'confirmed', 'an externally verified first-party source must be usable at cold start');
assert.ok(verifiedPrimary.director.confidence >= 70, 'verified primary credibility must meet the cold-start first-party floor');

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

const verifiedPrimaryConflict = resolveEvidenceWithTrust([
  {
    field: 'director',
    value: '一次情報監督A',
    sourceUrl: 'https://official-a.example.jp/staff',
    sourceClass: 'primary',
    directness: 100,
    verifiedPrimary: true,
    rule: 'label-director',
    observedAt: '2026-09-11T00:00:00.000Z'
  },
  {
    field: 'director',
    value: '一次情報監督B',
    sourceUrl: 'https://official-b.example.jp/staff',
    sourceClass: 'primary',
    directness: 100,
    verifiedPrimary: true,
    rule: 'label-director',
    observedAt: '2026-09-11T00:00:00.000Z'
  }
], coldModel);
assert.equal(verifiedPrimaryConflict.director.status, 'conflict', 'conflicting verified primary values must not be silently selected');

console.log('Learned source confirmation self-test: PASS');
console.log('cold-start secondary single-source block: PASS');
console.log('cold-start self-declared primary block: PASS');
console.log('cold-start externally verified primary confirmation: PASS');
console.log('trained high-directness source: PASS');
console.log('unrelated-source trust isolation: PASS');
console.log('credible conflict block: PASS');
console.log('verified primary conflict block: PASS');
