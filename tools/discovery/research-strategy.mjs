import { sourceFamilyKey } from './source-family.mjs';

const ROUTE_FIELDS = new Map([
  ['staff', ['director', 'chief_director', 'series_composition', 'character_design', 'animation_studio', 'staff']],
  ['character', ['characters']],
  ['streaming', ['streaming_services']],
  ['broadcast', ['broadcast_networks', 'broadcast_slots', 'release_start']],
  ['music', ['opening_themes', 'ending_themes', 'insert_songs', 'music', 'music_production', 'soundtrack_label']],
  ['original', ['original_type', 'original_title', 'original_author', 'original_artist', 'original_publisher', 'original_label', 'original_magazine', 'original_platform']],
  ['episode', ['episode_count', 'runtime_min', 'episodes', 'episode_staff']],
  ['production', ['animation_studio', 'co_animation_studio', 'animation_cooperation', 'production_name', 'production_committee', 'production_members', 'production_lead_company', 'producers', 'animation_producers']],
  ['official', ['official_url', 'official_x', 'official_youtube', 'official_other']],
  ['news', []],
  ['works', []],
  ['general', []]
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizedText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ja');
}

export function researchRouteKind(url, anchor = '') {
  const haystack = `${normalizedText(url)} ${normalizedText(anchor)}`;
  const rules = [
    ['staff', /(?:\/|\b)(?:staff|cast-staff|staffcast)(?:\/|\b)|スタッフ|監督|シリーズ構成/],
    ['character', /(?:\/|\b)(?:character|characters|chara)(?:\/|\b)|キャラクター|キャスト|声優/],
    ['streaming', /(?:\/|\b)(?:stream|streaming|vod|delivery)(?:\/|\b)|配信|見放題|独占/],
    ['broadcast', /(?:\/|\b)(?:onair|broadcast|schedule)(?:\/|\b)|放送|放映|オンエア/],
    ['music', /(?:\/|\b)(?:music|song|theme)(?:\/|\b)|主題歌|音楽|オープニング|エンディング/],
    ['original', /(?:\/|\b)(?:original|novel|comic|manga)(?:\/|\b)|原作|原作者|出版社|レーベル|連載/],
    ['episode', /(?:\/|\b)(?:episode|episodes|story)(?:\/|\b)|エピソード|各話|あらすじ|第\d+話/],
    ['production', /(?:\/|\b)(?:studio|production|company)(?:\/|\b)|制作会社|アニメーション制作|製作委員会/],
    ['official', /(?:official|公式)/],
    ['news', /(?:\/|\b)(?:news|article|press|topics?)(?:\/|\b)|ニュース|記事|発表/],
    ['works', /(?:\/|\b)(?:works|titles?|products?)(?:\/|\b)|作品一覧|作品情報/]
  ];
  for (const [kind, regex] of rules) if (regex.test(haystack)) return kind;
  return 'general';
}

export function emptyResearchStrategyState() {
  return {
    version: 1,
    operations: {},
    updatedAt: ''
  };
}

function safeCount(value) {
  return Math.max(0, Math.min(1_000_000_000, Math.trunc(Number(value) || 0)));
}

export function sanitizeResearchStrategyState(input) {
  const state = emptyResearchStrategyState();
  if (!input || input.version !== 1 || typeof input.operations !== 'object' || Array.isArray(input.operations)) return state;
  const entries = Object.entries(input.operations).slice(0, 10000);
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const cleanKey = String(key || '').slice(0, 300);
    if (!cleanKey) continue;
    state.operations[cleanKey] = {
      attempts: safeCount(value.attempts),
      fetched: safeCount(value.fetched),
      evidencePages: safeCount(value.evidencePages),
      evidenceClaims: safeCount(value.evidenceClaims),
      failures: safeCount(value.failures),
      blocked: safeCount(value.blocked),
      lastUpdated: String(value.lastUpdated || '').slice(0, 40)
    };
  }
  state.updatedAt = String(input.updatedAt || '').slice(0, 40);
  return state;
}

function operationKey(url, anchor = '') {
  const family = sourceFamilyKey(url) || 'unknown';
  const route = researchRouteKind(url, anchor);
  return `${family}\u0000${route}`;
}

export function recordResearchOperation(strategyState, {
  url,
  anchor = '',
  fetched = false,
  evidenceClaims = 0,
  failed = false,
  blocked = false,
  observedAt = new Date().toISOString()
} = {}) {
  const state = strategyState && strategyState.version === 1 ? strategyState : emptyResearchStrategyState();
  const key = operationKey(url, anchor);
  const current = state.operations[key] || {
    attempts: 0,
    fetched: 0,
    evidencePages: 0,
    evidenceClaims: 0,
    failures: 0,
    blocked: 0,
    lastUpdated: ''
  };
  current.attempts += 1;
  if (fetched) current.fetched += 1;
  if (Number(evidenceClaims) > 0) current.evidencePages += 1;
  current.evidenceClaims += Math.max(0, Math.trunc(Number(evidenceClaims) || 0));
  if (failed) current.failures += 1;
  if (blocked) current.blocked += 1;
  current.lastUpdated = String(observedAt || '').slice(0, 40);
  state.operations[key] = current;
  state.updatedAt = current.lastUpdated;
  return state;
}

function evidenceValueMatchesFact(evidenceValue, factValue) {
  const target = String(evidenceValue || '');
  const fact = String(factValue || '');
  if (!target || !fact) return false;
  if (target === fact) return true;
  return fact.split('|').includes(target);
}

