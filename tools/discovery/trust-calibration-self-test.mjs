import assert from 'node:assert/strict';
import { emptyResearchStrategyState, buildResearchStrategyModel, scoreSourceCredibility } from './research-strategy.mjs';
import { calibrateSourceTrustFromConsensus } from './trust-calibration.mjs';

function evidence(sourceUrl, field, value, sourceClass = 'secondary') {
  return { sourceUrl, field, value, sourceClass, rule: 'fixture', observedAt: '2026-09-10T00:00:00.000Z' };
}

const strategy = emptyResearchStrategyState();
const threeWithPrimary = {
  key: '星の旅',
  title: '星の旅',
  evidence: [
    evidence('https://official.test/anime/star', 'release_start', '2027-04-03', 'primary'),
    evidence('https://news-one.test/star', 'release_start', '2027-04-03'),
    evidence('https://news-two.test/star', 'release_start', '2027-04-03')
  ]
};
let result = calibrateSourceTrustFromConsensus({ candidates: [threeWithPrimary], strategyState: strategy, seen: [], observedAt: '2026-09-10T00:00:00.000Z' });
assert.equal(result.consensusFields, 1);
assert.equal(result.trained, 3, 'one direct primary plus three independent families total may weakly calibrate');
assert.equal(result.seen.length, 3);

const modelAfter = buildResearchStrategyModel({ researchStrategy: strategy });
assert.ok(scoreSourceCredibility(modelAfter, { sourceUrl: 'https://news-one.test/star', field: 'release_start' }).credibility > 45);

const duplicate = calibrateSourceTrustFromConsensus({ candidates: [threeWithPrimary], strategyState: strategy, seen: result.seen, observedAt: '2026-09-10T00:10:00.000Z' });
assert.equal(duplicate.trained, 0, 'same calibration evidence must not train repeatedly');

const twoOnly = {
  key: '海の灯',
  title: '海の灯',
  evidence: [
    evidence('https://a.test/star', 'director', '監督A'),
    evidence('https://b.test/star', 'director', '監督A')
  ]
};
result = calibrateSourceTrustFromConsensus({ candidates: [twoOnly], strategyState: emptyResearchStrategyState(), seen: [] });
assert.equal(result.trained, 0, 'two unknown secondary families are insufficient for cold-start calibration');

const fourSecondary = {
  key: '空の音',
  title: '空の音',
  evidence: ['a', 'b', 'c', 'd'].map((host) => evidence(`https://${host}.example/star`, 'animation_studio', 'Studio Sky'))
};
result = calibrateSourceTrustFromConsensus({ candidates: [fourSecondary], strategyState: emptyResearchStrategyState(), seen: [] });
assert.equal(result.trained, 4, 'four independent secondary families may weakly calibrate a hard factual field');

const conflict = {
  key: '森の声',
  title: '森の声',
  evidence: [
    evidence('https://official.example/star', 'release_start', '2027-04-03', 'primary'),
    evidence('https://a.example/star', 'release_start', '2027-04-03'),
    evidence('https://b.example/star', 'release_start', '2027-04-03'),
    evidence('https://c.example/star', 'release_start', '2027-04-04'),
    evidence('https://d.example/star', 'release_start', '2027-04-04')
  ]
};
result = calibrateSourceTrustFromConsensus({ candidates: [conflict], strategyState: emptyResearchStrategyState(), seen: [] });
assert.equal(result.trained, 0, 'material competing values must block calibration');
assert.ok(result.conflictedFieldsSkipped >= 1);

const subjective = {
  key: '町の日々',
  title: '町の日々',
  evidence: ['a', 'b', 'c', 'd'].map((host) => evidence(`https://${host}.subjective/star`, 'genres', 'ほのぼの'))
};
result = calibrateSourceTrustFromConsensus({ candidates: [subjective], strategyState: emptyResearchStrategyState(), seen: [] });
assert.equal(result.trained, 0, 'subjective taxonomy must not bootstrap source trust');

console.log('Cold-start trust calibration self-test: PASS');
console.log('primary + independent corroboration bootstrap: PASS');
console.log('four-secondary bootstrap: PASS');
console.log('two-secondary bootstrap: BLOCKED');
console.log('conflicted-field calibration: BLOCKED');
console.log('subjective taxonomy calibration: BLOCKED');
console.log('repeat calibration inflation: BLOCKED');
