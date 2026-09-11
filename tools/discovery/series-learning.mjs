import crypto from 'node:crypto';
import { normalizeTitleKey } from './html.mjs';

const MAX_PRIORITY_HINTS = 64;
const RELATION_TYPES = new Set([
  'PREQUEL', 'SEQUEL', 'SPINOFF', 'MOVIE', 'OVA', 'ONA', 'SPECIAL',
  'REMAKE', 'REBOOT', 'COMPILATION', 'ALTERNATIVE', 'OTHER'
]);
const SERIES_HINT_INDEX_KIND = 'series-hint-index-v1';

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
  return RELATION_TYPES.has(normalized) ? normalized : 'OTHER';
}

function relationKey(item) {
  return `${normalizeTitleKey(item.sourceTitle)}\u0000${relationKind(item.kind)}\u0000${normalizeTitleKey(item.targetTitle)}`;
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
    members: [],
    relations: []
  };
}

export function sanitizeSeriesKnowledge(value) {
  const result = emptySeriesKnowledge();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const ref = cleanUrl(value.ref);
  const title = cleanTitle(value.title);
  const inferredStem = cleanTitle(value.inferredStem || deriveSeriesStem(title));

  const memberSeen = new Set();
  const members = [];
  for (const item of Array.isArray(value.members) ? value.members : []) {
    const memberTitle = cleanTitle(item?.title);
    const key = normalizeTitleKey(memberTitle);
    if (!key || memberSeen.has(key)) continue;
    memberSeen.add(key);
    members.push({
      title: memberTitle,
      url: cleanUrl(item?.url),
      kind: relationKind(item?.kind)
    });
  }

  const relationSeen = new Set();
  const relations = [];
  for (const item of Array.isArray(value.relations) ? value.relations : []) {
    const sourceTitle = cleanTitle(item?.sourceTitle);
    const targetTitle = cleanTitle(item?.targetTitle);
    if (!sourceTitle || !targetTitle || normalizeTitleKey(sourceTitle) === normalizeTitleKey(targetTitle)) continue;
    const clean = { sourceTitle, targetTitle, kind: relationKind(item?.kind) };
    const key = relationKey(clean);
    if (relationSeen.has(key)) continue;
    relationSeen.add(key);
    relations.push(clean);
  }

  result.ref = ref;
  result.title = title;
  result.inferredStem = inferredStem;
  result.members = members;
  result.relations = relations;
  return result;
}

