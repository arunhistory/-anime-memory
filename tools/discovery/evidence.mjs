import { normalizeUrl } from './url.mjs';

const SCALAR_FIELDS = new Set([
  'media_type',
  'release_start',
  'theatrical_release_date',
  'animation_studio',
  'director',
  'series_composition',
  'character_design',
  'music',
  'sound_director'
]);

function cleanValue(value, max = 120) {
  return String(value || '')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:：,、/／|｜]+|[\s:：,、/／|｜]+$/g, '')
    .trim()
    .slice(0, max);
}

function candidateContext(document, title) {
  const text = `${document.title || ''}\n${document.ogTitle || ''}\n${document.description || ''}\n${document.text || ''}`;
  if (!title) return text.slice(0, 50000);
  const index = text.indexOf(title);
  if (index < 0) return text.slice(0, 50000);
  return text.slice(Math.max(0, index - 6000), Math.min(text.length, index + title.length + 12000));
}

function normalizeDate(year, month = '', day = '') {
  const y = Number(year);
  const m = month === '' ? null : Number(month);
  const d = day === '' ? null : Number(day);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) return null;
  if (m === null) return String(y).padStart(4, '0');
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (d === null) return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extractEventDates(context) {
  const claims = [];
  const lines = String(context || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const datePattern = /(19\d{2}|20\d{2}|21\d{2})\s*(?:年|[-/.])\s*(\d{1,2})(?:\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日)?)?/g;

  for (const line of lines.slice(0, 2000)) {
    if (!/(放送|配信|公開|上映|ロードショー|開始|スタート)/.test(line)) continue;
    for (const match of line.matchAll(datePattern)) {
      const value = normalizeDate(match[1], match[2], match[3] || '');
      if (!value) continue;
      const theatrical = /(劇場|映画|上映|ロードショー|劇場公開)/.test(line);
      claims.push({
        field: theatrical ? 'theatrical_release_date' : 'release_start',
        value,
        rule: theatrical ? 'event-date-theatrical' : 'event-date-release'
      });
    }
  }
  return claims;
}

function extractMediaType(context) {
  const text = String(context || '').normalize('NFKC').toLocaleLowerCase('ja');
  const rules = [
    ['OVA', /\bova\b|オリジナルビデオアニメ|オリジナル・ビデオ・アニメ/],
    ['ONA', /\bona\b|webアニメ|ウェブアニメ|ネットアニメ/],
    ['MOVIE', /劇場アニメ|劇場版|アニメ映画|長編アニメ映画/],
    ['SHORT', /短編アニメ|ショートアニメ/],
    ['SPECIAL', /テレビスペシャル|tvスペシャル|特別編アニメ/],
    ['TV', /tvアニメ|テレビアニメ|tv animation/]
  ];
  for (const [value, regex] of rules) if (regex.test(text)) return { field: 'media_type', value, rule: `media-${value.toLowerCase()}` };
  return null;
}

function extractLabeledValues(context) {
  const claims = [];
  const rules = [
    ['animation_studio', /(?:アニメーション制作|アニメ制作)\s*[:：]\s*([^\n]{1,120})/gi, 'label-animation-studio'],
    ['director', /(?:^|\s)監督\s*[:：]\s*([^\n]{1,120})/gi, 'label-director'],
    ['series_composition', /シリーズ構成\s*[:：]\s*([^\n]{1,120})/gi, 'label-series-composition'],
    ['character_design', /キャラクターデザイン\s*[:：]\s*([^\n]{1,120})/gi, 'label-character-design'],
    ['music', /(?:^|\s)音楽\s*[:：]\s*([^\n]{1,120})/gi, 'label-music'],
    ['sound_director', /音響監督\s*[:：]\s*([^\n]{1,120})/gi, 'label-sound-director']
  ];

  for (const [field, regex, rule] of rules) {
    let count = 0;
    for (const match of String(context || '').matchAll(regex)) {
      const value = cleanValue(match[1]);
      if (!value || value.length > 100) continue;
      claims.push({ field, value, rule });
      count += 1;
      if (count >= 5) break;
    }
  }
  return claims;
}

