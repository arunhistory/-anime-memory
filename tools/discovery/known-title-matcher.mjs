import { normalizeTitleKey } from './html.mjs';
import { discoveryCandidateReadiness } from './to-record.mjs';

const LONG_PREFIX_LENGTH = 4;
const MIN_KEY_LENGTH = 2;

function chars(value) {
  return Array.from(String(value || ''));
}

function normalizedTitle(candidate) {
  if (!discoveryCandidateReadiness(candidate).ready) return '';
  return normalizeTitleKey(candidate?.facts?.title_ja?.value || '');
}

function addBucket(buckets, length, prefix, key) {
  if (!buckets.has(length)) buckets.set(length, new Map());
  const map = buckets.get(length);
  if (!map.has(prefix)) map.set(prefix, []);
  map.get(prefix).push(key);
}

export function buildConfirmedTitleMatcher(candidates = []) {
  const buckets = new Map();
  const keys = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = normalizedTitle(candidate);
    const keyChars = chars(key);
    if (keyChars.length < MIN_KEY_LENGTH || keys.has(key)) continue;
    keys.add(key);
    const length = Math.min(LONG_PREFIX_LENGTH, keyChars.length);
    addBucket(buckets, length, keyChars.slice(0, length).join(''), key);
  }
  return { version: 1, buckets, size: keys.size };
}

function normalizedPageText(document, includeBody) {
  const values = [document?.title, document?.ogTitle, document?.description, document?.keywords];
  if (includeBody) values.push(String(document?.text || '').slice(0, 120000));
  return normalizeTitleKey(values.filter(Boolean).join(' '));
}

function collectMatchesForLength(text, length, buckets, output, tested) {
  const bucket = buckets.get(length);
  if (!bucket?.size || !text) return;
  const textChars = chars(text);
  if (textChars.length < length) return;
  for (let index = 0; index <= textChars.length - length; index += 1) {
    const prefix = textChars.slice(index, index + length).join('');
    const candidates = bucket.get(prefix);
    if (!candidates) continue;
    for (const key of candidates) {
      if (tested.has(key)) continue;
      tested.add(key);
      if (text.includes(key)) output.add(key);
    }
  }
}

export function matchConfirmedTitleKeys(matcher, document) {
  if (!matcher || matcher.version !== 1 || !(matcher.buckets instanceof Map) || matcher.size === 0) return [];
  const output = new Set();
  const tested = new Set();

  // Very short titles are ambiguous in article bodies (e.g. numbers or initials), so
  // lengths 2-3 require a headline/metadata mention. Titles of length 4+ may match the
  // fetched page body because the full body is available transiently at crawl time.
  const metadata = normalizedPageText(document, false);
  collectMatchesForLength(metadata, 2, matcher.buckets, output, tested);
  collectMatchesForLength(metadata, 3, matcher.buckets, output, tested);

  const fullText = normalizedPageText(document, true);
  collectMatchesForLength(fullText, LONG_PREFIX_LENGTH, matcher.buckets, output, tested);
  return [...output];
}
