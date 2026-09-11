import { normalizeUrl } from './url.mjs';

const DETAIL_PATH_SEGMENT = /^(?:staff|cast|staffcast|staff-cast|cast-staff|character|characters|chara|music|song|theme|onair|broadcast|schedule|stream|streaming|delivery|vod|episode|episodes|story|news|article|press|topics?|contact|privacy|policy|terms|recruit|company|goods?|shop|store|campaign|gallery|blu-?ray|bluray|bd|dvd|disc|package|ticket|event|product|products)$/i;
const POST_PATH_SEGMENT = /^post[-_]?\d+$/i;

export function normalizeOfficialLandingUrl(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  parsed.hash = '';
  parsed.search = '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length > 2) return '';
  if (segments.some((segment) => DETAIL_PATH_SEGMENT.test(segment) || POST_PATH_SEGMENT.test(segment))) return '';
  return parsed.href;
}
