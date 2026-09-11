import { normalizeTitleKey } from './html.mjs';
import { mergeEvidence, resolveEvidence } from './evidence.mjs';
import { mergeCandidateResearch } from './research-completion.mjs';
import { mergeSeriesKnowledge } from './series-learning.mjs';

function fact(candidate, field) {
  const value = candidate?.facts?.[field];
  return value?.status === 'confirmed' && value.value ? value : null;
}

function splitFactValues(candidate, field) {
  const item = fact(candidate, field);
  if (!item) return [];
  return String(item.value).split('|').map((value) => value.trim()).filter(Boolean);
}

function confirmedAliases(candidate) {
  return new Set(splitFactValues(candidate, 'aliases').map(normalizeTitleKey).filter(Boolean));
}

function sameConfirmedScalar(left, right, field) {
  const a = fact(left, field);
  const b = fact(right, field);
  return Boolean(a && b && String(a.value) === String(b.value));
}

function conflictingConfirmedScalar(left, right, field) {
  const a = fact(left, field);
  const b = fact(right, field);
  return Boolean(a && b && String(a.value) !== String(b.value));
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
  for (const field of ['release_start', 'theatrical_release_date', 'original_title']) {
    if (conflictingConfirmedScalar(left, right, field)) return false;
  }

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

function alternateTitleEvidence(primary, secondary) {
  const primaryKey = normalizeTitleKey(primary.title || primary.key);
  return (secondary.evidence || []).map((item) => {
    if (item.field !== 'title_ja') return item;
    if (normalizeTitleKey(item.value) === primaryKey) return item;
    return {
      ...item,
      field: 'aliases',
      rule: 'entity-resolution-title-alias'
    };
  });
}

function mergePair(left, right, resolveFacts) {
  const primary = titlePreference(left) >= titlePreference(right) ? left : right;
  const secondary = primary === left ? right : left;
  const evidence = mergeEvidence(primary.evidence || [], alternateTitleEvidence(primary, secondary));
  const sources = [...new Set([...(primary.sources || []), ...(secondary.sources || [])])].slice(0, 50);
  return {
    key: normalizeTitleKey(primary.title || primary.key),
    title: primary.title,
    sources,
    evidence,
    facts: resolveFacts(evidence),
    series: mergeSeriesKnowledge(primary.series, secondary.series),
    research: mergeCandidateResearch(primary.research, secondary.research),
    lastSeen: [primary.lastSeen, secondary.lastSeen].filter(Boolean).sort().at(-1) || ''
  };
}

function heapPush(heap, pair) {
  heap.push(pair);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const current = heap[index];
    const up = heap[parent];
    if (up.left < current.left || (up.left === current.left && up.right <= current.right)) break;
    heap[parent] = current;
    heap[index] = up;
    index = parent;
  }
}

function heapPop(heap) {
  if (!heap.length) return null;
  const first = heap[0];
  const last = heap.pop();
  if (!heap.length) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    let smallest = index;
    for (const child of [leftIndex, rightIndex]) {
      if (child >= heap.length) continue;
      const a = heap[child];
      const b = heap[smallest];
      if (a.left < b.left || (a.left === b.left && a.right < b.right)) smallest = child;
    }
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
  return first;
}

function addIndex(map, key, index) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(index);
}

function removeIndex(map, key, index) {
  const set = map.get(key);
  if (!set) return;
  set.delete(index);
  if (!set.size) map.delete(key);
}

export function resolveCandidateEntities(candidates = [], resolveFacts = resolveEvidence) {
  const resolver = typeof resolveFacts === 'function' ? resolveFacts : resolveEvidence;
  const nodes = candidates.map((candidate, index) => {
    const evidence = mergeEvidence(candidate.evidence || []);
    return {
      index,
      active: true,
      version: 0,
      candidate: {
        ...candidate,
        evidence,
        facts: resolver(evidence),
        series: mergeSeriesKnowledge({}, candidate.series)
      }
    };
  });

  const titleIndex = new Map();
  const reverseAliasIndex = new Map();
  for (const node of nodes) {
    addIndex(titleIndex, normalizeTitleKey(node.candidate.title || node.candidate.key), node.index);
    for (const alias of confirmedAliases(node.candidate)) addIndex(reverseAliasIndex, alias, node.index);
  }

  const heap = [];
  const queued = new Set();
  let pairChecks = 0;

  const schedulePair = (aIndex, bIndex) => {
    if (aIndex === bIndex) return;
    const left = Math.min(aIndex, bIndex);
    const right = Math.max(aIndex, bIndex);
    const a = nodes[left];
    const b = nodes[right];
    if (!a?.active || !b?.active) return;
    const key = `${left}:${a.version}:${right}:${b.version}`;
    if (queued.has(key)) return;
    pairChecks += 1;
    if (!areCandidatesMergeable(a.candidate, b.candidate)) return;
    queued.add(key);
    heapPush(heap, { left, right, leftVersion: a.version, rightVersion: b.version, key });
  };

  const scheduleNode = (index) => {
    const node = nodes[index];
    if (!node?.active) return;
    const titleKey = normalizeTitleKey(node.candidate.title || node.candidate.key);
    for (const alias of confirmedAliases(node.candidate)) {
      for (const target of titleIndex.get(alias) || []) schedulePair(index, target);
    }
    for (const source of reverseAliasIndex.get(titleKey) || []) schedulePair(index, source);
  };

  for (const node of nodes) scheduleNode(node.index);

  let merges = 0;
  while (heap.length) {
    const pair = heapPop(heap);
    queued.delete(pair.key);
    const leftNode = nodes[pair.left];
    const rightNode = nodes[pair.right];
    if (!leftNode?.active || !rightNode?.active) continue;
    if (leftNode.version !== pair.leftVersion || rightNode.version !== pair.rightVersion) continue;
    pairChecks += 1;
    if (!areCandidatesMergeable(leftNode.candidate, rightNode.candidate)) continue;

    const leftTitle = normalizeTitleKey(leftNode.candidate.title || leftNode.candidate.key);
    const rightTitle = normalizeTitleKey(rightNode.candidate.title || rightNode.candidate.key);
    removeIndex(titleIndex, leftTitle, leftNode.index);
    removeIndex(titleIndex, rightTitle, rightNode.index);

    const merged = mergePair(leftNode.candidate, rightNode.candidate, resolver);
    leftNode.candidate = merged;
    leftNode.version += 1;
    rightNode.active = false;
    rightNode.version += 1;
    merges += 1;

    const mergedTitle = normalizeTitleKey(merged.title || merged.key);
    addIndex(titleIndex, mergedTitle, leftNode.index);
    for (const alias of confirmedAliases(merged)) addIndex(reverseAliasIndex, alias, leftNode.index);
    scheduleNode(leftNode.index);
  }

  return {
    candidates: nodes.filter((node) => node.active).map((node) => node.candidate),
    merges,
    pairChecks
  };
}
