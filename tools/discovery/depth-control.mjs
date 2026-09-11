import { normalizeTitleKey } from './html.mjs';
import { candidateInformationReadiness } from './research-completion.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';

function cleanHints(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeTitleKey(value))
    .filter(Boolean))];
}

export function buildInformationDepthPlan(state) {
  const pending = new Set();
  for (const candidate of Array.isArray(state?.candidates) ? state.candidates : []) {
    const identity = discoveryCandidateReadiness(candidate);
    if (!identity.ready) continue;
    if (candidateInformationReadiness(candidate).ready) continue;
    const key = normalizeTitleKey(candidate?.title || candidate?.key);
    if (key) pending.add(key);
  }

  let actionableFrontier = 0;
  for (const entry of Array.isArray(state?.frontier) ? state.frontier : []) {
    const hints = cleanHints(entry?.candidateHints);
    if (hints.some((key) => pending.has(key))) actionableFrontier += 1;
  }

  return {
    pendingCandidates: pending.size,
    actionableFrontier,
    pauseBootstrap: pending.size > 0 && actionableFrontier > 0
  };
}
