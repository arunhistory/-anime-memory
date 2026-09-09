const STREAMING_MODES = [
  '見放題独占', '配信独占', '地上波先行', 'Web 最速', '同時配信', '期間限定',
  'レンタル', '購入', '無料', '独占', '最速', '先行', '通常', 'その他'
];

export const STRUCTURED_MULTI_FIELDS = new Set([
  'staff',
  'characters',
  'opening_themes',
  'ending_themes',
  'insert_songs',
  'broadcast_slots',
  'streaming_services',
  'episodes',
  'episode_staff',
  'awards',
  'official_other'
]);

function clean(value, max = 180) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:：,、;；|｜/／]+|[\s:：,、;；|｜/／]+$/g, '')
    .trim()
    .slice(0, max);
}

function escapePart(value) {
  return clean(value, 300)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('::', '\\::');
}

function structured(parts) {
  return parts.map((part) => escapePart(part)).join('::');
}

function normalizeDate(raw) {
  const text = clean(raw, 40);
  if (!text) return '';
  let match = text.match(/^(19\d{2}|20\d{2}|21\d{2})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : null;
  if (month < 1 || month > 12) return '';
  if (day !== null) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  }
  return day === null
    ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
    : `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function add(claims, field, parts, rule) {
  if (!parts.some((part) => clean(part))) return;
  claims.push({ field, value: structured(parts), rule });
}

function extractStaff(context, claims) {
  const roles = [
    '副監督', '助監督', '脚本', '総作画監督', '作画監督', 'アクション作画', 'メカ設定', 'メカニック設定',
    'プロップ設定', '美術設定', '美術監督', '色彩設計', '撮影監督', 'CG監督', '3D監督', '編集',
    '音響効果', '音響制作'
  ];
  const rolePattern = roles.map((role) => role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(?:^|\\n|[ \\t])(${rolePattern})\\s*[:：]\\s*([^\\n]{1,160})`, 'gi');
  for (const match of String(context || '').matchAll(regex)) {
    for (const name of String(match[2]).split(/\s*(?:、|,|，|;|；)\s*/).map(clean).filter(Boolean)) {
      add(claims, 'staff', [match[1], name], 'structured-staff-label');
    }
  }
}

function extractCharacters(context, claims) {
  const patterns = [
    /(?:^|\n)\s*([^\n:：（）()]{1,80})\s*[（(]\s*(?:CV|声優)\s*[:：]\s*([^\n）)]{1,100})[）)]/gi,
    /(?:^|\n)\s*([^\n:：]{1,80})\s*[:：]\s*(?:CV|声優)\s*[:：]?\s*([^\n]{1,100})/gi
  ];
  for (const regex of patterns) {
    for (const match of String(context || '').matchAll(regex)) {
      const character = clean(match[1]);
      const actor = clean(match[2]);
      if (!character || !actor) continue;
      add(claims, 'characters', [character, '', actor], 'structured-character-cv');
    }
  }

  const rolePattern = /(?:^|\n)\s*([^\n:：]{1,80})\s*[（(]\s*(MAIN|SUPPORT)\s*[）)]\s*[:：]\s*([^\n]{1,100})/gi;
  for (const match of String(context || '').matchAll(rolePattern)) {
    add(claims, 'characters', [match[1], match[2].toUpperCase(), match[3]], 'structured-character-role-cv');
  }
}

function themeLineClaims(context, claims, field, prefix, labels) {
  const labelPattern = labels.join('|');
  const lines = String(context || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!new RegExp(`(?:${labelPattern})`, 'i').test(line)) continue;
    const titleMatch = line.match(/[「『“"]([^」』”"]{1,160})[」』”"]/);
    if (!titleMatch) continue;
    const artist = line.match(/(?:歌|歌唱|アーティスト)\s*[:：]\s*([^、,，;；]+?)(?=\s+(?:作詞|作曲|編曲)\s*[:：]|$)/i)?.[1] || '';
    const lyricist = line.match(/作詞\s*[:：]\s*([^、,，;；]+?)(?=\s+(?:作曲|編曲)\s*[:：]|$)/i)?.[1] || '';
    const composer = line.match(/作曲\s*[:：]\s*([^、,，;；]+?)(?=\s+編曲\s*[:：]|$)/i)?.[1] || '';
    const arranger = line.match(/編曲\s*[:：]\s*([^、,，;；]+)$/i)?.[1] || '';
    add(claims, field, [prefix, titleMatch[1], artist, lyricist, composer, arranger], `structured-${field}`);
  }
}

