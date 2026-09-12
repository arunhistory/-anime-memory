import { normalizeTitleKey } from './html.mjs';
import { researchRouteKind } from './research-strategy.mjs';
import { sourceFamilyKey } from './source-family.mjs';
import { normalizeUrl } from './url.mjs';

const TOPIC_PATTERNS = new Map([
  ['title', /(?:タイトル|作品名|読み|英題|英語タイトル|別名|alias|title)/i],
  ['release', /(?:放送開始|放送終了|公開日|上映時間|放送時間|話数|全\s*\d+\s*話|release|episode)/i],
  ['classification', /(?:ジャンル|対象層|テーマ|舞台|時代設定|genre|theme)/i],
  ['original', /(?:原作|原作者|出版社|掲載誌|レーベル|連載|manga|novel|publisher)/i],
  ['production', /(?:アニメーション制作|制作会社|制作協力|共同制作|製作委員会|幹事会社|プロデューサー|production|studio)/i],
  ['staff', /(?:監督|総監督|シリーズ構成|キャラクターデザイン|キャラクター原案|音響監督|スタッフ|staff|director)/i],
  ['cast', /(?:キャスト|声優|キャラクター|cast|voice actor)/i],
  ['music', /(?:主題歌|オープニング|エンディング|挿入歌|音楽制作|劇伴|サウンドトラック|music|theme song)/i],
  ['broadcast', /(?:放送局|放送時間|放送枠|オンエア|broadcast|onair)/i],
  ['streaming', /(?:配信|見放題|独占|先行配信|streaming|vod)/i],
  ['theatrical', /(?:劇場公開|映画館|配給|theatrical|distributor)/i],
  ['episodes', /(?:各話|エピソード|サブタイトル|各話スタッフ|episode|story)/i],
  ['recognition', /(?:受賞|賞|award)/i],
  ['official', /(?:公式サイト|公式\s*X|公式\s*YouTube|official)/i]
]);

const FIELD_TOPICS = new Map([
  ['title_kana', 'title'], ['title_romaji', 'title'], ['title_en', 'title'], ['aliases', 'title'],
  ['release_start', 'release'], ['release_end', 'release'], ['episode_count', 'release'], ['runtime_min', 'release'], ['season_number', 'release'],
  ['genres', 'classification'], ['tags', 'classification'], ['target_demographic', 'classification'], ['setting', 'classification'], ['era', 'classification'], ['themes', 'classification'],
  ['original_type', 'original'], ['original_title', 'original'], ['original_author', 'original'], ['original_artist', 'original'], ['original_publisher', 'original'], ['original_label', 'original'], ['original_magazine', 'original'], ['original_platform', 'original'],
  ['animation_studio', 'production'], ['co_animation_studio', 'production'], ['animation_cooperation', 'production'], ['production_name', 'production'], ['production_committee', 'production'], ['production_members', 'production'], ['production_lead_company', 'production'], ['planning', 'production'], ['executive_producers', 'production'], ['producers', 'production'], ['animation_producers', 'production'], ['line_producers', 'production'],
  ['director', 'staff'], ['chief_director', 'staff'], ['series_composition', 'staff'], ['character_original_design', 'staff'], ['character_design', 'staff'], ['sound_director', 'staff'], ['staff', 'staff'],
  ['characters', 'cast'],
  ['opening_themes', 'music'], ['ending_themes', 'music'], ['insert_songs', 'music'], ['music', 'music'], ['music_production', 'music'], ['soundtrack_label', 'music'],
  ['broadcast_networks', 'broadcast'], ['broadcast_slots', 'broadcast'],
  ['streaming_services', 'streaming'],
  ['film_distributor', 'theatrical'], ['theatrical_release_date', 'theatrical'],
  ['episodes', 'episodes'], ['episode_staff', 'episodes'],
  ['awards', 'recognition'],
  ['official_url', 'official'], ['official_x', 'official'], ['official_youtube', 'official'], ['official_other', 'official']
]);

function cleanTopics(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))]
    .filter((value) => TOPIC_PATTERNS.has(value));
}

function cleanCandidateKeys(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeTitleKey(value))
    .filter((value) => value && value.length >= 2))];
}

function metadataKey(document) {
  return normalizeTitleKey([
    document?.title,
    document?.ogTitle,
    document?.description,
    document?.keywords
  ].filter(Boolean).join(' ')).slice(0, 5000);
}

function routeTopicFor(url, anchor = '') {
  return new Map([
    ['staff', 'staff'], ['character', 'cast'], ['streaming', 'streaming'], ['broadcast', 'broadcast'],
    ['music', 'music'], ['original', 'original'], ['episode', 'episodes'], ['production', 'production'], ['official', 'official']
  ]).get(researchRouteKind(url, anchor)) || '';
}

export function topicsForFields(fields) {
  return [...new Set((Array.isArray(fields) ? fields : [])
    .map((field) => FIELD_TOPICS.get(String(field || '')))
    .filter(Boolean))];
}

export function detectDocumentSearchTopics(document) {
  const text = `${document?.title || ''}\n${document?.ogTitle || ''}\n${document?.description || ''}\n${document?.keywords || ''}\n${String(document?.text || '').slice(0, 120000)}`;
  const topics = [];
  for (const [topic, pattern] of TOPIC_PATTERNS) if (pattern.test(text)) topics.push(topic);
  const routeTopic = routeTopicFor(document?.canonical || document?.url || '', document?.title || '');
  if (routeTopic) topics.push(routeTopic);
  return cleanTopics(topics);
}