export function stableSeriesId(value) {
  const series = sanitizeSeriesKnowledge(value);
  const identity = series.ref || normalizeTitleKey(series.title || series.inferredStem);
  if (!identity) return '';
  return `S${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

export function mergeSeriesKnowledge(current, incoming) {
  const left = sanitizeSeriesKnowledge(current);
  const right = sanitizeSeriesKnowledge(incoming);
  const ref = left.ref || right.ref;
  const title = left.title || right.title;
  const inferredStem = left.inferredStem || right.inferredStem || deriveSeriesStem(title);

  const members = [];
  const memberSeen = new Set();
  for (const item of [...left.members, ...right.members]) {
    const key = normalizeTitleKey(item.title);
    if (!key || memberSeen.has(key)) continue;
    memberSeen.add(key);
    members.push(item);
  }

  const relations = [];
  const relationSeen = new Set();
  for (const item of [...left.relations, ...right.relations]) {
    const key = relationKey(item);
    if (!key || relationSeen.has(key)) continue;
    relationSeen.add(key);
    relations.push(item);
  }

  return { ref, title, inferredStem, members, relations };
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

function emptyStemNode() {
  return { children: new Map(), titles: new Set() };
}

function addMapTitle(map, key, title) {
  if (!key || !title) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(title);
}

function addStem(index, stem, title) {
  if (!stem || !title) return;
  let node = index.stemRoot;
  for (const char of stem) {
    if (!node.children.has(char)) node.children.set(char, emptyStemNode());
    node = node.children.get(char);
  }
  node.titles.add(title);
}

function isSeriesHintIndex(value) {
  return value?.kind === SERIES_HINT_INDEX_KIND
    && value.byRef instanceof Map
    && value.bySeriesTitle instanceof Map
    && value.stemRoot?.children instanceof Map;
}

export function addSeriesHintCandidate(index, candidate) {
  if (!isSeriesHintIndex(index) || !candidate) return index;
  const title = cleanTitle(candidate.title || candidate.key);
  const titleKey = normalizeTitleKey(title);
  if (!titleKey) return index;
  const knowledge = sanitizeSeriesKnowledge(candidate.series);
  const stem = normalizeTitleKey(deriveSeriesStem(title));
  const signature = `${titleKey}\u0000${knowledge.ref}\u0000${normalizeTitleKey(knowledge.title)}\u0000${stem}`;
  if (index.signatures.has(signature)) return index;
  index.signatures.add(signature);
  if (knowledge.ref) addMapTitle(index.byRef, knowledge.ref, title);
  const seriesTitleKey = normalizeTitleKey(knowledge.title);
  if (seriesTitleKey) addMapTitle(index.bySeriesTitle, seriesTitleKey, title);
  if (stem) addStem(index, stem, title);
  return index;
}

export function buildSeriesHintIndex(candidates = []) {
  const index = {
    kind: SERIES_HINT_INDEX_KIND,
    byRef: new Map(),
    bySeriesTitle: new Map(),
    stemRoot: emptyStemNode(),
    signatures: new Set()
  };
  for (const candidate of candidates || []) addSeriesHintCandidate(index, candidate);
  return index;
}

function addValues(target, values, limit = MAX_PRIORITY_HINTS) {
  for (const value of values || []) {
    if (target.length >= limit) return;
    target.push(value);
  }
}

function collectDescendantStemTitles(node, output, limit) {
  if (!node || output.length >= limit) return;
  addValues(output, node.titles, limit);
  if (output.length >= limit) return;
  for (const child of node.children.values()) {
    collectDescendantStemTitles(child, output, limit);
    if (output.length >= limit) return;
  }
}

function indexedRelatedTitles(candidate, index, limit = MAX_PRIORITY_HINTS) {
  if (!isSeriesHintIndex(index) || !candidate || limit <= 0) return [];
  const values = [];
  const knowledge = sanitizeSeriesKnowledge(candidate.series);
  if (knowledge.ref) addValues(values, index.byRef.get(knowledge.ref), limit);
  const seriesTitleKey = normalizeTitleKey(knowledge.title);
  if (seriesTitleKey) addValues(values, index.bySeriesTitle.get(seriesTitleKey), limit);
  if (values.length >= limit) return values;

  const stem = normalizeTitleKey(deriveSeriesStem(candidate.title || candidate.key));
  if (!stem) return values;
  let node = index.stemRoot;
  for (let position = 0; position < stem.length; position += 1) {
    node = node.children.get(stem[position]);
    if (!node) return values;
    const length = position + 1;
    if (length >= 6 && length < stem.length) addValues(values, node.titles, limit);
    if (values.length >= limit) return values;
  }
  if (stem.length >= 4) addValues(values, node.titles, limit);
  if (stem.length >= 6 && values.length < limit) {
    for (const child of node.children.values()) {
      collectDescendantStemTitles(child, values, limit);
      if (values.length >= limit) break;
    }
  }
  return values;
}

export function relatedSeriesHints(candidate, candidatesOrIndex = []) {
  if (!candidate) return [];
  const knowledge = sanitizeSeriesKnowledge(candidate.series);
  const values = [
    candidate.title,
    knowledge.title,
    knowledge.inferredStem,
    ...knowledge.members.map((item) => item.title),
    ...knowledge.relations.flatMap((item) => [item.sourceTitle, item.targetTitle])
  ];

  if (isSeriesHintIndex(candidatesOrIndex)) {
    addValues(values, indexedRelatedTitles(candidate, candidatesOrIndex, MAX_PRIORITY_HINTS), MAX_PRIORITY_HINTS * 2);
  } else {
    for (const other of Array.isArray(candidatesOrIndex) ? candidatesOrIndex : []) {
      if (!other || other === candidate) continue;
      if (sameSeriesByMetadata(candidate, other) || conservativeStemMatch(candidate.title, other.title)) values.push(other.title);
    }
  }

  const result = [];
  const seen = new Set();
  for (const value of values) {
    const title = cleanTitle(value);
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(title);
    if (result.length >= MAX_PRIORITY_HINTS) break;
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

export function ensureSeriesMemberShells(candidateMap, candidate, now = new Date().toISOString(), onAdd = null) {
  if (!(candidateMap instanceof Map) || !candidate) return 0;
  const knowledge = sanitizeSeriesKnowledge(candidate.series);
  const currentKey = normalizeTitleKey(candidate.title || candidate.key);
  let added = 0;
  for (const member of knowledge.members) {
    const key = normalizeTitleKey(member.title);
    if (!key || key === currentKey || candidateMap.has(key)) continue;
    const shell = {
      key,
      title: member.title,
      sources: [],
      evidence: [],
      facts: {},
      series: mergeSeriesKnowledge(knowledge, { members: [{ ...member }] }),
      research: {},
      lastSeen: now
    };
    candidateMap.set(key, shell);
    if (typeof onAdd === 'function') onAdd(shell);
    added += 1;
  }
  return added;
}
