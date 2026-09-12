import { normalizeUrl } from './url.mjs';
import { researchRouteKind } from './research-strategy.mjs';
import { sourceFamilyKey } from './source-family.mjs';

const MAX_RESEARCH_PAGES = 64;
const MAX_TRACKED_VALUES = 32;
const MAX_SEARCH_QUERIES = 128;

const GROUP_FIELDS = new Map([
  ['classification', ['genres', 'tags', 'target_demographic', 'setting', 'era', 'themes']],
  ['release', ['release_start', 'release_end', 'theatrical_release_date', 'episode_count', 'runtime_min', 'season_number']],
  ['original', ['original_type', 'original_title', 'original_author', 'original_artist', 'original_publisher', 'original_label', 'original_magazine', 'original_platform']],
  ['production', ['animation_studio', 'co_animation_studio', 'animation_cooperation', 'production_name', 'production_committee', 'production_members', 'production_lead_company', 'planning', 'executive_producers', 'producers', 'animation_producers', 'line_producers']],
  ['staff', ['director', 'chief_director', 'series_composition', 'character_original_design', 'character_design', 'sound_director', 'staff']],
  ['cast', ['characters']],
  ['music', ['opening_themes', 'ending_themes', 'insert_songs', 'music', 'music_production', 'soundtrack_label']],
  ['distribution', ['broadcast_networks', 'broadcast_slots', 'streaming_services', 'film_distributor']],
  ['episodes', ['episodes', 'episode_staff']],
  ['official', ['official_url', 'official_x', 'official_youtube', 'official_other']],
  ['recognition', ['awards']]
]);

const ROUTE_GROUPS = new Map([
  ['staff', ['staff']],
  ['character', ['cast']],
  ['streaming', ['distribution']],
  ['broadcast', ['distribution', 'release']],
  ['music', ['music']],
  ['original', ['original']],
  ['episode', ['episodes', 'release']],
  ['production', ['production']],
  ['official', ['official']],
  ['works', ['classification', 'release', 'official']]
]);

const IDENTITY_FIELDS = new Set(['title_ja', 'media_type', 'origin_country']);

function cleanList(values, max = MAX_TRACKED_VALUES) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
    .slice(-max);
}

export function emptyCandidateResearch() {
  return {
    pageUrls: [],
    routes: [],
    sourceFamilies: [],
    evidenceFields: [],
    searchQueries: [],
    noGainPages: 0,
    lastEvidenceAt: ''
  };
}

export function sanitizeCandidateResearch(value) {
  const output = emptyCandidateResearch();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  output.pageUrls = cleanList(value.pageUrls, MAX_RESEARCH_PAGES)
    .map((url) => normalizeUrl(url))
    .filter(Boolean);
  output.routes = cleanList(value.routes);
  output.sourceFamilies = cleanList(value.sourceFamilies);
  output.evidenceFields = cleanList(value.evidenceFields, 96);
  output.searchQueries = cleanList(value.searchQueries, MAX_SEARCH_QUERIES)
    .map((query) => query.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 300))
    .filter(Boolean);
  output.noGainPages = Math.max(0, Math.min(1000, Math.trunc(Number(value.noGainPages || 0))));
  output.lastEvidenceAt = String(value.lastEvidenceAt || '').slice(0, 40);
  return output;
}

export function mergeCandidateResearch(left, right) {
  const a = sanitizeCandidateResearch(left);
  const b = sanitizeCandidateResearch(right);
  const evidenceTimes = [a.lastEvidenceAt, b.lastEvidenceAt]
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort();
  return {
    pageUrls: cleanList([...a.pageUrls, ...b.pageUrls], MAX_RESEARCH_PAGES)
      .map((url) => normalizeUrl(url))
      .filter(Boolean),
    routes: cleanList([...a.routes, ...b.routes]),
    sourceFamilies: cleanList([...a.sourceFamilies, ...b.sourceFamilies]),
    evidenceFields: cleanList([...a.evidenceFields, ...b.evidenceFields], 96),
    searchQueries: cleanList([...a.searchQueries, ...b.searchQueries], MAX_SEARCH_QUERIES),
    noGainPages: Math.min(a.noGainPages, b.noGainPages),
    lastEvidenceAt: evidenceTimes.at(-1) || a.lastEvidenceAt || b.lastEvidenceAt || ''
  };
}

