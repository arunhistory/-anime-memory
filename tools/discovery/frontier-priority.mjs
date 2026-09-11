import { hostKey } from './url.mjs';
import { researchRouteKind, scoreResearchRoute } from './research-strategy.mjs';

function groupKeyFor(url) {
  const host = hostKey(url);
  const route = researchRouteKind(url);
  return `${host}\u0000${route}`;
}

function better(left, right) {
  if (!right) return true;
  const leftPriority = Number(left?.priority || 0);
  const rightPriority = Number(right?.priority || 0);
  if (leftPriority !== rightPriority) return leftPriority > rightPriority;
  return Number(left?.sequence || 0) < Number(right?.sequence || 0);
}

function heapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!better(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function heapPop(heap) {
  if (!heap.length) return null;
  const first = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    heap[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < heap.length && better(heap[left], heap[best])) best = left;
      if (right < heap.length && better(heap[right], heap[best])) best = right;
      if (best === index) break;
      [heap[index], heap[best]] = [heap[best], heap[index]];
      index = best;
    }
  }
  return first;
}

function heapPeekCurrent(group, queued) {
  while (group.heap.length) {
    const head = group.heap[0];
    const current = queued.get(head.url);
    if (current && current === head.entry && Number(current.priority || 0) === head.priority) return head;
    heapPop(group.heap);
  }
  return null;
}

export function buildFrontierPriorityIndex(frontier = [], queued = new Map()) {
  const index = {
    groups: new Map(),
    sequenceByUrl: new Map(),
    nextSequence: 0,
    selectionStats: {
      pops: 0,
      groupEvaluations: 0,
      staleHeapEntriesDiscarded: 0
    }
  };
  for (const entry of frontier) {
    if (!entry?.url || queued.get(entry.url) !== entry) continue;
    addFrontierPriorityEntry(index, entry);
  }
  return index;
}

export function addFrontierPriorityEntry(index, entry) {
  if (!index?.groups || !entry?.url) return;
  let sequence = index.sequenceByUrl.get(entry.url);
  if (sequence === undefined) {
    sequence = index.nextSequence;
    index.nextSequence += 1;
    index.sequenceByUrl.set(entry.url, sequence);
  }
  const key = groupKeyFor(entry.url);
  if (!index.groups.has(key)) {
    index.groups.set(key, {
      key,
      host: hostKey(entry.url),
      representativeUrl: entry.url,
      heap: []
    });
  }
  heapPush(index.groups.get(key).heap, {
    url: entry.url,
    entry,
    priority: Number(entry.priority || 0),
    sequence
  });
}

export function touchFrontierPriorityEntry(index, entry) {
  addFrontierPriorityEntry(index, entry);
}

export function popBestFrontier(index, queued, trustModel, hostCounts = null, perHostLimit = Number.POSITIVE_INFINITY) {
  if (!index?.groups || !(queued instanceof Map) || queued.size === 0) return null;
  let best = null;
  let bestGroup = null;

  for (const group of index.groups.values()) {
    if (hostCounts instanceof Map && Number.isFinite(perHostLimit)) {
      if ((hostCounts.get(group.host) || 0) >= perHostLimit) continue;
    }
    const before = group.heap.length;
    const head = heapPeekCurrent(group, queued);
    index.selectionStats.staleHeapEntriesDiscarded += Math.max(0, before - group.heap.length);
    if (!head) continue;
    index.selectionStats.groupEvaluations += 1;
    const learnedBoost = scoreResearchRoute(trustModel, { url: group.representativeUrl }).boost;
    const score = Number(head.priority || 0) + learnedBoost;
    if (!best || score > best.score || (score === best.score && head.sequence < best.sequence)) {
      best = { ...head, score };
      bestGroup = group;
    }
  }

  if (!best || !bestGroup) return null;
  heapPop(bestGroup.heap);
  queued.delete(best.url);
  index.selectionStats.pops += 1;
  return best.entry;
}

export function compactFrontier(frontier = [], queued = new Map()) {
  return frontier.filter((entry) => entry?.url && queued.get(entry.url) === entry);
}
