import { candidateInformationReadiness, recordCandidateSearchQuery, sanitizeCandidateResearch } from './research-completion.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';
import { normalizeUrl, urlHash } from './url.mjs';

const QUERY_VARIANTS = [
  {
    topic: 'title',
    variants: [[
      ['title_kana', '読み'],
      ['title_romaji', 'ローマ字'],
      ['title_en', '英語タイトル'],
      ['aliases', '別名']
    ]]
  },
  {
    topic: 'release',
    variants: [[
      ['release_start', '放送開始 公開日'],
      ['release_end', '放送終了 公開終了'],
      ['episode_count', '話数'],
      ['runtime_min', '上映時間 放送時間'],
      ['season_number', '第何期']
    ]]
  },
  {
    topic: 'classification',
    variants: [
      [
        ['genres', 'ジャンル'],
        ['tags', 'タグ'],
        ['target_demographic', '対象層'],
        ['themes', 'テーマ']
      ],
      [
        ['setting', '舞台'],
        ['era', '時代設定']
      ]
    ]
  },
  {
    topic: 'original',
    variants: [
      [
        ['original_type', '原作種別'],
        ['original_title', '原作タイトル'],
        ['original_author', '原作者'],
        ['original_artist', '原作作画'],
        ['original_publisher', '出版社'],
        ['original_label', 'レーベル']
      ],
      [
        ['original_magazine', '掲載誌'],
        ['original_platform', '原作 Web 媒体']
      ]
    ]
  },
  {
    topic: 'production',
    variants: [
      [
        ['animation_studio', 'アニメーション制作'],
        ['co_animation_studio', '共同制作'],
        ['animation_cooperation', '制作協力']
      ],
      [
        ['production_name', '製作名義'],
        ['production_committee', '製作委員会'],
        ['production_members', '製作委員会 参加企業'],
        ['production_lead_company', '製作 幹事会社']
      ],
      [
        ['planning', '企画'],
        ['executive_producers', 'エグゼクティブプロデューサー'],
        ['producers', 'プロデューサー'],
        ['animation_producers', 'アニメーションプロデューサー'],
        ['line_producers', 'ラインプロデューサー']
      ]
    ]
  },
  {
    topic: 'staff',
    variants: [
      [
        ['director', '監督'],
        ['chief_director', '総監督'],
        ['series_composition', 'シリーズ構成'],
        ['staff', 'スタッフ']
      ],
      [
        ['character_original_design', 'キャラクター原案'],
        ['character_design', 'キャラクターデザイン'],
        ['sound_director', '音響監督']
      ]
    ]
  },
  {
    topic: 'cast',
    variants: [[
      ['characters', 'キャスト 声優 キャラクター']
    ]]
  },
  {
    topic: 'music',
    variants: [
      [
        ['opening_themes', '主題歌 OP'],
        ['ending_themes', '主題歌 ED'],
        ['insert_songs', '挿入歌']
      ],
      [
        ['music', '音楽 劇伴'],
        ['music_production', '音楽制作'],
        ['soundtrack_label', 'サウンドトラック レーベル']
      ]
    ]
  },
  {
    topic: 'broadcast',
    variants: [[
      ['broadcast_networks', '放送局'],
      ['broadcast_slots', '放送時間 放送枠']
    ]]
  },
  {
    topic: 'streaming',
    variants: [[
      ['streaming_services', '配信 見放題 独占 先行']
    ]]
  },
  {
    topic: 'theatrical',
    variants: [[
      ['film_distributor', '劇場 配給'],
      ['theatrical_release_date', '劇場 公開日']
    ]]
  },
  {
    topic: 'episodes',
    variants: [[
      ['episodes', 'エピソード サブタイトル'],
      ['episode_staff', '各話スタッフ']
    ]]
  },
  {
    topic: 'recognition',
    variants: [[
      ['awards', '受賞 賞']
    ]]
  },
  {
    topic: 'official',
    variants: [[
      ['official_url', '公式サイト'],
      ['official_x', '公式 X'],
      ['official_youtube', '公式 YouTube'],
      ['official_other', '公式 情報']
    ]]
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
      const unresolved = unresolvedVariant(candidate, variant);
      if (!unresolved.fields.length || !unresolved.terms.length) continue;
      const query = `${title} ${unresolved.terms.join(' ')}`.replace(/\s+/g, ' ').trim();
      if (searched.has(queryKey(query))) continue;
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
  fields: [...new Set(group.variants.flatMap((variant) => variant.map(([field]) => field)))]
}));
