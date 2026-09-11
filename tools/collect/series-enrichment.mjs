import { applySeriesMetadata } from '../discovery/series-record.mjs';

function entryKey(entry) {
  return `${String(entry?.fileName || '')}\u0000${String(entry?.record?.id || '')}`;
}

function recordChanged(before, after, columns) {
  return columns.some((column) => String(before?.[column] || '') !== String(after?.[column] || ''));
}

export function applySeriesMetadataToCollection({
  originalExisting = [],
  workingExisting = [],
  selected = [],
  targetName = '',
  candidates = [],
  columns = []
} = {}) {
  const originals = new Map((Array.isArray(originalExisting) ? originalExisting : []).map((entry) => [entryKey(entry), entry.record]));
  const selectedEntries = (Array.isArray(selected) ? selected : []).map((record) => ({ fileName: targetName, record }));
  const entries = [...workingExisting, ...selectedEntries];
  const seriesStats = applySeriesMetadata(entries, candidates);
  const existingUpdates = [];

  for (const entry of workingExisting) {
    const before = originals.get(entryKey(entry));
    if (!before) throw new Error(`existing working record lost its source identity: ${entryKey(entry)}`);
    if (recordChanged(before, entry.record, columns)) {
      existingUpdates.push({ fileName: entry.fileName, record: { ...entry.record } });
    }
  }

  return { existingUpdates, seriesStats };
}
