function normalizeAgent(value) {
  return String(value || '').trim().toLowerCase();
}

function compileRule(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) return null;
  const endAnchored = raw.endsWith('$');
  const body = endAnchored ? raw.slice(0, -1) : raw;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${endAnchored ? '$' : ''}`);
}

export function parseRobotsTxt(text) {
  const groups = [];
  let current = null;
  let seenDirective = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/#.*$/, '').trim();
    if (!withoutComment) continue;
    const match = withoutComment.match(/^([^:]+):(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();

    if (key === 'user-agent') {
      if (!current || seenDirective) {
        current = { agents: [], rules: [], crawlDelay: null, sitemaps: [] };
        groups.push(current);
        seenDirective = false;
      }
      current.agents.push(normalizeAgent(value));
      continue;
    }
    if (!current) continue;
    seenDirective = true;

    if (key === 'allow' || key === 'disallow') {
      if (!value && key === 'disallow') continue;
      const regex = compileRule(value);
      if (regex) current.rules.push({ type: key, pattern: value, regex });
    } else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    } else if (key === 'sitemap') {
      if (value) current.sitemaps.push(value);
    }
  }
  return groups;
}

function selectGroups(groups, userAgent) {
  const ua = normalizeAgent(userAgent);
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== '*' && ua.includes(agent)));
  if (specific.length) return specific;
  return groups.filter((group) => group.agents.includes('*'));
}

export function evaluateRobots(groups, userAgent, pathnameWithQuery) {
  const selected = selectGroups(groups, userAgent);
  if (!selected.length) return { allowed: true, crawlDelayMs: 0, sitemaps: [] };

  const rules = selected.flatMap((group) => group.rules);
  const matches = rules
    .filter((rule) => rule.regex.test(pathnameWithQuery))
    .sort((a, b) => {
      const lengthDiff = b.pattern.length - a.pattern.length;
      if (lengthDiff !== 0) return lengthDiff;
      if (a.type === b.type) return 0;
      return a.type === 'allow' ? -1 : 1;
    });

  const delays = selected.map((group) => group.crawlDelay).filter((value) => value !== null);
  const crawlDelayMs = delays.length ? Math.max(...delays) * 1000 : 0;
  const sitemaps = [...new Set(selected.flatMap((group) => group.sitemaps))];
  return {
    allowed: matches.length ? matches[0].type === 'allow' : true,
    crawlDelayMs,
    sitemaps
  };
}
