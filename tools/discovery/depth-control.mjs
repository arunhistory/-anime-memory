import { normalizeTitleKey } from './html.mjs';
import {
  candidateInformationReadiness,
  corroborationPriorityBoost
} from './research-completion.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';

function cleanHints(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeTitleKey(value))
    .filter(Boolean))];
}

function pendingCandidateIndex(state) {
  const pending = new Map();
  for (const candidate of Array.isArray(state?.candidates) ? state.candidates : []) {
    const identity = discoveryCandidateReadiness(candidate);
    if (!identity.ready) continue;
    if (candidateInformationReadiness(candidate).ready) continue;
    const key = normalizeTitleKey(candidate?.title || candidate?.key);
    if (key) pending.set(key, candidate);
  }
  return pending;
}

export function promoteCorroborationFrontier(state) {
  const pending = pendingCandidateIndex(state);
  let examined = 0;
  let promoted = 0;

  for (const entry of Array.isArray(state?.frontier) ? state.frontier : []) {
    const hints = cleanHints(entry?.candidateHints);
    if (!hints.length) continue;
    const candidates = hints.map((key) => pending.get(key)).filter(Boolean);
    if (!candidates.length) continue;
    examined += 1;

    let boost = 0;
    for (const candidate of candidates) {
      boost = Math.max(boost, corroborationPriorityBoost({ url: entry?.url, anchor: '' }, candidate, { allowBroad: true }));
    }
    if (boost <= 0) continue;
    if (Number(entry.priority || 0) < 1000) {
      entry.priority = 1000;
      promoted += 1;
    }
  }

  return {
    pendingCandidates: pending.size,
    examined,
    promoted
  };
}

export function buildInformationDepthPlan(state) {
  const pending = pendingCandidateIndex(state);

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
