import crypto from 'node:crypto';
import { escapeVariable, splitEscapedRaw } from '../normalize/record.mjs';
import { normalizeTitleKey } from './html.mjs';
import { sanitizeSeriesKnowledge } from './series-learning.mjs';
import { normalizeUrl } from './url.mjs';

const RELATION_TYPES = new Set([
  'PREQUEL', 'SEQUEL', 'SPINOFF', 'MOVIE', 'OVA', 'ONA', 'SPECIAL',
  'REMAKE', 'REBOOT', 'COMPILATION', 'ALTERNATIVE', 'OTHER'
]);

export function discoveryExternalIdForKey(key) {
  const normalized = String(key || '').normalize('NFKC').trim();
  if (!normalized) return '';
  return `discovery-key::${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

export function seriesIdForRef(ref) {
  const normalized = normalizeUrl(ref);
  if (!normalized) return '';
  return `S${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

function relationValue(kind, targetId) {
  const normalizedKind = String(kind || '').toUpperCase();
  const normalizedTarget = String(targetId || '');
  if (!RELATION_TYPES.has(normalizedKind) || !/^A\d{8}$/.test(normalizedTarget)) return '';
  return `${escapeVariable(normalizedKind)}::${escapeVariable(normalizedTarget)}`;
}

function discoveryIds(record) {
  return splitEscapedRaw(record?.external_ids || '', '|').filter((value) => /^discovery-key::[a-f0-9]{64}$/.test(value));
}

function uniqueRecordByDiscoveryId(entries) {
  const map = new Map();
  const ambiguous = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const id of discoveryIds(entry?.record)) {
      if (map.has(id)) {
        ambiguous.add(id);
        continue;
      }
      map.set(id, entry);
    }
  }
  for (const id of ambiguous) map.delete(id);
  return { map, ambiguous };
}

export function applySeriesMetadata(entries, candidates) {
  const records = Array.isArray(entries) ? entries : [];
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const { map: recordsByDiscoveryId, ambiguous } = uniqueRecordByDiscoveryId(records);
  const candidatesByTitleKey = new Map();
  for (const candidate of candidateList) {
    const key = normalizeTitleKey(candidate?.title || candidate?.key);
    if (key && !candidatesByTitleKey.has(key)) candidatesByTitleKey.set(key, candidate);
  }

  const recordForCandidate = (candidate) => {
    const discoveryId = discoveryExternalIdForKey(candidate?.key);
    return discoveryId ? recordsByDiscoveryId.get(discoveryId) || null : null;
  };

  let seriesIdsAdded = 0;
  let seriesIdConflicts = 0;
  let relationsAdded = 0;
  let unresolvedRelations = 0;

  for (const candidate of candidateList) {
    const entry = recordForCandidate(candidate);
    if (!entry?.record) continue;
    const series = sanitizeSeriesKnowledge(candidate?.series);
    const seriesId = seriesIdForRef(series.ref);
    if (!seriesId) continue;
    if (!entry.record.series_id) {
      entry.record.series_id = seriesId;
      seriesIdsAdded += 1;
    } else if (entry.record.series_id !== seriesId) {
      seriesIdConflicts += 1;
    }
  }

  for (const candidate of candidateList) {
    const sourceEntry = recordForCandidate(candidate);
    if (!sourceEntry?.record || !/^A\d{8}$/.test(String(sourceEntry.record.id || ''))) continue;
    const sourceKey = normalizeTitleKey(candidate?.title || candidate?.key);
    const series = sanitizeSeriesKnowledge(candidate?.series);
    for (const edge of series.relations) {
      if (normalizeTitleKey(edge.sourceTitle) !== sourceKey) continue;
      const targetCandidate = candidatesByTitleKey.get(normalizeTitleKey(edge.targetTitle));
      const targetEntry = targetCandidate ? recordForCandidate(targetCandidate) : null;
      if (!targetEntry?.record || !/^A\d{8}$/.test(String(targetEntry.record.id || ''))) {
        unresolvedRelations += 1;
        continue;
      }
      if (targetEntry.record.id === sourceEntry.record.id) continue;
      const encoded = relationValue(edge.kind, targetEntry.record.id);
      if (!encoded) continue;
      const existing = splitEscapedRaw(sourceEntry.record.relations || '', '|').filter(Boolean);
      if (existing.includes(encoded)) continue;
      sourceEntry.record.relations = [...existing, encoded].join('|');
      relationsAdded += 1;
    }
  }

  return {
    seriesIdsAdded,
    seriesIdConflicts,
    relationsAdded,
    unresolvedRelations,
    ambiguousDiscoveryIds: ambiguous.size
  };
}
