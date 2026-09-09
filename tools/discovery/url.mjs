import crypto from 'node:crypto';
import net from 'node:net';

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', '_ga', '_gl', 'ref_src', 'ref_url'
]);

const NON_PAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp3|m4a|ogg|wav|flac|mp4|m4v|mov|avi|mkv|webm|zip|rar|7z|tar|gz|bz2|xz|exe|dmg|apk|woff2?|ttf|otf)(?:$|[?#])/i;

export function normalizeUrl(raw, base = undefined) {
  if (!raw) return null;
  let url;
  try {
    url = base ? new URL(String(raw).trim(), base) : new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function looksLikeFetchablePage(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  return !NON_PAGE_EXTENSIONS.test(normalized);
}

export function urlHash(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex');
}

export function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
  }
  return false;
}

export function isForbiddenHostname(hostname) {
  const lower = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!lower) return true;
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return true;
  if (net.isIP(lower)) return isPrivateIp(lower);
  return false;
}

export function hostKey(url) {
  const parsed = new URL(url);
  return parsed.host.toLowerCase();
}
