import crypto from 'node:crypto';
import { normalizeText, splitEscapedRaw } from '../normalize/record.mjs';
import { sourceFamilyKey } from './source-family.mjs';
import { candidateInformationReadiness } from './research-completion.mjs';

const IDENTITY_CORROBORATORS = ['release_start', 'theatrical_release_date', 'animation_studio'];
const PROTECTED_COLUMNS = new Set(['id', 'synopsis', 'updated_at']);
const LEARNED_CORE_MIN_CONFIDENCE = 82;
const LEARNED_CORE_MIN_SAMPLES = 40;
const LEARNED_CORE_MIN_DIRECTNESS = 90;

function emptyRecord(columns) {
  return Object.fromEntries(columns.map((column) => [column, '']));
}

function discoveryExternalId(candidate) {
  const key = String(candidate?.key || '').normalize('NFKC').trim();
  if (!key) return '';
  return `discovery-key::${crypto.createHash('sha256').update(key).digest('hex')}`;
}

function valueMatchesFact(evidenceValue, factValue) {
  const target = String(evidenceValue || '').normalize('NFKC').trim();
  return String(factValue || '').split('|').some((value) => value.normalize('NFKC').trim() === target);
}

function titleMatchesFact(evidenceValue, factValue) {
  const target = normalizeText(evidenceValue);
  return Boolean(target) && String(factValue || '').split('|').some((value) => normalizeText(value) === target);
}

function usableIdentityFamily(sourceUrl) {
  const family = sourceFamilyKey(sourceUrl);
  if (!family || ['google.com', 'google.co.jp', 'bing.com'].includes(family)) return '';
  return family;
}

function matchingEvidence(candidate, field, fact) {
  return (candidate?.evidence || []).filter((item) => item?.field === field
    && (field === 'title_ja' ? titleMatchesFact(item.value, fact?.value) : valueMatchesFact(item.value, fact?.value)));
}

function independentlyIdentifiedCore(candidate) {
  const origin = candidate?.facts?.origin_country;
  const title = candidate?.facts?.title_ja;
  const media = candidate?.facts?.media_type;
  if (!origin || origin.status === 'conflict' || origin.value !== 'JP') return false;
  if (!title || title.status === 'conflict' || !title.value) return false;
  if (!media || media.status === 'conflict' || !media.value) return false;

  const originEvidence = matchingEvidence(candidate, 'origin_country', origin);
  const titleEvidence = matchingEvidence(candidate, 'title_ja', title);
  const mediaEvidence = matchingEvidence(candidate, 'media_type', media);
  const titleFamilies = new Set(titleEvidence.map((item) => usableIdentityFamily(item.sourceUrl)).filter(Boolean));
  const directJapaneseOrigin = originEvidence.some((item) => Number(item.directness || 0) >= 95 && item.rule === 'origin-country-labeled-japan');
  const directMediaType = mediaEvidence.some((item) => Number(item.directness || 0) >= 90);
  return directJapaneseOrigin && directMediaType && titleFamilies.size >= 2;
}

function learnedStructuredCore(candidate) {
  const origin = candidate?.facts?.origin_country;
  const title = candidate?.facts?.title_ja;
  const media = candidate?.facts?.media_type;
  if (origin?.status !== 'confirmed' || origin.value !== 'JP') return false;
  if (title?.status !== 'confirmed' || !title.value || media?.status !== 'confirmed' || !media.value) return false;

  for (const [field, fact] of [['title_ja', title], ['media_type', media]]) {
    if (Number(fact.confidence || 0) < LEARNED_CORE_MIN_CONFIDENCE) return false;
    if (Number(fact.trainingSamples || 0) < LEARNED_CORE_MIN_SAMPLES) return false;
    if (!matchingEvidence(candidate, field, fact).some((item) => Number(item.directness || 0) >= LEARNED_CORE_MIN_DIRECTNESS)) return false;
  }

  return IDENTITY_CORROBORATORS.some((field) => {
    const fact = candidate?.facts?.[field];
    return fact?.status === 'confirmed' && Boolean(fact.value);
  });
}

