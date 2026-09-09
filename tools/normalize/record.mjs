const escapeVariable = (value) => String(value ?? '')
  .replaceAll('\\', '\\\\')
  .replaceAll('|', '\\|')
  .replaceAll('::', '\\::');

export function getPath(input, pathExpression) {
  if (!pathExpression) return input;
  const parts = String(pathExpression).split('.').filter(Boolean);
  let current = input;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else current = current[part];
  }
  return current;
}

function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function applyTransform(value, transform) {
  if (!transform) return value;
  if (transform === 'upper') return value.toUpperCase();
  if (transform === 'lower') return value.toLowerCase();
  if (transform === 'trim') return value.trim();
  throw new Error(`未対応の正規化transformです: ${transform}`);
}

function mapOne(raw, rule) {
  if (typeof rule === 'string') return scalar(getPath(raw, rule));
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return '';
  if (Object.hasOwn(rule, 'literal')) return scalar(rule.literal);

  let value = getPath(raw, rule.path || '');
  if (rule.mapValues && value != null) {
    const key = String(value);
    value = Object.hasOwn(rule.mapValues, key) ? rule.mapValues[key] : (rule.unknownValue ?? '');
  }

  if (Array.isArray(value)) {
    const itemSeparator = rule.separator ?? '|';
    const encoded = value.map((item) => {
      if (Array.isArray(rule.fields)) {
        return rule.fields.map((fieldPath) => escapeVariable(scalar(getPath(item, fieldPath)))).join('::');
      }
      const itemValue = rule.valuePath ? getPath(item, rule.valuePath) : item;
      return escapeVariable(applyTransform(scalar(itemValue), rule.transform));
    }).filter((item) => item !== '');
    return encoded.join(itemSeparator);
  }

  return applyTransform(scalar(value), rule.transform);
}

export function normalizeSourceItem(raw, source, columns, confirmedDate) {
  if (!raw || typeof raw !== 'object') throw new Error('取得レコードがobjectではありません。');
  const record = Object.fromEntries(columns.map((column) => [column, '']));
  const mapping = source.mapping && typeof source.mapping === 'object' ? source.mapping : {};

  for (const [column, rule] of Object.entries(mapping)) {
    if (!columns.includes(column) || column === 'id') continue;
    record[column] = mapOne(raw, rule);
  }

  if (source.externalIdPath && source.externalIdNamespace) {
    const externalId = scalar(getPath(raw, source.externalIdPath));
    if (externalId) {
      const encoded = `${escapeVariable(source.externalIdNamespace)}::${escapeVariable(externalId)}`;
      record.external_ids = record.external_ids ? `${record.external_ids}|${encoded}` : encoded;
    }
  }

  if (!record.updated_at) record.updated_at = confirmedDate;
  record.id = '';
  return record;
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[‐‑‒–—―・･·.。,:：;；'"“”‘’()（）［\]【】{}「」『』]/g, '');
}

export function splitEscaped(value, delimiter = '|') {
  const text = String(value ?? '');
  const result = [];
  let current = '';
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (escaped) {
      current += c;
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === delimiter) {
      result.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  if (escaped) current += '\\';
  result.push(current);
  return result;
}

export function externalIdSet(record) {
  return new Set(splitEscaped(record.external_ids).map((value) => value.trim()).filter(Boolean));
}

export function titleSet(record) {
  const values = [record.title_ja, record.title_kana, record.title_romaji, record.title_en, ...splitEscaped(record.aliases)];
  return new Set(values.map(normalizeText).filter(Boolean));
}

export function isCompositeDuplicateCandidate(left, right) {
  const leftTitles = titleSet(left);
  const rightTitles = titleSet(right);
  if (![...leftTitles].some((title) => rightTitles.has(title))) return false;
  if (!left.media_type || !right.media_type || left.media_type !== right.media_type) return false;
  if (!left.release_start || !right.release_start || left.release_start !== right.release_start) return false;

  const corroborators = [
    ['original_title', left.original_title, right.original_title],
    ['original_author', left.original_author, right.original_author],
    ['animation_studio', left.animation_studio, right.animation_studio]
  ];
  return corroborators.some(([, a, b]) => a && b && normalizeText(a) === normalizeText(b));
}

export function hasExactExternalId(left, right) {
  const a = externalIdSet(left);
  const b = externalIdSet(right);
  return [...a].some((id) => b.has(id));
}

export function mergeOnlyBlank(target, incoming, columns) {
  const merged = { ...target };
  for (const column of columns) {
    if (column === 'id') continue;
    if (!merged[column] && incoming[column]) merged[column] = incoming[column];
  }
  return merged;
}
