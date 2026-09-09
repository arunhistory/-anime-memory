const REQUIRED_POLICY_FLAGS = ['apiTermsChecked', 'commercialUse', 'redistribution', 'imageUse', 'rateLimitChecked'];
const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'x-auth-token', 'cookie']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getPath(input, expression) {
  if (!expression) return input;
  let current = input;
  for (const part of String(expression).split('.').filter(Boolean)) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function assertSafeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`情報取得URLはHTTPSのみ許可します: ${url.href}`);
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '::1' ||
      host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '169.254.169.254') {
    throw new Error(`内部・ローカル宛URLは許可しません: ${host}`);
  }
  return url;
}

function validateSource(source) {
  if (!source || typeof source !== 'object') throw new Error('source設定が不正です。');
  if (!source.name || !source.url) throw new Error('source.name と source.url は必須です。');
  if (source.transport !== 'api-json') throw new Error(`${source.name}: API JSON以外の取得方式は許可されていません。`);
  for (const flag of REQUIRED_POLICY_FLAGS) {
    if (source.policy?.[flag] !== true) throw new Error(`${source.name}: 利用条件確認 ${flag} が未承認です。`);
  }
  assertSafeUrl(source.url);
}

function buildHeaders(source) {
  const headers = new Headers({ Accept: 'application/json' });
  for (const [name, rule] of Object.entries(source.headers || {})) {
    const normalizedName = name.trim().toLowerCase();
    if (typeof rule === 'string') {
      if (SECRET_HEADERS.has(normalizedName)) {
        throw new Error(`${source.name}: 秘密情報を含み得るheader ${name} はenv参照で指定してください。`);
      }
      headers.set(name, rule);
      continue;
    }
    if (!rule || typeof rule !== 'object' || !rule.env) throw new Error(`${source.name}: header ${name} の設定が不正です。`);
    const secret = process.env[rule.env];
    if (!secret) throw new Error(`${source.name}: 必要な環境変数 ${rule.env} がありません。`);
    headers.set(name, `${rule.prefix || ''}${secret}${rule.suffix || ''}`);
  }
  return headers;
}

async function fetchJson(url, source) {
  const safeUrl = assertSafeUrl(url);
  const timeoutMs = Math.max(1000, Math.min(Number(source.timeoutMs) || 20000, 60000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(safeUrl, {
      method: 'GET',
      headers: buildHeaders(source),
      signal: controller.signal,
      redirect: 'error'
    });
    if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/application\/(?:[a-z0-9.+-]*\+)?json/i.test(contentType)) {
      throw new Error(`${source.name}: JSON APIではないContent-Typeです: ${contentType || 'unknown'}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractItems(payload, source) {
  const value = getPath(payload, source.itemsPath || '');
  if (!Array.isArray(value)) throw new Error(`${source.name}: itemsPath の値が配列ではありません。`);
  return value;
}

export async function collectSource(source) {
  validateSource(source);
  const requestDelayMs = Math.max(0, Math.min(Number(source.requestDelayMs) || 0, 10000));
  const maxRequests = Math.max(1, Math.min(Number(source.maxRequests) || 100, 1000));
  const allItems = [];
  const base = assertSafeUrl(source.url);
  const pagination = source.pagination || { type: 'none' };
  let cursor = pagination.initialCursor || '';
  let page = Number(pagination.start) || 1;
  let stoppedEarly = false;
  let stopReason = '';

  for (let request = 0; request < maxRequests; request += 1) {
    const url = new URL(base);
    if (pagination.type === 'page') url.searchParams.set(pagination.param || 'page', String(page));
    else if (pagination.type === 'cursor' && cursor) url.searchParams.set(pagination.param || 'cursor', cursor);
    else if (!['none', 'page', 'cursor'].includes(pagination.type)) throw new Error(`${source.name}: pagination.type が不正です。`);

    let payload;
    try {
      payload = await fetchJson(url, source);
    } catch (error) {
      if (allItems.length === 0) throw error;
      stoppedEarly = true;
      stopReason = error instanceof Error ? error.message : 'API取得エラー';
      break;
    }

    const items = extractItems(payload, source);
    allItems.push(...items);

    if (pagination.type === 'none') break;
    if (items.length === 0 && pagination.stopWhenEmpty !== false) break;

    if (pagination.type === 'page') {
      if (pagination.hasMorePath && getPath(payload, pagination.hasMorePath) === false) break;
      page += 1;
    } else {
      const next = getPath(payload, pagination.nextPath || '');
      if (next == null || next === '') break;
      cursor = String(next);
    }

    if (requestDelayMs) await sleep(requestDelayMs);
  }

  return { items: allItems, stoppedEarly, stopReason };
}

export async function collectConfiguredSources(config) {
  if (!config || config.version !== 1 || !Array.isArray(config.sources) || config.sources.length === 0) {
    throw new Error('ANIME_SOURCE_CONFIG_JSON に version=1 と sources を設定してください。');
  }
  const collected = [];
  for (const source of config.sources) {
    const result = await collectSource(source);
    collected.push({ source, ...result });
  }
  return collected;
}
