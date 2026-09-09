const MAX_LABEL_VALUE = 180;

export const ADDITIONAL_SCALAR_FIELDS = new Set([
  'title_kana',
  'title_romaji',
  'title_en',
  'release_end',
  'episode_count',
  'runtime_min',
  'season_number',
  'target_demographic',
  'original_title',
  'original_publisher',
  'original_label',
  'original_magazine',
  'original_platform',
  'production_name',
  'production_committee',
  'production_lead_company',
  'soundtrack_label',
  'film_distributor',
  'official_url',
  'official_x',
  'official_youtube'
]);

export const ADDITIONAL_MULTI_FIELDS = new Set([
  'aliases',
  'tags',
  'setting',
  'era',
  'themes',
  'original_author',
  'original_artist',
  'co_animation_studio',
  'animation_cooperation',
  'production_members',
  'planning',
  'executive_producers',
  'producers',
  'animation_producers',
  'line_producers',
  'chief_director',
  'character_original_design',
  'music_production',
  'broadcast_networks'
]);

function clean(value, max = MAX_LABEL_VALUE) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:：,、;；|｜]+|[\s:：,、;；|｜]+$/g, '')
    .trim()
    .slice(0, max);
}

function splitList(value) {
  const text = clean(value, 500);
  if (!text) return [];
  return [...new Set(text
    .split(/\s*(?:、|,|，|;|；|\|)\s*/)
    .map((item) => clean(item))
    .filter(Boolean))]
    .slice(0, 30);
}

function addLabelClaims(claims, context, field, labels, { multi = false, maxMatches = 5 } = {}) {
  const regex = new RegExp(`(?:^|\\n|[ \\t])(?:${labels})\\s*[:：]\\s*([^\\n]{1,${MAX_LABEL_VALUE}})`, 'gi');
  let count = 0;
  for (const match of String(context || '').matchAll(regex)) {
    const values = multi ? splitList(match[1]) : [clean(match[1])];
    for (const value of values) {
      if (!value) continue;
      claims.push({ field, value, rule: `label-${field}` });
    }
    count += 1;
    if (count >= maxMatches) break;
  }
}

