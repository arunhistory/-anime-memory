import { normalizeUrl, looksLikeFetchablePage } from './url.mjs';

const MAX_TEXT = 250000;
const MAX_LINKS = 5000;

const ENTITY_MAP = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' ']
]);

function decodeEntities(value) {
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, token) => {
    const lower = token.toLowerCase();
    if (ENTITY_MAP.has(lower)) return ENTITY_MAP.get(lower);
    if (lower.startsWith('#x')) {
      const cp = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    }
    if (lower.startsWith('#')) {
      const cp = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    }
    return _;
  });
}

function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<\/div\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attrValue(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeEntities(match ? (match[1] ?? match[2] ?? match[3] ?? '') : '');
}

function extractMeta(html) {
  const meta = new Map();
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (attrValue(tag, 'property') || attrValue(tag, 'name') || attrValue(tag, 'itemprop')).toLowerCase();
    const content = attrValue(tag, 'content');
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  return meta;
}

function extractJsonLd(html) {
  const values = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      values.push(JSON.parse(match[1].trim()));
    } catch {
      // Broken JSON-LD must not abort the entire page.
    }
  }
  return values;
}

function collectJsonLdHints(node, output, depth = 0) {
  if (depth > 8 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdHints(item, output, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  for (const key of ['name', 'headline', 'alternativeHeadline']) {
    if (typeof node[key] === 'string' && node[key].trim()) output.text.push(node[key].trim());
  }
  for (const key of ['url', 'sameAs']) {
    const value = node[key];
    if (typeof value === 'string') output.urls.push(value);
    else if (Array.isArray(value)) output.urls.push(...value.filter((item) => typeof item === 'string'));
  }
  for (const value of Object.values(node)) collectJsonLdHints(value, output, depth + 1);
}

function cleanCandidateTitle(value) {
  let text = decodeEntities(String(value || '')).trim();
  text = text.replace(/^[\s:：―—–\-]+|[\s:：―—–\-]+$/g, '');
  text = text.replace(/\s{2,}/g, ' ');
  if (text.length < 1 || text.length > 120) return null;
  if (/^(?:アニメ|anime|作品|公式|ニュース|最新情報)$/i.test(text)) return null;
  return text;
}

export function normalizeTitleKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[\s\u3000\-‐‑‒–—―・･:：!！?？'"“”‘’「」『』【】［］\[\]（）()]/g, '');
}

export function extractAnimeTitleCandidates(document) {
  const haystack = [document.title, document.ogTitle, document.description, document.text.slice(0, 80000)]
    .filter(Boolean)
    .join('\n');
  const found = new Map();

  const patterns = [
    /(?:TV|テレビ|劇場|Web|WEB|配信|短編)?\s*アニメ(?:ーション)?(?:作品)?\s*[「『“"]([^」』”"\n]{1,120})[」』”"]/g,
    /[「『“"]([^」』”"\n]{1,120})[」』”"]\s*(?:TV|テレビ|劇場|Web|WEB)?\s*アニメ(?:化|ーション化|放送|配信|制作|公開|決定)/g,
    /(?:新作|オリジナル)\s*(?:TV|テレビ|劇場|Web|WEB)?\s*アニメ\s*[「『“"]?([^」』”"\n|｜]{1,100})[」』”"]?/g,
    /(?:TV|テレビ|劇場|Web|WEB)?\s*アニメ\s*[「『“"]?([^」』”"\n|｜]{1,100})[」』”"]?\s*(?:公式|PV|ティザー|キャスト|スタッフ|放送|配信)/g
  ];

  for (const regex of patterns) {
    for (const match of haystack.matchAll(regex)) {
      const title = cleanCandidateTitle(match[1]);
      const key = normalizeTitleKey(title);
      if (title && key && !found.has(key)) found.set(key, title);
    }
  }

  if (/\b(?:anime|アニメ)\b/i.test(`${document.title} ${document.ogTitle}`)) {
    for (const raw of [document.ogTitle, document.title]) {
      if (!raw) continue;
      const cleaned = cleanCandidateTitle(
        raw
          .replace(/\s*[|｜]\s*(?:公式(?:サイト)?|official(?: site)?).*$/i, '')
          .replace(/(?:TV|テレビ|劇場|Web|WEB)?\s*アニメ(?:ーション)?\s*/gi, '')
          .replace(/\s*[-–—]\s*(?:公式(?:サイト)?|official(?: site)?).*$/i, '')
      );
      const key = normalizeTitleKey(cleaned);
      if (cleaned && key && key.length >= 2 && !found.has(key)) found.set(key, cleaned);
    }
  }

  return [...found.entries()].map(([key, title]) => ({ key, title }));
}

export function extractDocument(html, pageUrl) {
  const source = String(html || '');
  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const meta = extractMeta(source);
  const jsonLd = extractJsonLd(source);
  const jsonHints = { text: [], urls: [] };
  for (const node of jsonLd) collectJsonLdHints(node, jsonHints);

  const links = [];
  const seen = new Set();
  for (const match of source.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    if (links.length >= MAX_LINKS) break;
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? '');
    const url = normalizeUrl(href, pageUrl);
    if (!url || !looksLikeFetchablePage(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, anchor: stripTags(match[4]).slice(0, 300) });
  }
  for (const raw of jsonHints.urls) {
    if (links.length >= MAX_LINKS) break;
    const url = normalizeUrl(raw, pageUrl);
    if (!url || !looksLikeFetchablePage(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, anchor: '' });
  }

  const canonicalMatch = source.match(/<link\b[^>]*rel\s*=\s*(?:"canonical"|'canonical'|canonical)[^>]*>/i);
  const canonical = canonicalMatch ? normalizeUrl(attrValue(canonicalMatch[0], 'href'), pageUrl) : null;
  const title = stripTags(titleMatch ? titleMatch[1] : '').slice(0, 500);
  const ogTitle = (meta.get('og:title') || '').slice(0, 500);
  const description = (meta.get('description') || meta.get('og:description') || '').slice(0, 1000);
  const text = `${stripTags(source)}\n${jsonHints.text.join('\n')}`.slice(0, MAX_TEXT);

  const document = {
    url: pageUrl,
    canonical,
    title,
    ogTitle,
    description,
    text,
    links,
    noindex: /<meta\b[^>]*(?:name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex|content\s*=\s*["'][^"']*noindex[^"']*["'][^>]*name\s*=\s*["']robots["'])/i.test(source),
    nofollow: /<meta\b[^>]*(?:name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*nofollow|content\s*=\s*["'][^"']*nofollow[^"']*["'][^>]*name\s*=\s*["']robots["'])/i.test(source)
  };
  document.candidates = extractAnimeTitleCandidates(document);
  return document;
}

export function extractSitemapUrls(xml, baseUrl) {
  const urls = [];
  for (const match of String(xml || '').matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)) {
    const url = normalizeUrl(decodeEntities(match[1].trim()), baseUrl);
    if (url && looksLikeFetchablePage(url)) urls.push(url);
  }
  return [...new Set(urls)];
}
