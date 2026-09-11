import { createHash } from 'node:crypto';
import { sourceFamilyKey } from './source-family.mjs';
import { recordSourceTrustOutcome } from './research-strategy.mjs';

const CALIBRATION_FIELDS = new Set([
  'media_type', 'release_start', 'release_end', 'theatrical_release_date',
  'episode_count', 'runtime_min', 'season_number', 'origin_country',
  'original_type', 'original_title', 'original_author', 'original_artist',
  'original_publisher', 'original_label', 'original_magazine', 'original_platform',
  'animation_studio', 'co_animation_studio', 'animation_cooperation',
  'production_name', 'production_committee', 'production_members', 'production_lead_company',
  'planning', 'executive_producers', 'producers', 'animation_producers', 'line_producers',
  'director', 'chief_director', 'series_composition', 'character_original_design',
  'character_design', 'music', 'sound_director', 'music_production', 'soundtrack_label',
  'broadcast_networks', 'broadcast_slots', 'streaming_services', 'film_distributor',
  'staff', 'characters', 'opening_themes', 'ending_themes', 'insert_songs',
  'episodes', 'episode_staff', 'awards'
]);

function keyHash(parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

function clean(value) {
  return String(value || '').normalize('NFKC').trim();
}

function family(url) {
  return sourceFamilyKey(url) || String(url || '');
}

function buildCandidateGroups(candidate) {
  const byField = new Map();
  for (const item of Array.isArray(candidate?.evidence) ? candidate.evidence : []) {
    const field = String(item?.field || '');
    const value = clean(item?.value);
    const sourceUrl = String(item?.sourceUrl || '');
    if (!CALIBRATION_FIELDS.has(field) || !value || !sourceUrl) continue;
    if (!byField.has(field)) byField.set(field, new Map());
    const values = byField.get(field);
    if (!values.has(value)) values.set(value, { value, evidence: [], families: new Set(), primaryFamilies: new Set() });
    const bucket = values.get(value);
    const sourceFamily = family(sourceUrl);
    bucket.evidence.push(item);
    bucket.families.add(sourceFamily);
    if (item?.sourceClass === 'primary') bucket.primaryFamilies.add(sourceFamily);
  }
  return byField;
}

function isCalibrationConsensus(bucket) {
  const families = bucket?.families?.size || 0;
  const primaries = bucket?.primaryFamilies?.size || 0;
  return (primaries >= 1 && families >= 3) || families >= 4;
}

function hasMaterialCompetingValue(values, winner) {
  for (const bucket of values.values()) {
    if (bucket === winner) continue;
    if ((bucket.primaryFamilies?.size || 0) >= 1) return true;
    if ((bucket.families?.size || 0) >= 2) return true;
  }
  return false;
}

export function calibrateSourceTrustFromConsensus({
  candidates = [],
  strategyState,
  seen = [],
  observedAt = new Date().toISOString()
} = {}) {
  const seenSet = new Set((Array.isArray(seen) ? seen : []).map(String));
  let trained = 0;
  let consensusFields = 0;
  let conflictedFieldsSkipped = 0;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateKey = clean(candidate?.key || candidate?.title);
    if (!candidateKey) continue;
    const byField = buildCandidateGroups(candidate);

    for (const [field, values] of byField) {
      const winners = [...values.values()]
        .filter(isCalibrationConsensus)
        .sort((a, b) => b.primaryFamilies.size - a.primaryFamilies.size || b.families.size - a.families.size || b.evidence.length - a.evidence.length);
      if (winners.length !== 1) {
        if (winners.length > 1) conflictedFieldsSkipped += 1;
        continue;
      }
      const winner = winners[0];
      if (hasMaterialCompetingValue(values, winner)) {
        conflictedFieldsSkipped += 1;
        continue;
      }

      consensusFields += 1;
      for (const item of winner.evidence) {
        const observationId = keyHash(['calibration-v1', candidateKey, field, winner.value, item.sourceUrl]);
        if (seenSet.has(observationId)) continue;
        recordSourceTrustOutcome(strategyState, {
          sourceUrl: item.sourceUrl,
          field,
          outcome: 'match',
          strength: 'weak',
          observedAt
        });
        seenSet.add(observationId);
        trained += 1;
      }
    }
  }

  return {
    trained,
    consensusFields,
    conflictedFieldsSkipped,
    seen: [...seenSet]
  };
}

export function calibrationFieldAllowed(field) {
  return CALIBRATION_FIELDS.has(String(field || ''));
}
