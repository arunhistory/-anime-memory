import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { normalizeUrl, isForbiddenHostname, isPrivateIp } from './url.mjs';
import { parseRobotsTxt, evaluateRobots } from './robots.mjs';

const TEXT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizeAllowedHosts(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,]+/);
  return new Set(values
    .map((item) => String(item || '').trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean));
}

async function defaultResolveHost(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

class HeaderView {
  constructor(headers = {}) {
    this.map = new Map();
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) this.map.set(name.toLowerCase(), value.join(', '));
      else if (value !== undefined) this.map.set(name.toLowerCase(), String(value));
    }
  }

  get(name) {
    return this.map.get(String(name || '').toLowerCase()) || null;
  }
}

class BufferedResponse {
  constructor(status, headers, buffer) {
    this.status = Number(status || 0);
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new HeaderView(headers);
    this.body = null;
    this.buffer = Buffer.from(buffer || []);
  }

  async arrayBuffer() {
    return this.buffer.buffer.slice(this.buffer.byteOffset, this.buffer.byteOffset + this.buffer.byteLength);
  }
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw new Error(`response-too-large:${declared}`);

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`response-too-large:${buffer.length}`);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('max-bytes');
        throw new Error(`response-too-large:${total}`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

function detectCharset(contentType, bytes) {
  const headerMatch = String(contentType || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  if (headerMatch) return headerMatch[1].toLowerCase();
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192)).toString('ascii');
  const metaMatch = sample.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'/>]+)/i)
    || sample.match(/<meta[^>]+content=["'][^"']*charset\s*=\s*([^\s"';>]+)/i);
  return metaMatch ? metaMatch[1].toLowerCase() : 'utf-8';
}

function normalizeCharset(charset) {
  const lower = String(charset || '').toLowerCase().replace(/_/g, '-');
  if (['shift-jis', 'shift_jis', 'sjis', 'windows-31j', 'cp932'].includes(lower)) return 'shift_jis';
  if (['euc-jp', 'eucjp'].includes(lower)) return 'euc-jp';
  if (['utf8', 'utf-8'].includes(lower)) return 'utf-8';
  return lower;
}

