import { ADDITIONAL_MULTI_FIELDS } from './common-evidence.mjs';
import { STRUCTURED_MULTI_FIELDS } from './structured-evidence.mjs';
import { normalizeSourceClass } from './source-quality.mjs';
import { sourceFamilyKey } from './source-family.mjs';
import { scoreSourceCredibility } from './research-strategy.mjs';

const MULTI_VALUE_FIELDS = new Set([
  'genres',
  'animation_studio',
  'director',
  'series_composition',
  'character_design',
  'music',
  'sound_director',
  ...ADDITIONAL_MULTI_FIELDS,
  ...STRUCTURED_MULTI_FIELDS
]);
const LEARNED_SINGLE_SOURCE_MIN_CREDIBILITY = 82;
const LEARNED_SINGLE_SOURCE_MIN_SAMPLES = 40;
const LEARNED_SINGLE_SOURCE_MIN_DIRECTNESS = 90;
const PRIMARY_SINGLE_SOURCE_MIN_CREDIBILITY = 75;
const VERIFIED_PRIMARY_SINGLE_SOURCE_MIN_CREDIBILITY = 70;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function clean(value) {
  return String(value || '').normalize('NFKC').trim();
}

function evidenceDirectness(item) {
  if (Number.isFinite(Number(item?.directness))) return clamp(Number(item.directness), 0, 100);
  return normalizeSourceClass(item?.sourceClass) === 'primary' ? 100 : 55;
}

function legacyRuleDirectness(item) {
  const stored = evidenceDirectness(item);
  const rule = String(item?.rule || '');
  if (/^origin-country-labeled-/.test(rule)) return Math.max(stored, 92);
  if (/^event-date-/.test(rule)) return Math.max(stored, 84);
  if (/^label-/.test(rule)) return Math.max(stored, 88);
  return stored;
}

function scoreItem(model, item) {
  return scoreSourceCredibility(model, {
    sourceUrl: item?.sourceUrl,
    field: item?.field,
    sourceClass: normalizeSourceClass(item?.sourceClass),
    directness: evidenceDirectness(item)
  });
}

function buildAlternatives(evidence, model) {
  const byField = new Map();
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const field = String(item?.field || '');
    const value = clean(item?.value);
    const sourceUrl = String(item?.sourceUrl || '');
    if (!field || !value || !sourceUrl) continue;
    if (!byField.has(field)) byField.set(field, new Map());
    const values = byField.get(field);
    if (!values.has(value)) {
      values.set(value, {
        value,
        sources: new Set(),
        families: new Set(),
        primarySources: new Set(),
        verifiedPrimarySources: new Set(),
        trustedSecondaryFamilies: new Set(),
        neutralSecondaryFamilies: new Set(),
        directFamilies: new Set(),
        credibilityTotal: 0,
        credibilityMax: 0,
        evidenceCount: 0,
        trainingSamples: 0
      });
    }
    const bucket = values.get(value);
    const score = scoreItem(model, item);
    const credibility = Number(score.credibility || 0);
    const directness = legacyRuleDirectness(item);
    const family = sourceFamilyKey(sourceUrl) || sourceUrl;
    bucket.sources.add(sourceUrl);
    bucket.families.add(family);
    bucket.credibilityTotal += credibility;
    bucket.credibilityMax = Math.max(bucket.credibilityMax, credibility);
    bucket.evidenceCount += 1;
    bucket.trainingSamples = Math.max(bucket.trainingSamples, Number(score.samples || 0));
    if (directness >= LEARNED_SINGLE_SOURCE_MIN_DIRECTNESS) bucket.directFamilies.add(family);
    if (normalizeSourceClass(item?.sourceClass) === 'primary') {
      if (credibility >= 60) bucket.primarySources.add(sourceUrl);
      if (item?.verifiedPrimary === true) bucket.verifiedPrimarySources.add(sourceUrl);
    } else if (credibility >= 60) {
      bucket.trustedSecondaryFamilies.add(family);
    } else if (credibility >= 50) {
      bucket.neutralSecondaryFamilies.add(family);
    }
  }
  return byField;
}

function alternativeSummary(entry) {
  const average = entry.evidenceCount ? entry.credibilityTotal / entry.evidenceCount : 0;
  return {
    value: entry.value,
    sourceCount: entry.sources.size,
    hostCount: entry.families.size,
    primarySourceCount: entry.primarySources.size,
    verifiedPrimarySourceCount: entry.verifiedPrimarySources.size,
    trustedSecondaryCount: entry.trustedSecondaryFamilies.size,
    credibility: Math.round(average),
    maxCredibility: Math.round(entry.credibilityMax),
    evidenceCount: entry.evidenceCount,
    trainingSamples: Math.max(0, Math.trunc(Number(entry.trainingSamples || 0)))
  };
}

