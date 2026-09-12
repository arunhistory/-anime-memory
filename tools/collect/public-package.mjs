export const INITIAL_CSV_RECORD_LIMIT = 500;

export function takeInitialPackage(records, { requireSynopsis = false } = {}) {
  const source = Array.isArray(records) ? records : [];
  const publishable = requireSynopsis
    ? source.filter((record) => String(record?.synopsis || '').trim())
    : source;
  if (publishable.length < INITIAL_CSV_RECORD_LIMIT) return { selected: [], remaining: source };
  const selected = publishable.slice(0, INITIAL_CSV_RECORD_LIMIT);
  const selectedSet = new Set(selected);
  return {
    selected,
    remaining: source.filter((record) => !selectedSet.has(record))
  };
}
