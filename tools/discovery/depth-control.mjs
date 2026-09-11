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
      if (boost <= 0) continue;
      if (!eligible.has(key)) eligible.set(key, { key, candidate, urls: new Set() });
      if (entry?.url) eligible.get(key).urls.add(entry.url);
    }
  }

  const focus = [...eligible.values()].sort(compareFocusCandidates)[0] || null;
  return { focus, examined };
}

function setEphemeralFrontierFocus(frontier, focusCandidateKey, focusUrls = []) {
  if (!Array.isArray(frontier)) return;
  Object.defineProperty(frontier, 'focusCandidateKey', {
    value: normalizeTitleKey(focusCandidateKey),
    writable: true,
    configurable: true,
    enumerable: false
  });
  Object.defineProperty(frontier, 'focusUrls', {
    value: new Set(focusUrls),
    writable: true,
    configurable: true,
    enumerable: false
  });
}

export function promoteCorroborationFrontier(state) {
  const pending = pendingCandidateIndex(state);
  if (state?.engineMode !== 'research') {
    setEphemeralFrontierFocus(state?.frontier, '', []);
    return {
      pendingCandidates: pending.size,
      examined: 0,
      promoted: 0,
      focusCandidate: '',
      focusCandidateKey: ''
    };
  }

  const selection = corroborationFocus(state, pending);
  const focus = selection.focus;
  const focusUrls = focus?.urls || new Set();

  setEphemeralFrontierFocus(state?.frontier, focus?.key || '', focusUrls);

  return {
    pendingCandidates: pending.size,
    examined: selection.examined,
    promoted: focusUrls.size,
    focusCandidate: focus?.candidate?.title || '',
    focusCandidateKey: focus?.key || ''
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
    pauseBootstrap: false
  };
}
