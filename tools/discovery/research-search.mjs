import { candidateInformationReadiness, recordCandidateSearchQuery, sanitizeCandidateResearch } from './research-completion.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { buildWebSearchLookup, searchOwnWebIndex } from './web-search-index.mjs';
import { normalizeUrl } from './url.mjs';

const QUERY_VARIANTS = [
  { topic: 'title', variants: [[['title_kana', '読み'], ['title_romaji', 'ローマ字'], ['title_en', '英語タイトル'], ['aliases', '別名']]] },
  { topic: 'release', variants: [[['release_start', '放送開始 公開日'], ['release_end', '放送終了 公開終了'], ['episode_count', '話数'], ['runtime_min', '上映時間 放送時間'], ['season_number', '第何期']]] },
  { topic: 'classification', variants: [[['genres', 'ジャンル'], ['tags', 'タグ'], ['target_demographic', '対象層'], ['themes', 'テーマ']], [['setting', '舞台'], ['era', '時代設定']]] },
  { topic: 'original', variants: [[['original_type', '原作種別'], ['original_title', '原作タイトル'], ['original_author', '原作者'], ['original_artist', '原作作画'], ['original_publisher', '出版社'], ['original_label', 'レーベル']], [['original_magazine', '掲載誌'], ['original_platform', '原作 Web 媒体']]] },
  { topic: 'production', variants: [[['animation_studio', 'アニメーション制作'], ['co_animation_studio', '共同制作'], ['animation_cooperation', '制作協力']], [['production_name', '製作名義'], ['production_committee', '製作委員会'], ['production_members', '製作委員会 参加企業'], ['production_lead_company', '製作 幹事会社']], [['planning', '企画'], ['executive_producers', 'エグゼクティブプロデューサー'], ['producers', 'プロデューサー'], ['animation_producers', 'アニメーションプロデューサー'], ['line_producers', 'ラインプロデューサー']]] },
  { topic: 'staff', variants: [[['director', '監督'], ['chief_director', '総監督'], ['series_composition', 'シリーズ構成'], ['staff', 'スタッフ']], [['character_original_design', 'キャラクター原案'], ['character_design', 'キャラクターデザイン'], ['sound_director', '音響監督']]] },
  { topic: 'cast', variants: [[['characters', 'キャスト 声優 キャラクター']]] },
  { topic: 'music', variants: [[['opening_themes', '主題歌 OP'], ['ending_themes', '主題歌 ED'], ['insert_songs', '挿入歌']], [['music', '音楽 劇伴'], ['music_production', '音楽制作'], ['soundtrack_label', 'サウンドトラック レーベル']]] },
  { topic: 'broadcast', variants: [[['broadcast_networks', '放送局'], ['broadcast_slots', '放送時間 放送枠']]] },
  { topic: 'streaming', variants: [[['streaming_services', '配信 見放題 独占 先行']]] },
  { topic: 'theatrical', variants: [[['film_distributor', '劇場 配給'], ['theatrical_release_date', '劇場 公開日']]] },
  { topic: 'episodes', variants: [[['episodes', 'エピソード サブタイトル'], ['episode_staff', '各話スタッフ']]] },
  { topic: 'recognition', variants: [[['awards', '受賞 賞']]] },
  { topic: 'official', variants: [[['official_url', '公式サイト'], ['official_x', '公式 X'], ['official_youtube', '公式 YouTube'], ['official_other', '公式 情報']]] }
];

function confirmedFact(candidate, field) {
  const fact = candidate?.facts?.[field];
  return fact?.status === 'confirmed' && Boolean(String(fact.value || '').trim());
}

function unresolvedPriority(candidate, fields) {
  let best = 0;
  for (const field of fields) {
    const fact = candidate?.facts?.[field];
    if (confirmedFact(candidate, field)) continue;
    if (fact?.status === 'conflict') best = Math.max(best, 230);
    else if (fact?.status === 'observed') best = Math.max(best, 220);
    else best = Math.max(best, 170);
  }
  return best;
}

function unresolvedVariant(candidate, variant) {
  const unresolved = variant.filter(([field]) => !confirmedFact(candidate, field));
  return {
    fields: unresolved.map(([field]) => field),
    terms: [...new Set(unresolved.map(([, term]) => term).filter(Boolean))]
  };
}

export function confirmedResearchTitle(candidate) {
  const readiness = discoveryCandidateReadiness(candidate);
  if (!readiness.ready) return '';
  return String(candidate?.facts?.title_ja?.value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function buildResearchSearchPlan(candidate, { maxQueries = 12 } = {}) {
  const title = confirmedResearchTitle(candidate);
  if (!title || candidateInformationReadiness(candidate).ready) return [];

  // Searches are local index lookups, not external network requests. Incomplete fields
  // are deliberately eligible again on later batches so newly crawled pages can be used.
  const plan = [{ kind: 'broad', topic: 'broad', query: title, fields: [], priority: 260 }];

  for (const group of QUERY_VARIANTS) {
    for (const variant of group.variants) {
      const unresolved = unresolvedVariant(candidate, variant);
      if (!unresolved.fields.length || !unresolved.terms.length) continue;
      const query = `${title} ${unresolved.terms.join(' ')}`.replace(/\s+/g, ' ').trim();
      plan.push({
        kind: 'targeted',
        topic: group.topic,
        query,
        fields: unresolved.fields,
        priority: unresolvedPriority(candidate, unresolved.fields)
      });
    }
  }

  const broad = plan.filter((item) => item.kind === 'broad');
  const targeted = plan.filter((item) => item.kind !== 'broad')
    .sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic, 'ja'));
  return [...broad, ...targeted].slice(0, Math.max(0, Math.min(64, Number(maxQueries) || 0)));
}

