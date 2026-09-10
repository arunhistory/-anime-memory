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

function exactHost(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return '';
  }
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
    trust: {},
    updatedAt: ''
  };
}

function safeCount(value) {
  return Math.max(0, Math.min(1_000_000_000, Math.trunc(Number(value) || 0)));
}

function sanitizeTrustStats(value) {
  return {
    strongMatches: safeCount(value?.strongMatches),
    weakMatches: safeCount(value?.weakMatches),
    strongConflicts: safeCount(value?.strongConflicts),
    weakConflicts: safeCount(value?.weakConflicts),
    samples: safeCount(value?.samples),
    lastUpdated: String(value?.lastUpdated || '').slice(0, 40)
  };
}

export function sanitizeResearchStrategyState(input) {
  const state = emptyResearchStrategyState();
  if (!input || input.version !== 1) return state;

  if (input.operations && typeof input.operations === 'object' && !Array.isArray(input.operations)) {
    for (const [key, value] of Object.entries(input.operations).slice(0, 20000)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const cleanKey = String(key || '').slice(0, 400);
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
  }

  if (input.trust && typeof input.trust === 'object' && !Array.isArray(input.trust)) {
    for (const [key, value] of Object.entries(input.trust).slice(0, 50000)) {
      const cleanKey = String(key || '').slice(0, 500);
      if (!cleanKey || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      state.trust[cleanKey] = sanitizeTrustStats(value);
    }
  }

  state.updatedAt = String(input.updatedAt || '').slice(0, 40);
  return state;
}

function operationKey(url, anchor = '') {
  const host = exactHost(url) || 'unknown';
  const route = researchRouteKind(url, anchor);
  return `${host}\u0000${route}`;
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

function trustKeys(url, field = '') {
  const family = sourceFamilyKey(url) || 'unknown';
  const host = exactHost(url) || 'unknown';
  const route = researchRouteKind(url);
  const keys = [
    { level: 'family', key: `family\u0000${family}` },
    { level: 'host', key: `host\u0000${host}` },
    { level: 'route', key: `route\u0000${host}\u0000${route}` }
  ];
  if (field) keys.push({ level: 'field', key: `field\u0000${host}\u0000${route}\u0000${String(field).slice(0, 100)}` });
  return keys;
}

export function recordSourceTrustOutcome(strategyState, {
  sourceUrl,
  field = '',
  outcome,
  strength = 'weak',
  observedAt = new Date().toISOString()
} = {}) {
  const state = strategyState && strategyState.version === 1 ? strategyState : emptyResearchStrategyState();
  if (!sourceUrl || !['match', 'conflict'].includes(outcome)) return state;
  const requestedStrong = strength === 'strong';
  for (const { level, key } of trustKeys(sourceUrl, field)) {
    const current = state.trust[key] || sanitizeTrustStats({});
    const strong = requestedStrong && (level === 'field' || !field);
    if (outcome === 'match' && strong) current.strongMatches += 1;
    else if (outcome === 'match') current.weakMatches += 1;
    else if (strong) current.strongConflicts += 1;
    else current.weakConflicts += 1;
    current.samples += 1;
    current.lastUpdated = String(observedAt || '').slice(0, 40);
    state.trust[key] = current;
  }
  state.updatedAt = String(observedAt || '').slice(0, 40);
  return state;
}

function splitEscapedList(value) {
  const output = [];
  let current = '';
  let escaped = false;
  for (const ch of String(value || '')) {
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
      current += ch;
    } else if (ch === '|') {
      output.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  output.push(current);
  return output.map((item) => item.trim()).filter(Boolean);
}

function normalizeComparable(value) {
  return String(value || '').normalize('NFKC').trim();
}

function evidenceMatchesRecord(item, record) {
  const field = String(item?.field || '');
  const value = normalizeComparable(item?.value);
  if (!field || !value || !record || typeof record !== 'object') return null;

  if (field === 'title_ja') {
    const titles = [record.title_ja, record.title_kana, record.title_romaji, record.title_en, ...splitEscapedList(record.aliases)]
      .map(normalizeComparable)
      .filter(Boolean);
    if (!titles.length) return null;
    return titles.includes(value);
  }

  const known = normalizeComparable(record[field]);
  if (!known) return null;
  if (known === value) return true;
  const parts = splitEscapedList(known).map(normalizeComparable);
  if (parts.length > 1) return parts.includes(value);
  return false;
}

export function learnSourceTrustFromKnownRecord(strategyState, evidence = [], record, observedAt = new Date().toISOString()) {
  const state = strategyState && strategyState.version === 1 ? strategyState : emptyResearchStrategyState();
  let trained = 0;
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const matched = evidenceMatchesRecord(item, record);
    if (matched === null) continue;
    recordSourceTrustOutcome(state, {
      sourceUrl: item.sourceUrl,
      field: item.field,
      outcome: matched ? 'match' : 'conflict',
      strength: 'strong',
      observedAt
    });
    trained += 1;
  }
  return trained;
}

export function learnSourceTrustFromResolvedCandidate(strategyState, candidate, observedAt = new Date().toISOString()) {
  const state = strategyState && strategyState.version === 1 ? strategyState : emptyResearchStrategyState();
  const facts = candidate?.facts && typeof candidate.facts === 'object' ? candidate.facts : {};
  let trained = 0;
  for (const item of Array.isArray(candidate?.evidence) ? candidate.evidence : []) {
    const fact = facts[item?.field];
    if (!fact || fact.status !== 'confirmed' || !fact.value) continue;
    const values = splitEscapedList(fact.value);
    const matched = normalizeComparable(item.value) === normalizeComparable(fact.value) || values.map(normalizeComparable).includes(normalizeComparable(item.value));
    recordSourceTrustOutcome(state, {
      sourceUrl: item.sourceUrl,
      field: item.field,
      outcome: matched ? 'match' : 'conflict',
      strength: 'weak',
      observedAt
    });
    trained += 1;
  }
  return trained;
}

function scoreTrustStats(stats, priorScore, priorWeight) {
  const prior = clamp(priorScore, 1, 99) / 100;
  const clean = sanitizeTrustStats(stats || {});
  const positive = clean.strongMatches * 4 + clean.weakMatches;
  const negative = clean.strongConflicts * 6 + clean.weakConflicts * 2;
  const alpha = prior * priorWeight + positive;
  const beta = (1 - prior) * priorWeight + negative;
  return clamp(alpha / Math.max(0.0001, alpha + beta), 0.03, 0.98);
}

function trustEntry(strategy, key) {
  return strategy?.trust?.[key] || null;
}

export function scoreSourceCredibility(model, { sourceUrl, field = '', sourceClass = 'secondary', directness = 50 } = {}) {
  const strategy = model?.strategy || model || emptyResearchStrategyState();
  const family = sourceFamilyKey(sourceUrl) || 'unknown';
  const host = exactHost(sourceUrl) || 'unknown';
  const route = researchRouteKind(sourceUrl);

  const familyScore = scoreTrustStats(trustEntry(strategy, `family\u0000${family}`), 45, 10);
  const hostScore = scoreTrustStats(trustEntry(strategy, `host\u0000${host}`), familyScore * 100, 8);
  const routeScore = scoreTrustStats(trustEntry(strategy, `route\u0000${host}\u0000${route}`), hostScore * 100, 6);
  const fieldEntry = field ? trustEntry(strategy, `field\u0000${host}\u0000${route}\u0000${field}`) : null;
  const untrainedFieldPrior = routeScore * 0.35 + 0.45 * 0.65;
  const fieldScore = field
    ? scoreTrustStats(fieldEntry, (fieldEntry?.samples ? routeScore : untrainedFieldPrior) * 100, 5)
    : routeScore;

  let credibility = fieldScore * 100;
  if (sourceClass === 'primary') credibility += 20;
  credibility += (clamp(directness, 0, 100) - 50) * 0.12;
  credibility = clamp(credibility, 5, 98);

  const samples = [
    trustEntry(strategy, `family\u0000${family}`)?.samples || 0,
    trustEntry(strategy, `host\u0000${host}`)?.samples || 0,
    trustEntry(strategy, `route\u0000${host}\u0000${route}`)?.samples || 0,
    fieldEntry?.samples || 0
  ].reduce((sum, value) => sum + Number(value || 0), 0);

  return {
    credibility: Math.round(credibility),
    samples,
    family,
    host,
    route
  };
}

function efficiencyFromOperation(op) {
  if (!op || op.attempts <= 0) return 0.5;
  const fetchRate = (op.fetched + 1) / (op.attempts + 2);
  const yieldRate = (op.evidencePages + 1) / (Math.max(op.fetched, 0) + 2);
  const failurePenalty = (op.failures + op.blocked) / Math.max(1, op.attempts);
  return clamp(fetchRate * 0.5 + yieldRate * 0.5 - failurePenalty * 0.35, 0.05, 0.95);
}

export function buildResearchStrategyModel(state) {
  return { strategy: sanitizeResearchStrategyState(state?.researchStrategy) };
}

export function scoreResearchRoute(model, { url, anchor = '', desiredFields = [] } = {}) {
  if (!url) return { credibility: 45, efficiency: 50, fieldFitness: 45, score: 45, boost: 0 };
  const strategy = model?.strategy || emptyResearchStrategyState();
  const host = exactHost(url) || 'unknown';
  const route = researchRouteKind(url, anchor);
  const operation = strategy.operations?.[`${host}\u0000${route}`] || null;
  const efficiency = efficiencyFromOperation(operation);
  const base = scoreSourceCredibility(model, { sourceUrl: url }).credibility / 100;

  const inferredFields = ROUTE_FIELDS.get(route) || [];
  const targets = [...new Set([...(Array.isArray(desiredFields) ? desiredFields : []), ...inferredFields])];
  const fieldScores = targets.map((field) => scoreSourceCredibility(model, { sourceUrl: url, field }).credibility / 100);
  const fieldFitness = fieldScores.length ? fieldScores.reduce((sum, value) => sum + value, 0) / fieldScores.length : base;

  const attempts = operation?.attempts || 0;
  const explorationBonus = Math.min(0.06, 0.06 / Math.sqrt(attempts + 1));
  const combined = clamp(base * 0.5 + fieldFitness * 0.3 + efficiency * 0.2 + explorationBonus, 0, 1);
  const boost = Math.round((combined - 0.45) * 90);
  return {
    credibility: Math.round(base * 100),
    efficiency: Math.round(efficiency * 100),
    fieldFitness: Math.round(fieldFitness * 100),
    score: Math.round(combined * 100),
    boost
  };
}

export function summarizeResearchStrategy(model, limit = 15) {
  const strategy = model?.strategy || emptyResearchStrategyState();
  const rows = [];
  for (const [key, op] of Object.entries(strategy.operations || {})) {
    const [host, route] = String(key).split('\u0000');
    if (!host || !route) continue;
    const synthetic = `https://${host}/${route}`;
    const scored = scoreResearchRoute(model, { url: synthetic });
    rows.push({ host, route, credibility: scored.credibility, efficiency: scored.efficiency, score: scored.score, attempts: op?.attempts || 0 });
  }
  return rows
    .sort((a, b) => b.score - a.score || b.attempts - a.attempts || a.host.localeCompare(b.host))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 15)));
}
