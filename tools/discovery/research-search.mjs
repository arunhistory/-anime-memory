import { candidateInformationReadiness, recordCandidateSearchQuery, sanitizeCandidateResearch } from './research-completion.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { normalizeUrl, urlHash } from './url.mjs';

const QUERY_VARIANTS = [
  {
    topic: 'title',
    variants: [
      { suffix: '読み 英語タイトル 別名', fields: ['title_kana', 'title_romaji', 'title_en', 'aliases'] }
    ]
  },
  {
    topic: 'release',
    variants: [
      { suffix: '放送開始 公開日 話数 上映時間', fields: ['release_start', 'release_end', 'episode_count', 'runtime_min', 'season_number'] }
    ]
  },
  {
    topic: 'classification',
    variants: [
      { suffix: 'ジャンル タグ 対象層 テーマ', fields: ['genres', 'tags', 'target_demographic', 'themes'] },
      { suffix: '舞台 時代設定', fields: ['setting', 'era'] }
    ]
  },
  {
    topic: 'original',
    variants: [
      { suffix: '原作 原作者 出版社 レーベル', fields: ['original_type', 'original_title', 'original_author', 'original_artist', 'original_publisher', 'original_label'] },
      { suffix: '原作 掲載誌 Web 媒体', fields: ['original_magazine', 'original_platform'] }
    ]
  },
  {
    topic: 'production',
    variants: [
      { suffix: 'アニメーション制作 制作協力', fields: ['animation_studio', 'co_animation_studio', 'animation_cooperation'] },
      { suffix: '製作委員会 製作会社 幹事会社', fields: ['production_name', 'production_committee', 'production_members', 'production_lead_company'] },
      { suffix: '企画 プロデューサー', fields: ['planning', 'executive_producers', 'producers', 'animation_producers', 'line_producers'] }
    ]
  },
  {
    topic: 'staff',
    variants: [
      { suffix: '監督 総監督 シリーズ構成 スタッフ', fields: ['director', 'chief_director', 'series_composition', 'staff'] },
      { suffix: 'キャラクター原案 キャラクターデザイン 音響監督', fields: ['character_original_design', 'character_design', 'sound_director'] }
    ]
  },
  {
    topic: 'cast',
    variants: [
      { suffix: 'キャスト 声優 キャラクター', fields: ['characters'] }
    ]
  },
  {
    topic: 'music',
    variants: [
      { suffix: '主題歌 OP ED 挿入歌', fields: ['opening_themes', 'ending_themes', 'insert_songs'] },
      { suffix: '音楽 劇伴 音楽制作 サウンドトラック', fields: ['music', 'music_production', 'soundtrack_label'] }
    ]
  },
  {
    topic: 'broadcast',
    variants: [
      { suffix: '放送 放送局 放送時間', fields: ['broadcast_networks', 'broadcast_slots'] }
    ]
  },
  {
    topic: 'streaming',
    variants: [
      { suffix: '配信 見放題 独占 先行', fields: ['streaming_services'] }
    ]
  },
  {
    topic: 'theatrical',
    variants: [
      { suffix: '劇場 公開日 配給', fields: ['film_distributor', 'theatrical_release_date'] }
    ]
  },
  {
    topic: 'episodes',
    variants: [
      { suffix: 'エピソード 各話 サブタイトル 各話スタッフ', fields: ['episodes', 'episode_staff'] }
    ]
  },
  {
    topic: 'recognition',
    variants: [
      { suffix: '受賞 賞', fields: ['awards'] }
    ]
  },
  {
    topic: 'official',
    variants: [
      { suffix: '公式 公式サイト 公式X 公式YouTube', fields: ['official_url', 'official_x', 'official_youtube', 'official_other'] }
    ]
  }
];

function queryKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/\s+/g, ' ')
    .trim();
}

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

