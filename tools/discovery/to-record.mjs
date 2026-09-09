const FACT_TO_COLUMN = new Map([
  ['title_ja', 'title_ja'],
  ['media_type', 'media_type'],
  ['release_start', 'release_start'],
  ['theatrical_release_date', 'theatrical_release_date'],
  ['animation_studio', 'animation_studio'],
  ['director', 'director'],
  ['series_composition', 'series_composition'],
  ['character_design', 'character_design'],
  ['music', 'music'],
  ['sound_director', 'sound_director']
]);

function emptyRecord(columns) {
  return Object.fromEntries(columns.map((column) => [column, '']));
}

export function discoveryCandidateReadiness(candidate) {
  if (!candidate || typeof candidate !== 'object') return { ready: false, reason: 'candidate-missing' };
  const title = candidate.facts?.title_ja;
  const media = candidate.facts?.media_type;
  if (title?.status !== 'confirmed' || !title.value) return { ready: false, reason: 'title-not-confirmed' };
  if (media?.status !== 'confirmed' || !media.value) return { ready: false, reason: 'media-type-not-confirmed' };
  return { ready: true, reason: '' };
}

export function candidateToCommonRecord(candidate, columns, confirmedDate) {
  const readiness = discoveryCandidateReadiness(candidate);
  if (!readiness.ready) return null;
  const record = emptyRecord(columns);

  for (const [factField, column] of FACT_TO_COLUMN) {
    if (!columns.includes(column)) continue;
    const fact = candidate.facts?.[factField];
    if (fact?.status === 'confirmed' && fact.value) record[column] = String(fact.value);
  }

  if (columns.includes('synopsis')) record.synopsis = '';
  if (columns.includes('updated_at')) record.updated_at = String(confirmedDate || '').slice(0, 10);
  return record;
}

export function readyDiscoveryRecords(state, columns, confirmedDate) {
  const records = [];
  const skipped = [];
  for (const candidate of state?.candidates || []) {
    const readiness = discoveryCandidateReadiness(candidate);
    if (!readiness.ready) {
      skipped.push({ key: candidate?.key || '', title: candidate?.title || '', reason: readiness.reason });
      continue;
    }
    const record = candidateToCommonRecord(candidate, columns, confirmedDate);
    if (record) records.push(record);
  }
  return { records, skipped };
}
