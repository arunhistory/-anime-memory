import { normalizeTitleKey } from './html.mjs';

const MAX_SERIES_MEMBERS = 32;

function cleanTitle(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function relationKind(value) {
  const normalized = String(value || '').toUpperCase();
  return ['PREQUEL', 'SEQUEL', 'SPECIAL', 'MOVIE', 'OVA', 'ONA', 'SPINOFF', 'OTHER'].includes(normalized)
    ? normalized
    : 'OTHER';
}

export function deriveSeriesStem(title) {
  let value = cleanTitle(title);
  if (!value) return '';
  value = value
    .replace(/\s+(?:第\s*[0-9０-９一二三四五六七八九十]+\s*期)$/iu, '')
    .replace(/\s+(?:season\s*[0-9]+)$/iu, '')
    .replace(/\s+(?:[0-9]+(?:st|nd|rd|th)\s+season)$/iu, '')
    .replace(/\s+(?:final\s+season)$/iu, '')
    .replace(/\s+(?:part\s*[0-9]+)$/iu, '')
    .replace(/\s+(?:続章|完結編)$/u, '')
    .trim();
  return value;
}

export function emptySeriesKnowledge() {
  return {
    ref: '',
    title: '',
    inferredStem: '',
    members: []
  };
}

export function sanitizeSeriesKnowledge(value) {
  const result = emptySeriesKnowledge();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const ref = cleanUrl(value.ref);
  const title = cleanTitle(value.title);
  const inferredStem = cleanTitle(value.inferredStem || deriveSeriesStem(title));
  const seen = new Set();
  const members = [];
  for (const item of Array.isArray(value.members) ? value.members : []) {
    const memberTitle = cleanTitle(item?.title);
    const key = normalizeTitleKey(memberTitle);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    members.push({
      title: memberTitle,
      url: cleanUrl(item?.url),
      kind: relationKind(item?.kind)
    });
    if (members.length >= MAX_SERIES_MEMBERS) break;
  }
  result.ref = ref;
  result.title = title;
  result.inferredStem = inferredStem;
  result.members = members;
  return result;
}

export function mergeSeriesKnowledge(current, incoming) {
  const left = sanitizeSeriesKnowledge(current);
  const right = sanitizeSeriesKnowledge(incoming);
  const ref = left.ref || right.ref;
  const title = left.title || right.title;
  const inferredStem = left.inferredStem || right.inferredStem || deriveSeriesStem(title);
  const members = [];
  const seen = new Set();
  for (const item of [...left.members, ...right.members]) {
    const key = normalizeTitleKey(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    members.push(item);
    if (members.length >= MAX_SERIES_MEMBERS) break;
  }
  return { ref, title, inferredStem, members };
}

function sameSeriesByMetadata(left, right) {
  const a = sanitizeSeriesKnowledge(left?.series);
  const b = sanitizeSeriesKnowledge(right?.series);
  if (a.ref && b.ref && a.ref === b.ref) return true;
  const aTitle = normalizeTitleKey(a.title);
  const bTitle = normalizeTitleKey(b.title);
  return Boolean(aTitle && bTitle && aTitle === bTitle);
}

function conservativeStemMatch(leftTitle, rightTitle) {
  const leftStem = normalizeTitleKey(deriveSeriesStem(leftTitle));
  const rightStem = normalizeTitleKey(deriveSeriesStem(rightTitle));
  if (!leftStem || !rightStem) return false;
  if (leftStem === rightStem && leftStem.length >= 4) return true;
  const shorter = leftStem.length <= rightStem.length ? leftStem : rightStem;
  const longer = shorter === leftStem ? rightStem : leftStem;
  return shorter.length >= 6 && longer.startsWith(shorter);
}

export function relatedSeriesHints(candidate, candidates = []) {
  if (!candidate) return [];
  const knowledge = sanitizeSeriesKnowledge(candidate.series);
  const values = [candidate.title, knowledge.title, knowledge.inferredStem, ...knowledge.members.map((item) => item.title)];
  for (const other of Array.isArray(candidates) ? candidates : []) {
    if (!other || other === candidate) continue;
    if (sameSeriesByMetadata(candidate, other) || conservativeStemMatch(candidate.title, other.title)) values.push(other.title);
  }
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const title = cleanTitle(value);
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(title);
    if (result.length >= MAX_SERIES_MEMBERS) break;
  }
  return result;
}

export function seriesPriorityBoost(link, hints = []) {
  const haystack = `${String(link?.anchor || '')} ${String(link?.url || '')}`.normalize('NFKC').toLocaleLowerCase('ja');
  if (!haystack.trim()) return 0;
  let boost = 0;
  if (/(?:series|season|sequel|prequel|special|movie|ova|ona|作品|シリーズ|続編|前作|劇場版|特別編|第\s*[0-9０-９一二三四五六七八九十]+\s*期)/iu.test(haystack)) boost += 45;
  for (const hint of hints) {
    const key = normalizeTitleKey(hint);
    if (key.length >= 4 && normalizeTitleKey(haystack).includes(key)) {
      boost += 70;
      break;
    }
  }
  return Math.min(140, boost);
}

export function ensureSeriesMemberShells(candidateMap, candidate, now = new Date().toISOString()) {
  if (!(candidateMap instanceof Map) || !candidate) return 0;
  const knowledge = sanitizeSeriesKnowledge(candidate.series);
  const currentKey = normalizeTitleKey(candidate.title || candidate.key);
  let added = 0;
  for (const member of knowledge.members) {
    const key = normalizeTitleKey(member.title);
    if (!key || key === currentKey || candidateMap.has(key)) continue;
    candidateMap.set(key, {
      key,
      title: member.title,
      sources: member.url ? [member.url] : [],
      evidence: [],
      facts: {},
      series: mergeSeriesKnowledge(knowledge, { members: [{ ...member }] }),
      lastSeen: now
    });
    added += 1;
  }
  return added;
}