function decodeBytes(bytes, contentType) {
  const charset = normalizeCharset(detectCharset(contentType, bytes));
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function isAcceptedContentType(contentType) {
  const lower = String(contentType || '').toLowerCase();
  return TEXT_TYPES.some((type) => lower.includes(type));
}

export class PoliteFetcher {
  constructor(options = {}) {
    this.userAgent = options.userAgent || 'AnimeMemoryBot/1.0 (+https://github.com/arunhistory/-anime-memory; respects robots.txt)';
    this.timeoutMs = clamp(options.timeoutMs, 1000, 30000, 12000);
    this.maxBytes = clamp(options.maxBytes, 32 * 1024, 4 * 1024 * 1024, 1024 * 1024);
    this.minDelayMs = clamp(options.minDelayMs, 0, 10000, 500);
    this.maxRedirects = clamp(options.maxRedirects, 0, 5, 3);
    this.fetchImpl = options.fetchImpl || null;
    this.resolveHost = options.resolveHost || defaultResolveHost;
    this.waitImpl = options.waitImpl || sleep;
    this.allowedHosts = normalizeAllowedHosts(options.allowedHosts);
    this.robotsCache = new Map();
    this.nextRequestAt = new Map();
  }

  isHostAllowed(url) {
    if (this.allowedHosts.size === 0) return true;
    const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    return this.allowedHosts.has(hostname);
  }

  async assertPublicHost(url) {
    const parsed = new URL(url);
    if (!this.isHostAllowed(url)) throw new Error('host-not-allowed');
    if (isForbiddenHostname(parsed.hostname)) throw new Error('forbidden-host');
    const resolved = await this.resolveHost(parsed.hostname);
    if (!Array.isArray(resolved) || resolved.length === 0) throw new Error('dns-empty');
    const normalized = resolved.map((entry) => ({
      address: String(entry?.address || ''),
      family: Number(entry?.family || net.isIP(String(entry?.address || '')))
    }));
    if (normalized.some((entry) => !net.isIP(entry.address))) throw new Error('dns-invalid-address');
    if (normalized.some((entry) => isPrivateIp(entry.address))) throw new Error('private-address');
    return normalized;
  }

  async waitForHost(origin, crawlDelayMs = 0) {
    const delay = Math.max(this.minDelayMs, crawlDelayMs);
    const now = Date.now();
    const next = this.nextRequestAt.get(origin) || 0;
    if (next > now) await this.waitImpl(next - now);
    this.nextRequestAt.set(origin, Date.now() + delay);
  }

  async pinnedFetch(url, options = {}) {
    const parsed = new URL(url);
    const resolved = await this.assertPublicHost(url);
    const selected = resolved[0];
    const transport = parsed.protocol === 'https:' ? https : http;
    const maxBytes = this.maxBytes;

    return new Promise((resolve, reject) => {
      let settled = false;
      const request = transport.request(parsed, {
        method: 'GET',
        servername: parsed.hostname,
        family: selected.family,
        autoSelectFamily: false,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions?.all) callback(null, [{ address: selected.address, family: selected.family }]);
          else callback(null, selected.address, selected.family);
        },
        headers: {
          'user-agent': this.userAgent,
          accept: options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.1'
        }
      }, (response) => {
        const chunks = [];
        let total = 0;
        response.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            response.destroy(new Error(`response-too-large:${total}`));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          resolve(new BufferedResponse(response.statusCode, response.headers, Buffer.concat(chunks, total)));
        });
        response.on('error', (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
      });

      request.setTimeout(this.timeoutMs, () => request.destroy(new Error('request-timeout')));
      request.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      request.end();
    });
  }

  async rawFetch(url, options = {}) {
    if (!this.fetchImpl) return this.pinnedFetch(url, options);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': this.userAgent,
          accept: options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.1'
        }
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async robotsFor(url) {
    const parsed = new URL(url);
    const origin = parsed.origin;
    if (this.robotsCache.has(origin)) return this.robotsCache.get(origin);

    const robotsUrl = `${origin}/robots.txt`;
    try {
      await this.assertPublicHost(robotsUrl);
      await this.waitForHost(origin, 0);
      const response = await this.rawFetch(robotsUrl, { accept: 'text/plain,*/*;q=0.1' });
      if (response.status === 404 || response.status === 410) {
        const result = { available: false, groups: [], safe: true };
        this.robotsCache.set(origin, result);
        return result;
      }
      if (!response.ok) {
        const result = { available: false, groups: [], safe: false, reason: `robots-http-${response.status}` };
        this.robotsCache.set(origin, result);
        return result;
      }
      const bytes = await readLimitedBody(response, Math.min(this.maxBytes, 512 * 1024));
      const text = decodeBytes(bytes, response.headers.get('content-type'));
      const result = { available: true, groups: parseRobotsTxt(text), safe: true };
      this.robotsCache.set(origin, result);
      return result;
    } catch (error) {
      const result = { available: false, groups: [], safe: false, reason: `robots-fetch:${error.message}` };
      this.robotsCache.set(origin, result);
      return result;
    }
  }

  async fetchPage(rawUrl) {
    let current = normalizeUrl(rawUrl);
    if (!current) return { ok: false, skipped: true, reason: 'invalid-url' };

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      const parsed = new URL(current);
      if (!this.isHostAllowed(current)) return { ok: false, skipped: true, reason: 'host-not-allowed' };
      try {
        await this.assertPublicHost(current);
      } catch (error) {
        return { ok: false, skipped: true, reason: String(error?.message || 'host-check-failed') };
      }

      const robots = await this.robotsFor(current);
      if (!robots.safe) return { ok: false, skipped: true, reason: robots.reason || 'robots-unavailable' };
      const decision = evaluateRobots(robots.groups, this.userAgent, `${parsed.pathname}${parsed.search}`);
      if (!decision.allowed) return { ok: false, skipped: true, reason: 'robots-disallow' };

      await this.waitForHost(parsed.origin, decision.crawlDelayMs);
      let response;
      try {
        response = await this.rawFetch(current);
      } catch (error) {
        return { ok: false, skipped: false, reason: `fetch:${error.message}` };
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        const next = normalizeUrl(location, current);
        if (!next) return { ok: false, skipped: true, reason: 'bad-redirect' };
        if (!this.isHostAllowed(next)) return { ok: false, skipped: true, reason: 'host-not-allowed' };
        current = next;
        continue;
      }

      if (!response.ok) return { ok: false, skipped: response.status >= 400 && response.status < 500, reason: `http-${response.status}` };
      const contentType = response.headers.get('content-type') || '';
      if (!isAcceptedContentType(contentType)) return { ok: false, skipped: true, reason: `unsupported-content-type:${contentType}` };

      try {
        const bytes = await readLimitedBody(response, this.maxBytes);
        return {
          ok: true,
          url: current,
          contentType,
          text: decodeBytes(bytes, contentType),
          etag: response.headers.get('etag') || '',
          lastModified: response.headers.get('last-modified') || '',
          sitemaps: decision.sitemaps
        };
      } catch (error) {
        return { ok: false, skipped: true, reason: error.message };
      }
    }

    return { ok: false, skipped: true, reason: 'redirect-limit' };
  }
}