export function recordCandidateSearchQuery(current, query) {
  const research = sanitizeCandidateResearch(current);
  const clean = String(query || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!clean) return research;
  research.searchQueries = cleanList([...research.searchQueries, clean], MAX_SEARCH_QUERIES);
  return research;
}

export function recordCandidateResearch(current, {
  url,
  anchor = '',
  evidence = [],
  observedAt = new Date().toISOString()
} = {}) {
  const research = sanitizeCandidateResearch(current);
  const normalized = normalizeUrl(url);
  if (!normalized || research.pageUrls.includes(normalized)) return research;

  research.pageUrls = [...research.pageUrls, normalized].slice(-MAX_RESEARCH_PAGES);
  const route = researchRouteKind(normalized, anchor);
  research.routes = cleanList([...research.routes, route]);
  const family = sourceFamilyKey(normalized);
  if (family) research.sourceFamilies = cleanList([...research.sourceFamilies, family]);

  const fields = [...new Set((Array.isArray(evidence) ? evidence : [])
    .map((item) => String(item?.field || '').trim())
    .filter(Boolean))];
  if (fields.length) {
    research.evidenceFields = cleanList([...research.evidenceFields, ...fields], 96);
    research.noGainPages = 0;
    research.lastEvidenceAt = String(observedAt || '').slice(0, 40);
  } else {
    research.noGainPages += 1;
  }
  return research;
}

export function confirmedInformationFields(candidate) {
  return Object.entries(candidate?.facts || {})
    .filter(([field, fact]) => !IDENTITY_FIELDS.has(field) && fact?.status === 'confirmed' && Boolean(String(fact.value || '').trim()))
    .map(([field]) => field);
}

export function confirmedInformationGroups(candidate) {
  const confirmed = new Set(confirmedInformationFields(candidate));
  const groups = [];
  for (const [group, fields] of GROUP_FIELDS) {
    if (fields.some((field) => confirmed.has(field))) groups.push(group);
  }
  return groups;
}

export function candidateInformationReadiness(candidate) {
  const research = sanitizeCandidateResearch(candidate?.research);
  const confirmedFields = confirmedInformationFields(candidate);
  const groups = confirmedInformationGroups(candidate);
  const sourceFamilies = research.sourceFamilies.length;
  const routes = research.routes.filter((route) => route !== 'general').length;

  const informationRich = confirmedFields.length >= 12
    && groups.length >= 4
    && sourceFamilies >= 2;
  if (informationRich) {
    return {
      ready: true,
      reason: '',
      mode: 'information-rich',
      confirmedFields: confirmedFields.length,
      groups: groups.length,
      pages: research.pageUrls.length,
      routes,
      sourceFamilies
    };
  }

  const researchedToExhaustion = research.pageUrls.length >= 8
    && sourceFamilies >= 3
    && routes >= 4
    && confirmedFields.length >= 6
    && groups.length >= 3
    && research.noGainPages >= 2;
  if (researchedToExhaustion) {
    return {
      ready: true,
      reason: '',
      mode: 'researched-to-exhaustion',
      confirmedFields: confirmedFields.length,
      groups: groups.length,
      pages: research.pageUrls.length,
      routes,
      sourceFamilies
    };
  }

  let reason = 'information-research-incomplete';
  if (sourceFamilies < 2) reason = 'information-source-diversity-incomplete';
  else if (groups.length < 3) reason = 'information-category-coverage-incomplete';
  else if (confirmedFields.length < 6) reason = 'information-field-coverage-incomplete';
  return {
    ready: false,
    reason,
    mode: '',
    confirmedFields: confirmedFields.length,
    groups: groups.length,
    pages: research.pageUrls.length,
    routes,
    sourceFamilies
  };
}

export function informationPriorityBoost(link, candidate) {
  if (!candidate || candidateInformationReadiness(candidate).ready) return 0;
  const url = normalizeUrl(link?.url);
  if (!url) return 0;
  const route = researchRouteKind(url, link?.anchor || '');
  const targetGroups = ROUTE_GROUPS.get(route) || [];
  const covered = new Set(confirmedInformationGroups(candidate));
  let boost = targetGroups.some((group) => !covered.has(group)) ? 85 : 0;

  const research = sanitizeCandidateResearch(candidate?.research);
  const family = sourceFamilyKey(url);
  if (family && !research.sourceFamilies.includes(family)) boost += 25;
  if (research.pageUrls.includes(url)) return 0;
  return Math.min(110, boost);
}
