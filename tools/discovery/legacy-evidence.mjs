import { normalizeUrl } from './url.mjs';

const DETAIL_PATH_SEGMENT = /^(?:staff|cast|staffcast|staff-cast|cast-staff|character|characters|chara|music|song|theme|onair|broadcast|schedule|stream|streaming|delivery|vod|episode|episodes|story|news|article|press|topics?|goods?|special|movie|campaign|gallery|blu-?ray|bluray|bd|dvd|disc|package|packages|product|products|shop|store|event|events|ticket|tickets|exhibition|bonus|contact|privacy|policy|terms|recruit|company)$/i;
const X_RESERVED = new Set(['home', 'explore', 'search', 'i', 'intent', 'share', 'hashtag', 'messages', 'compose', 'settings', 'login', 'signup', 'tos', 'privacy', 'status']);

function legacyLandingSource(sourceUrl) {
  const source = normalizeUrl(sourceUrl);
  if (!source) return '';
  const parsed = new URL(source);
  parsed.hash = '';
  parsed.search = '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length > 2) return '';
  if (segments.some((segment) => DETAIL_PATH_SEGMENT.test(segment))) return '';
  return parsed.href;
}

function legacyLandingUrl(value, sourceUrl) {
  const normalized = normalizeUrl(value);
  const source = legacyLandingSource(sourceUrl);
  if (!normalized || !source || normalized !== source) return '';
  return source;
}

function legacyXProfile(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  const parsed = new URL(normalized);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'x.com' && host !== 'twitter.com') return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return '';
  const handle = segments[0];
  if (!/^[A-Za-z0-9_]{1,30}$/.test(handle) || X_RESERVED.has(handle.toLowerCase())) return '';
  return `${parsed.protocol}//${parsed.host}/${handle}`;
}

function legacyYoutubeChannel(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  const parsed = new URL(normalized);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 1 && /^@[A-Za-z0-9._-]{2,100}$/.test(segments[0])) {
    return `https://www.youtube.com/${segments[0]}`;
  }
  if (segments.length === 2 && ['channel', 'c', 'user'].includes(segments[0].toLowerCase()) && segments[1]) {
    return `https://www.youtube.com/${segments[0]}/${segments[1]}`;
  }
  return '';
}

export function sanitizeLegacyEvidenceItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const field = String(item.field || '');
  const rule = String(item.rule || '');

  if (field === 'official_url' && rule === 'primary-page-url') {
    const value = legacyLandingUrl(item.value, item.sourceUrl);
    return value ? { ...item, value, rule: 'legacy-primary-landing-page-url' } : null;
  }

  if (field === 'official_x' && rule === 'primary-page-social-x') {
    if (!legacyLandingSource(item.sourceUrl)) return null;
    const value = legacyXProfile(item.value);
    return value ? { ...item, value, rule: 'legacy-primary-social-x-profile' } : null;
  }

  if (field === 'official_youtube' && rule === 'primary-page-youtube') {
    if (!legacyLandingSource(item.sourceUrl)) return null;
    const value = legacyYoutubeChannel(item.value);
    return value ? { ...item, value, rule: 'legacy-primary-youtube-channel' } : null;
  }

  return item;
}
