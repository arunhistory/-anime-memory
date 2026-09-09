export const escapeVariable = (value) => String(value ?? '')
  .replaceAll('\\', '\\\\')
  .replaceAll('|', '\\|')
  .replaceAll('::', '\\::');

const VARIABLE_OUTPUT_COLUMNS = new Set([
  'aliases', 'genres', 'tags', 'setting', 'themes', 'original_author', 'original_artist',
  'animation_studio', 'co_animation_studio', 'animation_cooperation', 'production_members', 'planning',
  'executive_producers', 'producers', 'animation_producers', 'line_producers', 'director', 'chief_director',
  'series_composition', 'character_original_design', 'character_design', 'music', 'sound_director', 'staff',
  'characters', 'opening_themes', 'ending_themes', 'insert_songs', 'music_production', 'broadcast_networks',
  'broadcast_slots', 'streaming_services', 'film_distributor', 'relations', 'episodes', 'episode_staff', 'awards',
  'official_other', 'external_ids'
]);

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

function scalarOutput(value, escapeScalar) {
  return escapeScalar && value ? escapeVariable(value) : value;
}

function mapOne(raw, rule, escapeScalar = false) {
  if (typeof rule === 'string') return scalarOutput(scalar(getPath(raw, rule)), escapeScalar);
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return '';
  if (Object.hasOwn(rule, 'literal')) return scalarOutput(scalar(rule.literal), escapeScalar);

  let value = getPath(raw, rule.path || '');
  if (rule.mapValues && value != null) {
    const key = String(value);
    value = Object.hasOwn(rule.mapValues, key) ? rule.mapValues[key] : (rule.unknownValue ?? '');
  }

  if (Array.isArray(value)) {
    const encoded = value.map((item) => {
      if (Array.isArray(rule.fields)) {
        return rule.fields.map((fieldPath) => escapeVariable(scalar(getPath(item, fieldPath)))).join('::');
      }
      const itemValue = rule.valuePath ? getPath(item, rule.valuePath) : item;
      return escapeVariable(applyTransform(scalar(itemValue), rule.transform));
    }).filter((item) => item !== '');
    return encoded.join('|');
  }

  return scalarOutput(applyTransform(scalar(value), rule.transform), escapeScalar);
}

export function normalizeSourceItem(raw, source, columns, confirmedDate) {
  if (!raw || typeof raw !== 'object') throw new Error('取得レコードがobjectではありません。');
  const record = Object.fromEntries(columns.map((column) => [column, '']));
  const mapping = source.mapping && typeof source.mapping === 'object' ? source.mapping : {};

  for (const [column, rule] of Object.entries(mapping)) {
    if (!columns.includes(column) || column === 'id') continue;
    record[column] = mapOne(raw, rule, VARIABLE_OUTPUT_COLUMNS.has(column));
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

export function splitEscapedRaw(value, delimiter = '|') {
  const text = String(value ?? '');
  if (!delimiter) throw new Error('delimiter must not be empty.');
  const result = [];
  let current = '';

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      current += text[i];
      if (i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
      }
      continue;
    }
    if (text.startsWith(delimiter, i)) {
      result.push(current);
      current = '';
      i += delimiter.length - 1;
      continue;
    }
    current += text[i];
  }
  result.push(current);
  return result;
}

export function unescapeVariable(value) {
  const text = String(value ?? '');
  let output = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\\') {
      output += text[i];
      continue;
    }
    if (i + 1 >= text.length) {
      output += '\\';
      continue;
    }
    if (text[i + 1] === '\\' || text[i + 1] === '|') {
      output += text[i + 1];
      i += 1;
      continue;
    }
    if (text.startsWith('::', i + 1)) {
      output += '::';
      i += 2;
      continue;
    }
    output += '\\';
  }
  return output;
}

export function splitEscaped(value, delimiter = '|') {
  return splitEscapedRaw(value, delimiter).map(unescapeVariable);
}

export function splitStructured(value) {
  return splitEscapedRaw(value, '|')
    .filter(Boolean)
    .map((entry) => splitEscapedRaw(entry, '::').map(unescapeVariable));
}

export function externalIdSet(record) {
  return new Set(splitEscapedRaw(record.external_ids, '|').map((value) => value.trim()).filter(Boolean));
}

export function titleSet(record) {
  const values = [record.title_ja, record.title_kana, record.title_romaji, record.title_en, ...splitEscaped(record.aliases)];
  return new Set(values.map(normalizeText).filter(Boolean));
}

export function releaseIdentitySet(record) {
  return new Set([record.release_start, record.theatrical_release_date].map((value) => String(value || '').trim()).filter(Boolean));
}

export function hasMatchingReleaseIdentity(left, right) {
  const a = releaseIdentitySet(left);
  const b = releaseIdentitySet(right);
  return [...a].some((value) => b.has(value));
}

export function isCompositeDuplicateCandidate(left, right) {
  const leftTitles = titleSet(left);
  const rightTitles = titleSet(right);
  if (![...leftTitles].some((title) => rightTitles.has(title))) return false;
  if (!left.media_type || !right.media_type || left.media_type !== right.media_type) return false;
  if (!hasMatchingReleaseIdentity(left, right)) return false;

  const corroborators = [
    [left.original_title, right.original_title],
    [left.original_author, right.original_author],
    [left.animation_studio, right.animation_studio]
  ];
  return corroborators.some(([a, b]) => a && b && normalizeText(a) === normalizeText(b));
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