export function confirmedResearchTitle(candidate) {
  const readiness = discoveryCandidateReadiness(candidate);
  if (!readiness.ready) return '';
  return String(candidate?.facts?.title_ja?.value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function buildResearchSearchPlan(candidate, { maxQueries = 12 } = {}) {
  const title = confirmedResearchTitle(candidate);
  if (!title) return [];
  if (candidateInformationReadiness(candidate).ready) return [];

  const research = sanitizeCandidateResearch(candidate?.research);
  const searched = new Set(research.searchQueries.map(queryKey));
  const plan = [];

  const broadQuery = title;
  if (!searched.has(queryKey(broadQuery))) {
    plan.push({
      kind: 'broad',
      topic: 'broad',
      query: broadQuery,
      fields: [],
      priority: 260
    });
  }

  for (const group of QUERY_VARIANTS) {
    for (const variant of group.variants) {
      const fields = variant.fields.filter((field) => !confirmedFact(candidate, field));
      if (!fields.length) continue;
      const query = `${title} ${variant.suffix}`.replace(/\s+/g, ' ').trim();
      if (searched.has(queryKey(query))) continue;
      plan.push({
        kind: 'targeted',
        topic: group.topic,
        query,
        fields,
        priority: unresolvedPriority(candidate, fields)
      });
    }
  }

  const broad = plan.filter((item) => item.kind === 'broad');
  const targeted = plan
    .filter((item) => item.kind !== 'broad')
    .sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic, 'ja'));
  return [...broad, ...targeted].slice(0, Math.max(0, Math.min(64, Number(maxQueries) || 0)));
}

export function normalizeResearchSearchResults(results) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(results) ? results : []) {
    const candidateUrl = typeof raw === 'string' ? raw : (raw?.url || raw?.link || raw?.href || '');
    const url = normalizeUrl(candidateUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    // Search result titles/snippets are intentionally discarded. They are discovery
    // metadata only and must never become evidence or facts.
    output.push({ url });
  }
  return output;
}

function mergeCandidateHint(entry, title) {
  const hints = Array.isArray(entry.candidateHints) ? entry.candidateHints : [];
  const normalized = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const seen = new Set(hints.map((value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()));
  if (normalized && !seen.has(normalized)) hints.push(normalized);
  entry.candidateHints = hints.slice(0, 32);
}

export function enqueueResearchSearchResults(state, candidate, planItem, results) {
  if (!state || !Array.isArray(state.frontier)) throw new Error('discovery state frontier is required');
  const title = confirmedResearchTitle(candidate);
  if (!title) return 0;

  const visited = new Set(Array.isArray(state.visited) ? state.visited : []);
  const queued = new Map();
  for (const entry of state.frontier) {
    const url = normalizeUrl(entry?.url);
    if (url) queued.set(url, entry);
  }

  let added = 0;
  const normalizedResults = normalizeResearchSearchResults(results);
  for (let index = 0; index < normalizedResults.length; index += 1) {
    const url = normalizedResults[index].url;
    if (visited.has(urlHash(url))) continue;
    const priority = Math.max(180, Math.min(900, Number(planItem?.priority || 170) + 180 - index * 2));
    const existing = queued.get(url);
    if (existing) {
      existing.priority = Math.max(Number(existing.priority || 0), priority);
      mergeCandidateHint(existing, title);
      continue;
    }
    const entry = {
      url,
      priority,
      depth: 0,
      discoveredFrom: '',
      candidateHints: [title]
    };
    state.frontier.push(entry);
    queued.set(url, entry);
    added += 1;
  }
  return added;
}

export async function executeResearchSearchPlan({
  state,
  candidate,
  searchProvider,
  plan = null,
  maxQueries = 12,
  resultsPerQuery = 10
} = {}) {
  if (!state || !Array.isArray(state.frontier)) throw new Error('discovery state is required');
  if (!searchProvider || typeof searchProvider.search !== 'function') throw new Error('searchProvider.search is required');
  const searchPlan = Array.isArray(plan) ? plan : buildResearchSearchPlan(candidate, { maxQueries });
  const stats = { planned: searchPlan.length, searched: 0, failed: 0, urlsQueued: 0 };

  for (const item of searchPlan) {
    try {
      const rawResults = await searchProvider.search(item.query, { limit: resultsPerQuery });
      stats.searched += 1;
      stats.urlsQueued += enqueueResearchSearchResults(state, candidate, item, rawResults);
      candidate.research = recordCandidateSearchQuery(candidate.research, item.query);
    } catch (error) {
      stats.failed += 1;
      if (typeof searchProvider.onError === 'function') searchProvider.onError(error, item);
    }
  }
  return stats;
}

export const researchSearchTopics = QUERY_VARIANTS.map((group) => ({
  topic: group.topic,
  fields: [...new Set(group.variants.flatMap((variant) => variant.fields))]
}));
