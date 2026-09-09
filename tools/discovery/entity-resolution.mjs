import { normalizeTitleKey } from './html.mjs';
import { mergeEvidence, resolveEvidence } from './evidence.mjs';

function fact(candidate, field) {
  const value = candidate?.facts?.[field];
  return value?.status === 'confirmed' && value.value ? value : null;
}

function splitFactValues(candidate, field) {
  const item = fact(candidate, field);
  if (!item) return [];
  return String(item.value).split('|').map((value) => value.trim()).filter(Boolean);
}

function titleKeys(candidate) {
  const keys = new Set();
  const add = (value) => {
    const key = normalizeTitleKey(value);
    if (key) keys.add(key);
  };
  add(candidate?.title);
  for (const field of ['title_ja', 'title_kana', 'title_romaji', 'title_en']) {
    for (const value of splitFactValues(candidate, field)) add(value);
  }
  for (const value of splitFactValues(candidate, 'aliases')) add(value);
  return keys;
}

function confirmedAliases(candidate) {
  return new Set(splitFactValues(candidate, 'aliases').map(normalizeTitleKey).filter(Boolean));
}

function sameConfirmedScalar(left, right, field) {
  const a = fact(left, field);
  const b = fact(right, field);
  return Boolean(a && b && String(a.value) === String(b.value));
}

function sharesConfirmedValue(left, right, field) {
  const a = new Set(splitFactValues(left, field));
  const b = new Set(splitFactValues(right, field));
  return [...a].some((value) => b.has(value));
}

function originCompatible(left, right) {
  const a = left?.facts?.origin_country;
  const b = right?.facts?.origin_country;
  if (a?.status === 'conflict' || b?.status === 'conflict') return false;
  if (a?.value === 'OTHER' || b?.value === 'OTHER') return false;
  if (a?.status === 'confirmed' && b?.status === 'confirmed') return a.value === b.value;
  return true;
}

export function areCandidatesMergeable(left, right) {
  if (!left || !right) return false;
  const leftKey = normalizeTitleKey(left.title || left.key);
  const rightKey = normalizeTitleKey(right.title || right.key);
  if (!leftKey || !rightKey || leftKey === rightKey) return false;
  if (!originCompatible(left, right)) return false;

  const aliasLinked = confirmedAliases(left).has(rightKey) || confirmedAliases(right).has(leftKey);
  if (!aliasLinked) return false;

  if (!sameConfirmedScalar(left, right, 'media_type')) return false;
  const identityMatch = sameConfirmedScalar(left, right, 'release_start')
    || sameConfirmedScalar(left, right, 'theatrical_release_date')
    || sharesConfirmedValue(left, right, 'animation_studio')
    || sameConfirmedScalar(left, right, 'original_title');
  return identityMatch;
}

function titlePreference(candidate) {
  const confirmedJa = fact(candidate, 'title_ja')?.value || '';
  const title = confirmedJa || candidate.title || '';
  const japanese = /[ぁ-んァ-ヶ一-龠々]/.test(title) ? 100 : 0;
  return japanese + Math.min(50, candidate.sources?.length || 0);
}

function mergePair(left, right) {
  const primary = titlePreference(left) >= titlePreference(right) ? left : right;
  const secondary = primary === left ? right : left;
  const evidence = mergeEvidence(primary.evidence || [], secondary.evidence || []);
  const sources = [...new Set([...(primary.sources || []), ...(secondary.sources || [])])].slice(0, 50);
  return {
    key: normalizeTitleKey(primary.title || primary.key),
    title: primary.title,
    sources,
    evidence,
    facts: resolveEvidence(evidence),
    lastSeen: [primary.lastSeen, secondary.lastSeen].filter(Boolean).sort().at(-1) || ''
  };
}

export function resolveCandidateEntities(candidates = []) {
  const working = candidates.map((candidate) => ({
    ...candidate,
    evidence: mergeEvidence(candidate.evidence || []),
    facts: resolveEvidence(candidate.evidence || [])
  }));
  let merges = 0;
  let changed = true;

  while (changed) {
    changed = false;
    outer: for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        if (!areCandidatesMergeable(working[i], working[j])) continue;
        const merged = mergePair(working[i], working[j]);
        working.splice(j, 1);
        working.splice(i, 1, merged);
        merges += 1;
        changed = true;
        break outer;
      }
    }
  }

  return { candidates: working, merges };
}