function extractBroadcastSlots(context, claims) {
  for (const line of String(context || '').split(/\n+/)) {
    const match = line.match(/(?:放送枠|放送日時|放送時間)\s*[:：]\s*([^:：\n]{1,80})\s*[:：]\s*([^\n]{1,120})/i);
    if (match) add(claims, 'broadcast_slots', [match[1], match[2]], 'structured-broadcast-slot');
  }
}

function extractStreaming(context, claims) {
  const modePattern = STREAMING_MODES.map((mode) => mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const lines = String(context || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/(?:配信|見放題|レンタル|購入|独占|先行|最速)/.test(line)) continue;
    const explicit = line.match(new RegExp(`(?:配信サービス|配信先|サービス)?\\s*[:：]?\\s*([^:：\\n]{1,100})\\s*[:：]\\s*(${modePattern})(?:\\s*[:：]\\s*([^:：\\n]{0,80}))?(?:\\s*[:：]\\s*([^:：\\n]{0,40}))?(?:\\s*[:：]\\s*([^\\n]{0,40}))?`, 'i'));
    if (!explicit) continue;
    const service = clean(explicit[1]);
    const mode = STREAMING_MODES.find((value) => value.toLowerCase() === clean(explicit[2]).toLowerCase()) || '';
    const region = clean(explicit[3]);
    const start = normalizeDate(explicit[4]);
    const end = normalizeDate(explicit[5]);
    if (!service || !mode) continue;
    add(claims, 'streaming_services', [service, mode, region, start, end], 'structured-streaming-service');
  }
}

function extractEpisodes(context, claims) {
  const lines = String(context || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const episode = line.match(/第\s*(\d{1,4})\s*話\s*[「『“"]([^」』”"]{1,180})[」』”"](?:\s+|\s*[-–—:：]\s*)((?:19|20|21)\d{2}[年\-/.]\d{1,2}(?:[月\-/.]\d{1,2}日?)?)/);
    if (episode) {
      add(claims, 'episodes', [episode[1], episode[2], normalizeDate(episode[3])], 'structured-episode');
    }

    const staff = line.match(/第\s*(\d{1,4})\s*話[^\n]{0,120}?((?:脚本|絵コンテ|演出|作画監督|総作画監督))\s*[:：]\s*([^\n]{1,120})/);
    if (staff) {
      for (const name of String(staff[3]).split(/\s*(?:、|,|，|;|；)\s*/).map(clean).filter(Boolean)) {
        add(claims, 'episode_staff', [staff[1], staff[2], name], 'structured-episode-staff');
      }
    }
  }
}

function extractAwards(context, claims) {
  for (const line of String(context || '').split(/\n+/).map((value) => value.trim()).filter(Boolean)) {
    const match = line.match(/((?:19|20|21)\d{2})\s*年?\s+([^\n:：]{2,120}?(?:賞|Award|Awards))\s*[:：\-–—]?\s*([^\n]{1,100})/i);
    if (!match) continue;
    add(claims, 'awards', [match[1], match[2], match[3]], 'structured-award');
  }
}

function extractOfficialOther(document, sourceClass, claims) {
  if (sourceClass !== 'primary') return;
  for (const link of document.links || []) {
    let parsed;
    try {
      parsed = new URL(link.url);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pageHost = new URL(document.canonical || document.url).hostname.toLowerCase().replace(/^www\./, '');
    if (host === pageHost || host === 'x.com' || host === 'twitter.com' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') continue;
    const anchor = clean(link.anchor, 100);
    if (!/(?:公式|official)/i.test(anchor)) continue;
    claims.push({ field: 'official_other', value: link.url, rule: 'primary-official-other-link' });
  }
}

export function extractStructuredFieldClaims(document, candidate, context, sourceClass = 'secondary') {
  const claims = [];
  extractStaff(context, claims);
  extractCharacters(context, claims);
  themeLineClaims(context, claims, 'opening_themes', 'OP', ['オープニングテーマ', 'OPテーマ', 'opening theme']);
  themeLineClaims(context, claims, 'ending_themes', 'ED', ['エンディングテーマ', 'EDテーマ', 'ending theme']);
  themeLineClaims(context, claims, 'insert_songs', '挿入歌', ['挿入歌', 'insert song']);
  extractBroadcastSlots(context, claims);
  extractStreaming(context, claims);
  extractEpisodes(context, claims);
  extractAwards(context, claims);
  extractOfficialOther(document, sourceClass, claims);
  return claims;
}
