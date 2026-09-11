import { normalizeOfficialLandingUrl } from './official-page.mjs';
import { normalizeUrl } from './url.mjs';

const X_RESERVED = new Set(['home', 'explore', 'search', 'i', 'intent', 'share', 'hashtag', 'messages', 'compose', 'settings', 'login', 'signup', 'tos', 'privacy', 'status']);
const LANDING_URL_RULES = new Set(['primary-page-url', 'primary-landing-page-url', 'legacy-primary-landing-page-url']);
const LANDING_X_RULES = new Set(['primary-page-social-x', 'primary-landing-social-x-profile', 'legacy-primary-social-x-profile']);
const LANDING_YOUTUBE_RULES = new Set(['primary-page-youtube', 'primary-landing-youtube-channel', 'legacy-primary-youtube-channel']);

function landingSource(sourceUrl) {
  return normalizeOfficialLandingUrl(sourceUrl);
}

function landingUrl(value, sourceUrl) {
  const normalized = normalizeOfficialLandingUrl(value);
  const source = landingSource(sourceUrl);
  if (!normalized || !source || normalized !== source) return '';
  return source;
}

function xProfile(value) {
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

function youtubeChannel(value) {
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

  if (field === 'official_url' && LANDING_URL_RULES.has(rule)) {
    const value = landingUrl(item.value, item.sourceUrl);
    if (!value) return null;
    return rule === 'primary-page-url'
      ? { ...item, value, rule: 'legacy-primary-landing-page-url' }
      : { ...item, value };
  }

  if (field === 'official_x' && LANDING_X_RULES.has(rule)) {
    if (!landingSource(item.sourceUrl)) return null;
    const value = xProfile(item.value);
    if (!value) return null;
    return rule === 'primary-page-social-x'
      ? { ...item, value, rule: 'legacy-primary-social-x-profile' }
      : { ...item, value };
  }

  if (field === 'official_youtube' && LANDING_YOUTUBE_RULES.has(rule)) {
    if (!landingSource(item.sourceUrl)) return null;
    const value = youtubeChannel(item.value);
    if (!value) return null;
    return rule === 'primary-page-youtube'
      ? { ...item, value, rule: 'legacy-primary-youtube-channel' }
      : { ...item, value };
  }

  return item;
}