function extractReleaseEnd(context) {
  const claims = [];
  const datePattern = /(19\d{2}|20\d{2}|21\d{2})\s*(?:年|[-/.])\s*(\d{1,2})(?:\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日)?)?/g;
  for (const line of String(context || '').split(/\n+/).slice(0, 2000)) {
    if (!/(?:放送|配信|公開|上映)(?:終了|完結)|最終放送/.test(line)) continue;
    for (const match of line.matchAll(datePattern)) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = match[3] ? Number(match[3]) : null;
      if (month < 1 || month > 12) continue;
      if (day !== null) {
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
      }
      const value = day === null
        ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
        : `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      claims.push({ field: 'release_end', value, rule: 'event-date-release-end' });
    }
  }
  return claims;
}

function extractNumbers(context) {
  const claims = [];
  const text = String(context || '');
  const episodeRules = [
    /(?:話数|全話数|エピソード数)\s*[:：]?\s*(?:全)?\s*(\d{1,4})\s*話?/gi,
    /(?:全)\s*(\d{1,4})\s*話(?:\s|$|[。、])/g
  ];
  for (const regex of episodeRules) {
    const match = regex.exec(text);
    if (match) {
      const value = Number(match[1]);
      if (value >= 1 && value <= 9999) claims.push({ field: 'episode_count', value: String(value), rule: 'episode-count' });
      break;
    }
  }

  const runtime = text.match(/(?:上映時間|ランタイム|各話時間|1話(?:あたり)?(?:の)?時間)\s*[:：]?\s*(\d{1,4})\s*分/i);
  if (runtime) {
    const value = Number(runtime[1]);
    if (value >= 1 && value <= 3000) claims.push({ field: 'runtime_min', value: String(value), rule: 'runtime-minutes' });
  }

  const season = text.match(/(?:シーズン番号|season\s*(?:number|no\.?))\s*[:：#]?\s*(\d{1,3})/i);
  if (season) {
    const value = Number(season[1]);
    if (value >= 1 && value <= 999) claims.push({ field: 'season_number', value: String(value), rule: 'season-number' });
  }
  return claims;
}

function extractOfficialLinks(document, sourceClass) {
  if (sourceClass !== 'primary') return [];
  const claims = [];
  const pageUrl = document.canonical || document.url;
  if (pageUrl) claims.push({ field: 'official_url', value: pageUrl, rule: 'primary-page-url' });

  for (const link of document.links || []) {
    let parsed;
    try {
      parsed = new URL(link.url);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'x.com' || host === 'twitter.com') {
      claims.push({ field: 'official_x', value: link.url, rule: 'primary-page-social-x' });
      continue;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
      claims.push({ field: 'official_youtube', value: link.url, rule: 'primary-page-youtube' });
    }
  }
  return claims;
}

export function extractCommonFieldClaims(document, candidate, context, sourceClass = 'secondary') {
  const claims = [];

  addLabelClaims(claims, context, 'title_kana', '(?:タイトル読み|作品名読み|読み|よみ|ふりがな)');
  addLabelClaims(claims, context, 'title_romaji', '(?:ローマ字表記|ローマ字|romanized\\s+title|romaji)');
  addLabelClaims(claims, context, 'title_en', '(?:英語タイトル|英語題|英題|english\\s+title)');
  addLabelClaims(claims, context, 'aliases', '(?:別タイトル|別名|別題|略称|通称)', { multi: true });
  addLabelClaims(claims, context, 'tags', '(?:タグ|作品タグ)', { multi: true });
  addLabelClaims(claims, context, 'target_demographic', '(?:対象層|対象読者|読者層|ターゲット層)');
  addLabelClaims(claims, context, 'setting', '(?:舞台設定|舞台)', { multi: true });
  addLabelClaims(claims, context, 'era', '(?:舞台時代|時代設定)', { multi: true });
  addLabelClaims(claims, context, 'themes', '(?:テーマ|題材)', { multi: true });

  addLabelClaims(claims, context, 'original_title', '(?:原作タイトル|原題)');
  addLabelClaims(claims, context, 'original_author', '(?:原作者|原作)', { multi: true });
  addLabelClaims(claims, context, 'original_artist', '(?:作画|原作作画|漫画)', { multi: true });
  addLabelClaims(claims, context, 'original_publisher', '(?:出版社|原作出版社)');
  addLabelClaims(claims, context, 'original_label', '(?:レーベル|原作レーベル)');
  addLabelClaims(claims, context, 'original_magazine', '(?:掲載誌|連載誌|原作雑誌)');
  addLabelClaims(claims, context, 'original_platform', '(?:掲載サイト|配信サイト|原作プラットフォーム|原作サイト)');

  addLabelClaims(claims, context, 'co_animation_studio', '(?:共同アニメーション制作|共同制作|アニメーション共同制作)', { multi: true });
  addLabelClaims(claims, context, 'animation_cooperation', '(?:アニメーション制作協力|制作協力)', { multi: true });
  addLabelClaims(claims, context, 'production_name', '(?:製作名義|製作)');
  addLabelClaims(claims, context, 'production_committee', '(?:製作委員会)');
  addLabelClaims(claims, context, 'production_members', '(?:製作委員会構成|製作委員会メンバー|製作参加)', { multi: true });
  addLabelClaims(claims, context, 'production_lead_company', '(?:幹事会社|製作幹事)');
  addLabelClaims(claims, context, 'planning', '(?:企画)', { multi: true });
  addLabelClaims(claims, context, 'executive_producers', '(?:エグゼクティブプロデューサー|製作総指揮)', { multi: true });
  addLabelClaims(claims, context, 'producers', '(?:プロデューサー)', { multi: true });
  addLabelClaims(claims, context, 'animation_producers', '(?:アニメーションプロデューサー)', { multi: true });
  addLabelClaims(claims, context, 'line_producers', '(?:ラインプロデューサー)', { multi: true });
  addLabelClaims(claims, context, 'chief_director', '(?:総監督|チーフディレクター)', { multi: true });
  addLabelClaims(claims, context, 'character_original_design', '(?:キャラクター原案|キャラクター原作)', { multi: true });
  addLabelClaims(claims, context, 'music_production', '(?:音楽制作)', { multi: true });
  addLabelClaims(claims, context, 'soundtrack_label', '(?:サウンドトラックレーベル|音楽レーベル)');
  addLabelClaims(claims, context, 'broadcast_networks', '(?:放送局|放送局一覧|放送ネットワーク)', { multi: true });
  addLabelClaims(claims, context, 'film_distributor', '(?:配給|映画配給)');

  claims.push(...extractReleaseEnd(context));
  claims.push(...extractNumbers(context));
  claims.push(...extractOfficialLinks(document, sourceClass));
  return claims.filter((claim) => claim.value !== candidate?.title || claim.field.startsWith('title_'));
}