function mergeCandidateHint(entry, title) {
  const hints = Array.isArray(entry.candidateHints) ? entry.candidateHints : [];
  const normalized = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const seen = new Set(hints.map((value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()));
  if (normalized && !seen.has(normalized)) hints.push(normalized);
  entry.candidateHints = hints.slice(0, 32);
}

export function diversifyResearchResults(results, limit = 20) {
  const source = Array.isArray(results) ? results : [];
  const max = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 20)));
  const selected = [];
  const selectedUrls = new Set();
  const seenFamilies = new Set();

  // First pass takes the strongest result from each independent source family.
  for (const item of source) {
    const url = normalizeUrl(item?.url || item);
    const family = String(item?.sourceFamily || '').trim();
    if (!url || selectedUrls.has(url) || !family || seenFamilies.has(family)) continue;
    selected.push(item);
    selectedUrls.add(url);
    seenFamilies.add(family);
    if (selected.length >= max) return selected;
  }

  // Second pass fills remaining capacity by score/order without duplicating URLs.
  for (const item of source) {
    const url = normalizeUrl(item?.url || item);
    if (!url || selectedUrls.has(url)) continue;
    selected.push(item);
    selectedUrls.add(url);
    if (selected.length >= max) break;
  }
  return selected;
}

export function enqueueResearchSearchResults(state, candidate, planItem, results) {
  if (!state) throw new Error('discovery state is required');
  if (!Array.isArray(state.researchFrontier)) state.researchFrontier = [];
  const title = confirmedResearchTitle(candidate);
  if (!title) return 0;

  const queued = new Map();
  for (const entry of state.researchFrontier) {
    const url = normalizeUrl(entry?.url);
    if (url) queued.set(url, entry);
  }

  let added = 0;
  for (let index = 0; index < (Array.isArray(results) ? results : []).length; index += 1) {
    const url = normalizeUrl(results[index]?.url || results[index]);
    if (!url) continue;
    const priority = Math.max(180, Math.min(900, Number(planItem?.priority || 170) + 180 - index * 2));
    const existing = queued.get(url);
    if (existing) {
      existing.priority = Math.max(Number(existing.priority || 0), priority);
      mergeCandidateHint(existing, title);
      continue;
    }
    // A URL in the own search index was already visited by discovery. It is still valid
    // for research: promotion deliberately permits a research re-fetch so current page
    // content can be verified without storing article bodies in the index.
    const entry = { url, priority, depth: 0, discoveredFrom: '', candidateHints: [title] };
    state.researchFrontier.push(entry);
    queued.set(url, entry);
    added += 1;
  }
  return added;
}

export function runOwnResearchSearchForCandidate(state, candidate, {
  maxQueries = 12,
  resultsPerQuery = 20,
  lookup = null
} = {}) {
  if (!state) throw new Error('discovery state is required');
  const plan = buildResearchSearchPlan(candidate, { maxQueries });
  const title = confirmedResearchTitle(candidate);
  const research = sanitizeCandidateResearch(candidate?.research);
  const searchLookup = lookup || buildWebSearchLookup(state.webSearchIndex);
  const stats = { planned: plan.length, searched: 0, urlsQueued: 0 };

  for (const item of plan) {
    const ranked = searchOwnWebIndex(searchLookup, {
      title,
      fields: item.fields,
      topic: item.topic,
      seenFamilies: research.sourceFamilies,
      excludeUrls: research.pageUrls,
      limit: 100
    });
    const results = diversifyResearchResults(ranked, resultsPerQuery);
    stats.searched += 1;
    stats.urlsQueued += enqueueResearchSearchResults(state, candidate, item, results);
    candidate.research = recordCandidateSearchQuery(candidate.research, item.query);
  }
  return stats;
}

export function prepareResearchFrontierFromOwnIndex(state, {
  maxCandidates = 5000,
  maxQueriesPerCandidate = 12,
  resultsPerQuery = 20
} = {}) {
  if (!state) throw new Error('discovery state is required');
  if (!Array.isArray(state.researchFrontier)) state.researchFrontier = [];
  const candidates = Array.isArray(state.candidates) ? state.candidates : [];
  if (!candidates.length) {
    state.researchSearchCursor = 0;
    return { candidatesConsidered: 0, candidatesScanned: 0, searches: 0, urlsQueued: 0, nextCursor: 0 };
  }

  const lookup = buildWebSearchLookup(state.webSearchIndex);
  const start = Math.max(0, Math.trunc(Number(state.researchSearchCursor || 0))) % candidates.length;
  const cap = Math.max(1, Math.trunc(Number(maxCandidates) || 1));
  let candidatesConsidered = 0;
  let candidatesScanned = 0;
  let searches = 0;
  let urlsQueued = 0;

  while (candidatesScanned < candidates.length && candidatesConsidered < cap) {
    const index = (start + candidatesScanned) % candidates.length;
    const candidate = candidates[index];
    candidatesScanned += 1;
    const title = confirmedResearchTitle(candidate);
    if (!title || candidateInformationReadiness(candidate).ready) continue;
    candidatesConsidered += 1;
    const result = runOwnResearchSearchForCandidate(state, candidate, {
      maxQueries: maxQueriesPerCandidate,
      resultsPerQuery,
      lookup
    });
    searches += result.searched;
    urlsQueued += result.urlsQueued;
  }

  state.researchSearchCursor = (start + candidatesScanned) % candidates.length;
  return {
    candidatesConsidered,
    candidatesScanned,
    searches,
    urlsQueued,
    nextCursor: state.researchSearchCursor
  };
}

export const researchSearchTopics = QUERY_VARIANTS.map((group) => ({
  topic: group.topic,
  fields: [...new Set(group.variants.flatMap((variant) => variant.map(([field]) => field)))]
}));