function evidenceProfileKey(sourceUrl, field) {
  const family = sourceFamilyKey(sourceUrl) || 'unknown';
  const route = researchRouteKind(sourceUrl);
  return `${family}\u0000${route}\u0000${String(field || '')}`;
}

function aggregateProfileKey(sourceUrl) {
  const family = sourceFamilyKey(sourceUrl) || 'unknown';
  const route = researchRouteKind(sourceUrl);
  return `${family}\u0000${route}`;
}

function addEvidenceProfile(map, key, item, fact) {
  if (!key) return;
  const profile = map.get(key) || {
    evidence: 0,
    primary: 0,
    confirmedMatches: 0,
    observed: 0,
    conflicts: 0
  };
  profile.evidence += 1;
  if (item?.sourceClass === 'primary') profile.primary += 1;
  if (fact?.status === 'confirmed' && evidenceValueMatchesFact(item?.value, fact?.value)) profile.confirmedMatches += 1;
  else if (fact?.status === 'conflict') profile.conflicts += 1;
  else profile.observed += 1;
  map.set(key, profile);
}

function credibilityFromProfile(profile) {
  if (!profile || profile.evidence <= 0) return 0.5;
  const positive = profile.confirmedMatches * 4 + profile.primary * 2 + profile.observed * 0.5;
  const negative = profile.conflicts * 4;
  return clamp((3 + positive) / (6 + positive + negative), 0.05, 0.98);
}

function efficiencyFromOperation(op) {
  if (!op || op.attempts <= 0) return 0.5;
  const fetchRate = (op.fetched + 1) / (op.attempts + 2);
  const yieldRate = (op.evidencePages + 1) / (Math.max(op.fetched, 0) + 2);
  const failurePenalty = (op.failures + op.blocked) / Math.max(1, op.attempts);
  return clamp(fetchRate * 0.5 + yieldRate * 0.5 - failurePenalty * 0.35, 0.05, 0.95);
}

export function buildResearchStrategyModel(state) {
  const strategy = sanitizeResearchStrategyState(state?.researchStrategy);
  const fieldProfiles = new Map();
  const aggregateProfiles = new Map();

  for (const candidate of Array.isArray(state?.candidates) ? state.candidates : []) {
    const facts = candidate?.facts && typeof candidate.facts === 'object' ? candidate.facts : {};
    for (const item of Array.isArray(candidate?.evidence) ? candidate.evidence : []) {
      if (!item?.sourceUrl || !item?.field) continue;
      const fact = facts[item.field];
      addEvidenceProfile(fieldProfiles, evidenceProfileKey(item.sourceUrl, item.field), item, fact);
      addEvidenceProfile(aggregateProfiles, aggregateProfileKey(item.sourceUrl), item, fact);
    }
  }

  return { strategy, fieldProfiles, aggregateProfiles };
}

function operationFor(model, url, anchor = '') {
  return model?.strategy?.operations?.[operationKey(url, anchor)] || null;
}

function profileFor(model, url, field = '') {
  const family = sourceFamilyKey(url) || 'unknown';
  const route = researchRouteKind(url);
  if (field) return model?.fieldProfiles?.get(`${family}\u0000${route}\u0000${field}`) || null;
  return model?.aggregateProfiles?.get(`${family}\u0000${route}`) || null;
}

export function scoreResearchRoute(model, { url, anchor = '', desiredFields = [] } = {}) {
  if (!url) return { credibility: 50, efficiency: 50, fieldFitness: 50, score: 50, boost: 0 };
  const aggregate = profileFor(model, url);
  const credibility = credibilityFromProfile(aggregate);
  const operation = operationFor(model, url, anchor) || operationFor(model, url, '');
  const efficiency = efficiencyFromOperation(operation);

  const route = researchRouteKind(url, anchor);
  const inferredFields = ROUTE_FIELDS.get(route) || [];
  const targets = [...new Set([...(Array.isArray(desiredFields) ? desiredFields : []), ...inferredFields])];
  const fieldScores = targets
    .map((field) => profileFor(model, url, field))
    .filter(Boolean)
    .map(credibilityFromProfile);
  const fieldFitness = fieldScores.length
    ? fieldScores.reduce((sum, value) => sum + value, 0) / fieldScores.length
    : credibility;

  const attempts = operation?.attempts || 0;
  const explorationBonus = Math.min(0.08, 0.08 / Math.sqrt(attempts + 1));
  const combined = clamp(credibility * 0.5 + fieldFitness * 0.3 + efficiency * 0.2 + explorationBonus, 0, 1);
  const boost = Math.round((combined - 0.5) * 80);
  return {
    credibility: Math.round(credibility * 100),
    efficiency: Math.round(efficiency * 100),
    fieldFitness: Math.round(fieldFitness * 100),
    score: Math.round(combined * 100),
    boost
  };
}

export function summarizeResearchStrategy(model, limit = 10) {
  const rows = [];
  const keys = new Set([
    ...Object.keys(model?.strategy?.operations || {}),
    ...[...(model?.aggregateProfiles?.keys?.() || [])]
  ]);
  for (const key of keys) {
    const [family, route] = String(key).split('\u0000');
    if (!family || !route) continue;
    const synthetic = `https://${family}/${route}`;
    const scored = scoreResearchRoute(model, { url: synthetic });
    const op = model?.strategy?.operations?.[`${family}\u0000${route}`] || null;
    rows.push({
      family,
      route,
      credibility: scored.credibility,
      efficiency: scored.efficiency,
      score: scored.score,
      attempts: op?.attempts || 0
    });
  }
  return rows
    .sort((a, b) => b.score - a.score || b.attempts - a.attempts || a.family.localeCompare(b.family))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}