function criticalEvidenceFamilies(candidate, corroboratorField = '') {
  const criticalFields = new Set(['title_ja', 'origin_country', 'media_type']);
  if (corroboratorField) criticalFields.add(corroboratorField);
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
  if (independentlyIdentifiedCore(candidate)) return { ready: true, reason: '', recordLevelCore: true };
  if (learnedStructuredCore(candidate)) return { ready: true, reason: '', learnedStructuredCore: true };
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
  const independentCore = title.hostCount >= 2
    && media.hostCount >= 2
    && criticalEvidenceFamilies(candidate).size >= 2;
  if (!corroboratorFields.length && !independentCore) return { ready: false, reason: 'identity-corroborator-not-confirmed' };
  if (corroboratorFields.length && !independentCore && !corroboratorFields.some((field) => criticalEvidenceFamilies(candidate, field).size >= 2)) {
    return { ready: false, reason: 'independent-source-family-not-confirmed' };
  }
  return { ready: true, reason: '' };
}

function seriesExpansionReadiness(candidate, expandedSeriesRefs = []) {
  const ref = String(candidate?.series?.ref || '').trim();
  if (!ref) return { ready: true, reason: '' };
  const expanded = new Set((Array.isArray(expandedSeriesRefs) ? expandedSeriesRefs : []).map((value) => String(value || '').trim()).filter(Boolean));
  if (!expanded.has(ref)) return { ready: false, reason: 'series-not-expanded' };
  return { ready: true, reason: '' };
}

export function publishableDiscoveryReadiness(candidate, { expandedSeriesRefs = [] } = {}) {
  const identity = discoveryCandidateReadiness(candidate);
  if (!identity.ready) return identity;
  const series = seriesExpansionReadiness(candidate, expandedSeriesRefs);
  if (!series.ready) return { ...series, identityReady: true };
  const information = candidateInformationReadiness(candidate);
  if (!information.ready) return { ...information, identityReady: true, seriesReady: true };
  return { ...identity, information, ready: true, reason: '' };
}

function mergeExternalIds(current, discoveryId) {
  const values = [];
  const seen = new Set();
  for (const raw of [...splitEscapedRaw(current || '', '|'), discoveryId]) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values.join('|');
}

export function candidateToCommonRecord(candidate, columns, confirmedDate) {
  const readiness = discoveryCandidateReadiness(candidate);
  if (!readiness.ready) return null;
  const record = emptyRecord(columns);

  for (const [field, fact] of Object.entries(candidate.facts || {})) {
    if (!columns.includes(field) || PROTECTED_COLUMNS.has(field)) continue;
    const acceptedCore = (readiness.recordLevelCore || readiness.learnedStructuredCore) && ['title_ja', 'media_type'].includes(field);
    if ((fact?.status === 'confirmed' || acceptedCore) && fact.value) record[field] = String(fact.value);
  }

  if (columns.includes('external_ids')) record.external_ids = mergeExternalIds(record.external_ids, discoveryExternalId(candidate));
  if (columns.includes('synopsis')) record.synopsis = '';
  if (columns.includes('updated_at')) record.updated_at = String(confirmedDate || '').slice(0, 10);
  return record;
}

export function readyDiscoveryRecords(state, columns, confirmedDate) {
  const records = [];
  const skipped = [];
  const expandedSeriesRefs = state?.wikidataSeriesExpansion?.expandedRefs || [];
  for (const candidate of state?.candidates || []) {
    const readiness = publishableDiscoveryReadiness(candidate, { expandedSeriesRefs });
    if (!readiness.ready) {
      skipped.push({ key: candidate?.key || '', title: candidate?.title || '', reason: readiness.reason });
      continue;
    }
    const record = candidateToCommonRecord(candidate, columns, confirmedDate);
    if (record) records.push(record);
  }
  return { records, skipped };
}
