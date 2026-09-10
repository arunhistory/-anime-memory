import path from 'node:path';
import { loadDiscoveryState } from './state.mjs';
import { candidateInformationReadiness, confirmedInformationFields } from './research-completion.mjs';
import { discoveryCandidateReadiness, publishableDiscoveryReadiness } from './to-record.mjs';

function increment(map, key) {
  const normalized = String(key || 'unknown');
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedCounts(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const root = process.cwd();
const state = loadDiscoveryState(path.join(root, 'crawler', 'state.json'));
const identityReasons = new Map();
const publishReasons = new Map();
let identityReady = 0;
let publishableReady = 0;
let seriesLearned = 0;
let confirmedInformationTotal = 0;
let informationReady = 0;

for (const candidate of state.candidates) {
  const identity = discoveryCandidateReadiness(candidate);
  if (identity.ready) identityReady += 1;
  else increment(identityReasons, identity.reason);

  const information = candidateInformationReadiness(candidate);
  if (information.ready) informationReady += 1;
  confirmedInformationTotal += confirmedInformationFields(candidate).length;

  const publishable = publishableDiscoveryReadiness(candidate);
  if (publishable.ready) publishableReady += 1;
  else increment(publishReasons, publishable.reason);

  const series = candidate?.series;
  if (series?.ref || series?.title || (Array.isArray(series?.members) && series.members.length > 1)) seriesLearned += 1;
}

const total = state.candidates.length;
const report = {
  candidates: total,
  identityReady,
  identityReadyRate: total ? Number((identityReady / total).toFixed(4)) : 0,
  informationReady,
  publishableReady,
  publishableReadyRate: total ? Number((publishableReady / total).toFixed(4)) : 0,
  averageConfirmedInformationFields: total ? Number((confirmedInformationTotal / total).toFixed(2)) : 0,
  seriesLearned,
  seriesLearnedRate: total ? Number((seriesLearned / total).toFixed(4)) : 0,
  identityBlockedReasons: sortedCounts(identityReasons),
  publicationBlockedReasons: sortedCounts(publishReasons)
};

console.log('Anime research readiness report');
console.log(JSON.stringify(report, null, 2));
