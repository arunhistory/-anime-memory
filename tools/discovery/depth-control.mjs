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

function focusRank(candidate) {
  const readiness = candidateInformationReadiness(candidate);
  return [
    Number(readiness.confirmedFields || 0),
    Number(readiness.groups || 0),
    Number(readiness.sourceFamilies || 0),
    Number(readiness.routes || 0),
    Number(readiness.pages || 0)
  ];
}

function compareFocusCandidates(left, right) {
  const a = focusRank(left.candidate);
  const b = focusRank(right.candidate);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return left.key.localeCompare(right.key, 'ja');
}

function corroborationFocus(state, pending) {
  const eligible = new Map();
  let examined = 0;

  for (const entry of Array.isArray(state?.frontier) ? state.frontier : []) {
    const hints = cleanHints(entry?.candidateHints);
    if (!hints.length) continue;
    for (const key of hints) {
      const candidate = pending.get(key);
      if (!candidate) continue;
      examined += 1;
      const boost = corroborationPriorityBoost({ url: entry?.url, anchor: '' }, candidate, { allowBroad: true });
      if (boost > 0) eligible.set(key, { key, candidate });
    }
  }

  const focus = [...eligible.values()].sort(compareFocusCandidates)[0] || null;
  return { focus, examined };
}

export function promoteCorroborationFrontier(state) {
  const pending = pendingCandidateIndex(state);
  const selection = corroborationFocus(state, pending);
  const focus = selection.focus;
  let promoted = 0;

  if (focus) {
    for (const entry of Array.isArray(state?.frontier) ? state.frontier : []) {
      const hints = cleanHints(entry?.candidateHints);
      if (!hints.includes(focus.key)) continue;
      const boost = corroborationPriorityBoost({ url: entry?.url, anchor: '' }, focus.candidate, { allowBroad: true });
      if (boost <= 0) continue;
      if (Number(entry.priority || 0) < 1000) {
        entry.priority = 1000;
        promoted += 1;
      }
    }
  }

  return {
    pendingCandidates: pending.size,
    examined: selection.examined,
    promoted,
    focusCandidate: focus?.candidate?.title || ''
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