export function indexWebDocument(index, document, observedAt = new Date().toISOString()) {
  const normalizedUrl = normalizeUrl(document?.canonical || document?.url);
  if (!normalizedUrl || document?.noindex) return index;
  const pages = Array.isArray(index) ? index : [];
  const candidateKeys = cleanCandidateKeys([
    document?.subjectCandidate?.title,
    ...(Array.isArray(document?.candidates) ? document.candidates.map((candidate) => candidate?.title) : [])
  ]);
  const entry = {
    url: normalizedUrl,
    metadataKey: metadataKey(document),
    subjectKey: normalizeTitleKey(document?.subjectCandidate?.title || ''),
    candidateKeys,
    topics: detectDocumentSearchTopics(document),
    sourceFamily: sourceFamilyKey(normalizedUrl) || '',
    indexedAt: String(observedAt || '').slice(0, 40)
  };
  const position = pages.findIndex((item) => item?.url === normalizedUrl);
  if (position >= 0) pages[position] = entry;
  else pages.push(entry);
  return pages;
}

export function refreshWebSearchIndexFromDocuments(index, documents) {
  const pages = sanitizeWebSearchIndex(index);
  const byUrl = new Map(pages.map((entry) => [entry.url, entry]));
  for (const doc of Array.isArray(documents) ? documents : []) {
    const url = normalizeUrl(doc?.url);
    if (!url) continue;
    const existing = byUrl.get(url);
    const candidateKeys = cleanCandidateKeys(doc?.candidateTitles);
    const text = String(doc?.title || '');
    const topics = [];
    for (const [topic, pattern] of TOPIC_PATTERNS) if (pattern.test(text)) topics.push(topic);
    const routeTopic = routeTopicFor(url, text);
    if (routeTopic) topics.push(routeTopic);
    const entry = {
      url,
      metadataKey: normalizeTitleKey(text).slice(0, 5000),
      subjectKey: candidateKeys.length === 1 ? candidateKeys[0] : (existing?.subjectKey || ''),
      candidateKeys: cleanCandidateKeys([...(existing?.candidateKeys || []), ...candidateKeys]),
      topics: cleanTopics([...(existing?.topics || []), ...topics]),
      sourceFamily: existing?.sourceFamily || sourceFamilyKey(url) || '',
      indexedAt: String(doc?.lastChecked || existing?.indexedAt || '').slice(0, 40)
    };
    byUrl.set(url, entry);
  }
  return [...byUrl.values()];
}

export function sanitizeWebSearchIndex(values) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const url = normalizeUrl(raw?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({
      url,
      metadataKey: String(raw?.metadataKey || '').slice(0, 5000),
      subjectKey: normalizeTitleKey(raw?.subjectKey || ''),
      candidateKeys: cleanCandidateKeys(raw?.candidateKeys),
      topics: cleanTopics(raw?.topics),
      sourceFamily: String(raw?.sourceFamily || sourceFamilyKey(url) || '').slice(0, 200),
      indexedAt: String(raw?.indexedAt || '').slice(0, 40)
    });
  }
  return output;
}

export function buildWebSearchLookup(index) {
  const pages = sanitizeWebSearchIndex(index);
  const byTitle = new Map();
  for (const entry of pages) {
    const keys = cleanCandidateKeys([entry.subjectKey, ...entry.candidateKeys]);
    for (const key of keys) {
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(entry);
    }
  }
  return { version: 1, pages, byTitle };
}

function titleMatchScore(entry, titleKey) {
  if (!titleKey) return 0;
  if (entry.subjectKey === titleKey) return 150;
  if (entry.candidateKeys.includes(titleKey)) return 125;
  return 0;
}

function entriesForTitle(indexOrLookup, titleKey) {
  const lookup = indexOrLookup?.version === 1 && indexOrLookup?.byTitle instanceof Map
    ? indexOrLookup
    : buildWebSearchLookup(indexOrLookup);
  return lookup.byTitle.get(titleKey) || [];
}

export function searchOwnWebIndex(indexOrLookup, {
  title,
  fields = [],
  topic = '',
  seenFamilies = [],
  excludeUrls = [],
  limit = 20
} = {}) {
  const titleKey = normalizeTitleKey(title);
  if (!titleKey) return [];
  const desiredTopics = new Set([
    ...topicsForFields(fields),
    ...(TOPIC_PATTERNS.has(topic) ? [topic] : [])
  ]);
  const knownFamilies = new Set((Array.isArray(seenFamilies) ? seenFamilies : []).map(String));
  const excluded = new Set((Array.isArray(excludeUrls) ? excludeUrls : []).map((url) => normalizeUrl(url)).filter(Boolean));
  const scored = [];
  for (const entry of entriesForTitle(indexOrLookup, titleKey)) {
    if (excluded.has(entry.url)) continue;
    const titleScore = titleMatchScore(entry, titleKey);
    if (!titleScore) continue;
    const topicHits = desiredTopics.size ? [...desiredTopics].filter((value) => entry.topics.includes(value)).length : 0;
    if (desiredTopics.size && topicHits === 0) continue;
    const familyBonus = entry.sourceFamily && !knownFamilies.has(entry.sourceFamily) ? 25 : 0;
    const score = titleScore + topicHits * 45 + familyBonus;
    scored.push({ url: entry.url, score, sourceFamily: entry.sourceFamily, topics: entry.topics });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}