function normalizeEvidenceValue(field, value) {
  let normalized = cleanValue(value, 160).normalize('NFKC');
  if (field === 'media_type') normalized = normalized.toUpperCase();
  return normalized;
}

function evidenceKey(item) {
  return `${item.field}\u0000${normalizeEvidenceValue(item.field, item.value)}\u0000${item.sourceUrl}`;
}

export function extractCandidateEvidence(document, candidate, observedAt = new Date().toISOString()) {
  const sourceUrl = normalizeUrl(document.canonical || document.url);
  if (!sourceUrl || !candidate?.title) return [];
  const context = candidateContext(document, candidate.title);
  const rawClaims = [
    { field: 'title_ja', value: candidate.title, rule: 'anime-title-candidate' },
    extractMediaType(context),
    ...extractEventDates(context),
    ...extractLabeledValues(context)
  ].filter(Boolean);

  const seen = new Set();
  const output = [];
  for (const claim of rawClaims) {
    const field = String(claim.field || '');
    if (field !== 'title_ja' && !SCALAR_FIELDS.has(field)) continue;
    const value = normalizeEvidenceValue(field, claim.value);
    if (!value) continue;
    const item = {
      field,
      value,
      sourceUrl,
      rule: String(claim.rule || 'unknown').slice(0, 80),
      observedAt: String(observedAt || '').slice(0, 40)
    };
    const key = evidenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output.slice(0, 100);
}

export function mergeEvidence(existing = [], incoming = []) {
  const map = new Map();
  for (const item of [...existing, ...incoming]) {
    const sourceUrl = normalizeUrl(item?.sourceUrl);
    const field = String(item?.field || '');
    const value = normalizeEvidenceValue(field, item?.value);
    if (!sourceUrl || !field || !value) continue;
    const clean = {
      field,
      value,
      sourceUrl,
      rule: String(item?.rule || '').slice(0, 80),
      observedAt: String(item?.observedAt || '').slice(0, 40)
    };
    map.set(evidenceKey(clean), clean);
  }
  return [...map.values()].slice(-250);
}

export function resolveEvidence(evidence = []) {
  const byField = new Map();
  for (const item of evidence) {
    const field = String(item?.field || '');
    const value = normalizeEvidenceValue(field, item?.value);
    const sourceUrl = normalizeUrl(item?.sourceUrl);
    if (!field || !value || !sourceUrl) continue;
    if (!byField.has(field)) byField.set(field, new Map());
    const values = byField.get(field);
    if (!values.has(value)) values.set(value, { value, sources: new Set(), hosts: new Set(), evidenceCount: 0 });
    const bucket = values.get(value);
    bucket.sources.add(sourceUrl);
    bucket.hosts.add(new URL(sourceUrl).hostname.toLowerCase());
    bucket.evidenceCount += 1;
  }

  const facts = {};
  for (const [field, values] of byField) {
    const alternatives = [...values.values()]
      .map((entry) => ({
        value: entry.value,
        sourceCount: entry.sources.size,
        hostCount: entry.hosts.size,
        evidenceCount: entry.evidenceCount
      }))
      .sort((a, b) => b.hostCount - a.hostCount || b.sourceCount - a.sourceCount || b.evidenceCount - a.evidenceCount || a.value.localeCompare(b.value));

    if (alternatives.length === 1) {
      const top = alternatives[0];
      facts[field] = {
        status: top.hostCount >= 2 ? 'confirmed' : 'observed',
        value: top.value,
        sourceCount: top.sourceCount,
        hostCount: top.hostCount,
        alternatives: []
      };
      continue;
    }

    const first = alternatives[0];
    const second = alternatives[1];
    if (first.hostCount >= 2 && first.hostCount > second.hostCount) {
      facts[field] = {
        status: 'confirmed',
        value: first.value,
        sourceCount: first.sourceCount,
        hostCount: first.hostCount,
        alternatives: alternatives.slice(1, 5)
      };
    } else {
      facts[field] = {
        status: 'conflict',
        value: '',
        sourceCount: first.sourceCount,
        hostCount: first.hostCount,
        alternatives: alternatives.slice(0, 5)
      };
    }
  }
  return facts;
}