function isConfirmed(entry, field) {
  const summary = alternativeSummary(entry);
  if (summary.verifiedPrimarySourceCount >= 1 && summary.maxCredibility >= VERIFIED_PRIMARY_SINGLE_SOURCE_MIN_CREDIBILITY) return true;
  if (summary.primarySourceCount >= 1 && summary.maxCredibility >= PRIMARY_SINGLE_SOURCE_MIN_CREDIBILITY) return true;
  if (field === 'origin_country' && entry.directFamilies.size >= 1 && summary.maxCredibility >= 45) return true;
  if (entry.families.size >= 2) return true;
  if (summary.trustedSecondaryCount >= 2 && summary.credibility >= 65) return true;
  if (summary.trustedSecondaryCount >= 1 && summary.trustedSecondaryCount + entry.neutralSecondaryFamilies.size >= 3 && summary.credibility >= 60) return true;
  if (entry.directFamilies.size >= 1
    && summary.maxCredibility >= LEARNED_SINGLE_SOURCE_MIN_CREDIBILITY
    && summary.trainingSamples >= LEARNED_SINGLE_SOURCE_MIN_SAMPLES) return true;
  return false;
}

function isCredibleConflict(entry, field) {
  const summary = alternativeSummary(entry);
  return (field === 'origin_country' && entry.directFamilies.size >= 1)
    || entry.families.size >= 2
    || summary.maxCredibility >= 70
    || (summary.trustedSecondaryCount >= 2 && summary.credibility >= 60)
    || (entry.directFamilies.size >= 1
      && summary.maxCredibility >= LEARNED_SINGLE_SOURCE_MIN_CREDIBILITY
      && summary.trainingSamples >= LEARNED_SINGLE_SOURCE_MIN_SAMPLES);
}

function resolveMulti(field, values) {
  const entries = [...values.values()];
  const confirmed = entries.filter((entry) => isConfirmed(entry, field));
  const selected = confirmed.length
    ? confirmed
    : entries.filter((entry) => alternativeSummary(entry).maxCredibility >= 35);
  const valuesOut = selected.map((entry) => entry.value);
  const summaries = entries.map(alternativeSummary).sort((a, b) => b.credibility - a.credibility || b.sourceCount - a.sourceCount || a.value.localeCompare(b.value));
  const selectedSummaries = summaries.filter((item) => valuesOut.includes(item.value));
  const confidence = selectedSummaries.length
    ? Math.round(selectedSummaries.reduce((sum, item) => sum + item.credibility, 0) / selectedSummaries.length)
    : 0;
  const trainingSamples = selectedSummaries.reduce((max, item) => Math.max(max, Number(item.trainingSamples || 0)), 0);
  return {
    status: confirmed.length ? 'confirmed' : 'observed',
    value: valuesOut.join('|'),
    sourceCount: new Set(selected.flatMap((entry) => [...entry.sources])).size,
    hostCount: new Set(selected.flatMap((entry) => [...entry.families])).size,
    primarySourceCount: selected.reduce((sum, entry) => sum + entry.primarySources.size, 0),
    confidence,
    trainingSamples,
    alternatives: summaries.filter((item) => !valuesOut.includes(item.value)).slice(0, 10)
  };
}

function resolveScalar(field, values) {
  const entries = [...values.values()];
  const confirmed = entries.filter((entry) => isConfirmed(entry, field));
  const credible = entries.filter((entry) => isCredibleConflict(entry, field));
  const summaries = entries.map(alternativeSummary).sort((a, b) => b.credibility - a.credibility || b.sourceCount - a.sourceCount || a.value.localeCompare(b.value));

  if (confirmed.length === 1 && credible.filter((entry) => entry !== confirmed[0]).length === 0) {
    const summary = alternativeSummary(confirmed[0]);
    return {
      status: 'confirmed',
      value: confirmed[0].value,
      sourceCount: summary.sourceCount,
      hostCount: summary.hostCount,
      primarySourceCount: summary.primarySourceCount,
      confidence: summary.credibility,
      trainingSamples: summary.trainingSamples,
      alternatives: summaries.filter((item) => item.value !== confirmed[0].value).slice(0, 5)
    };
  }

  if (confirmed.length > 1 || credible.length > 1) {
    return {
      status: 'conflict',
      value: '',
      sourceCount: summaries[0]?.sourceCount || 0,
      hostCount: summaries[0]?.hostCount || 0,
      primarySourceCount: summaries[0]?.primarySourceCount || 0,
      confidence: summaries[0]?.credibility || 0,
      trainingSamples: summaries[0]?.trainingSamples || 0,
      alternatives: summaries.slice(0, 5)
    };
  }

  const best = summaries[0];
  return {
    status: 'observed',
    value: best?.value || '',
    sourceCount: best?.sourceCount || 0,
    hostCount: best?.hostCount || 0,
    primarySourceCount: best?.primarySourceCount || 0,
    confidence: best?.credibility || 0,
    trainingSamples: best?.trainingSamples || 0,
    alternatives: summaries.slice(1, 5)
  };
}

export function resolveEvidenceWithTrust(evidence = [], model) {
  const byField = buildAlternatives(evidence, model);
  const facts = {};
  for (const [field, values] of byField) {
    facts[field] = MULTI_VALUE_FIELDS.has(field) ? resolveMulti(field, values) : resolveScalar(field, values);
  }
  return facts;
}
