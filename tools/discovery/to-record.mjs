import { sourceFamilyKey } from './source-family.mjs';

const IDENTITY_CORROBORATORS = ['release_start', 'theatrical_release_date', 'animation_studio'];
const PROTECTED_COLUMNS = new Set(['id', 'synopsis', 'updated_at']);

function emptyRecord(columns) {
  return Object.fromEntries(columns.map((column) => [column, '']));
}

function valueMatchesFact(evidenceValue, factValue) {
  const target = String(evidenceValue || '').normalize('NFKC').trim();
  return String(factValue || '').split('|').some((value) => value.normalize('NFKC').trim() === target);
}

function criticalEvidenceFamilies(candidate, corroboratorField) {
  const criticalFields = new Set(['title_ja', 'origin_country', 'media_type', corroboratorField]);
  const families = new Set();
  for (const item of candidate?.evidence || []) {
    if (!criticalFields.has(item?.field)) continue;
    const fact = candidate?.facts?.[item.field];
    if (fact?.status !== 'confirmed' || !valueMatchesFact(item.value, fact.value)) continue;
    const family = sourceFamilyKey(item.sourceUrl);
    if (family) families.add(family);
  }
  return families;
}

export function discoveryCandidateReadiness(candidate) {
  if (!candidate || typeof candidate !== 'object') return { ready: false, reason: 'candidate-missing' };

  const origin = candidate.facts?.origin_country;
  if (origin?.status === 'conflict') return { ready: false, reason: 'origin-country-conflict' };
  if (origin?.value === 'OTHER') return { ready: false, reason: 'non-japanese-origin' };
  if (origin?.status !== 'confirmed' || origin.value !== 'JP') {
    return { ready: false, reason: 'japanese-origin-not-confirmed' };
  }

  const title = candidate.facts?.title_ja;
  const media = candidate.facts?.media_type;
  if (title?.status !== 'confirmed' || !title.value) return { ready: false, reason: 'title-not-confirmed' };
  if (media?.status !== 'confirmed' || !media.value) return { ready: false, reason: 'media-type-not-confirmed' };

  const corroboratorFields = IDENTITY_CORROBORATORS.filter((field) => {
    const fact = candidate.facts?.[field];
    return fact?.status === 'confirmed' && Boolean(fact.value);
  });
  if (!corroboratorFields.length) return { ready: false, reason: 'identity-corroborator-not-confirmed' };
  if (!corroboratorFields.some((field) => criticalEvidenceFamilies(candidate, field).size >= 2)) {
    return { ready: false, reason: 'independent-source-family-not-confirmed' };
  }
  return { ready: true, reason: '' };
}

export function candidateToCommonRecord(candidate, columns, confirmedDate) {
  const readiness = discoveryCandidateReadiness(candidate);
  if (!readiness.ready) return null;
  const record = emptyRecord(columns);

  for (const [field, fact] of Object.entries(candidate.facts || {})) {
    if (!columns.includes(field) || PROTECTED_COLUMNS.has(field)) continue;
    if (fact?.status === 'confirmed' && fact.value) record[field] = String(fact.value);
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
