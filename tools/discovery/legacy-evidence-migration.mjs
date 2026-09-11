import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiscoveryState, saveDiscoveryState } from './state.mjs';
import { normalizeUrl } from './url.mjs';

const DETAIL_SEGMENT = /^(?:staff|cast|staffcast|cast-staff|character|characters|chara|music|song|theme|onair|broadcast|schedule|stream|streaming|delivery|vod|episode|episodes|story|news|article|press|topics?|contact|privacy|policy|terms|recruit|company)$/i;
const X_RESERVED = new Set(['home', 'explore', 'search', 'i', 'intent', 'share', 'hashtag', 'messages', 'compose', 'settings', 'login', 'signup', 'tos', 'privacy', 'status']);
const LEGACY_RULES = new Set(['primary-page-url', 'primary-page-social-x', 'primary-page-youtube']);

function landingUrl(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return '';
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length > 2) return '';
  if (segments.some((segment) => DETAIL_SEGMENT.test(segment))) return '';
  return normalized;
}

function xProfile(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'x.com' && host !== 'twitter.com') return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return '';
  const handle = segments[0];
  if (!/^[A-Za-z0-9_]{1,30}$/.test(handle) || X_RESERVED.has(handle.toLowerCase())) return '';
  parsed.hash = '';
  parsed.search = '';
  return parsed.href.replace(/\/$/, '');
}

function youtubeChannel(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  let pathname = '';
  if (segments.length === 1 && /^@[A-Za-z0-9._-]{2,100}$/.test(segments[0])) {
    pathname = `/${segments[0]}`;
  } else if (segments.length === 2 && ['channel', 'c', 'user'].includes(segments[0].toLowerCase()) && segments[1]) {
    pathname = `/${segments[0]}/${segments[1]}`;
  } else {
    return '';
  }
  return `https://www.youtube.com${pathname}`;
}

export function migrateLegacyOfficialEvidence(values) {
  const source = Array.isArray(values) ? values : [];
  const output = [];
  let removed = 0;
  let rewritten = 0;

  for (const item of source) {
    const rule = String(item?.rule || '');
    if (!LEGACY_RULES.has(rule)) {
      output.push(item);
      continue;
    }

    const sourceLanding = landingUrl(item?.sourceUrl);
    if (!sourceLanding) {
      removed += 1;
      continue;
    }

    if (rule === 'primary-page-url') {
      const value = landingUrl(item?.value);
      if (!value || value !== sourceLanding) {
        removed += 1;
        continue;
      }
      output.push({ ...item, value, rule: 'primary-landing-page-url' });
      rewritten += 1;
      continue;
    }

    if (rule === 'primary-page-social-x') {
      const value = xProfile(item?.value);
      if (!value) {
        removed += 1;
        continue;
      }
      output.push({ ...item, value, rule: 'primary-landing-social-x-profile' });
      rewritten += 1;
      continue;
    }

    const value = youtubeChannel(item?.value);
    if (!value) {
      removed += 1;
      continue;
    }
    output.push({ ...item, value, rule: 'primary-landing-youtube-channel' });
    rewritten += 1;
  }

  return { evidence: output, removed, rewritten };
}

export function migrateDiscoveryStateLegacyEvidence(state) {
  let removed = 0;
  let rewritten = 0;
  let candidatesChanged = 0;
  for (const candidate of state?.candidates || []) {
    const result = migrateLegacyOfficialEvidence(candidate?.evidence);
    removed += result.removed;
    rewritten += result.rewritten;
    if (result.removed || result.rewritten) {
      candidate.evidence = result.evidence;
      candidatesChanged += 1;
    }
  }
  return { removed, rewritten, candidatesChanged };
}

function stateArg(argv) {
  const index = argv.indexOf('--state');
  if (index >= 0 && argv[index + 1]) return path.resolve(argv[index + 1]);
  return path.resolve('crawler/state.json');
}

const current = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current) {
  const statePath = stateArg(process.argv.slice(2));
  const state = loadDiscoveryState(statePath);
  const result = migrateDiscoveryStateLegacyEvidence(state);
  if (result.candidatesChanged > 0) saveDiscoveryState(statePath, state);
  console.log(`Legacy official evidence migration: ${result.candidatesChanged > 0 ? 'CHANGED' : 'NO-OP'}`);
  console.log(`candidates changed: ${result.candidatesChanged}`);
  console.log(`legacy evidence removed: ${result.removed}`);
  console.log(`legacy evidence rewritten: ${result.rewritten}`);
}
