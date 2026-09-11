import { normalizeOfficialLandingUrl } from './official-page.mjs';
import { normalizeUrl } from './url.mjs';

const X_RESERVED = new Set(['home', 'explore', 'search', 'i', 'intent', 'share', 'hashtag', 'messages', 'compose', 'settings', 'login', 'signup', 'tos', 'privacy', 'status']);

function legacyLandingSource(sourceUrl) {
  return normalizeOfficialLandingUrl(sourceUrl);
}

function legacyLandingUrl(value, sourceUrl) {
  const normalized = normalizeOfficialLandingUrl(value);
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
