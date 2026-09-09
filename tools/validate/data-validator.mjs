import fs from 'node:fs';
import path from 'node:path';
import { loadColumns, parseCsv, rowsToRecords, listDataCsvFiles, readUtf8Strict } from '../csv/csv.mjs';
import { splitEscaped, splitStructured, externalIdSet, titleSet, normalizeText, releaseIdentitySet } from '../normalize/record.mjs';

export const MEDIA_TYPES = new Set(['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'SHORT', 'OTHER']);
const RELATION_TYPES = new Set(['PREQUEL', 'SEQUEL', 'SPINOFF', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'REMAKE', 'REBOOT', 'COMPILATION', 'ALTERNATIVE', 'OTHER']);
const STREAMING_MODES = new Set(['通常', '独占', '見放題独占', '配信独占', '最速', '先行', '地上波先行', 'Web最速', '同時配信', '期間限定', 'レンタル', '購入', '無料', 'その他']);
const URL_FIELDS = ['image_url', 'official_url', 'official_x', 'official_youtube', 'official_other'];
const DATE_FIELDS = ['release_start', 'release_end', 'theatrical_release_date', 'updated_at'];
const NUMBER_FIELDS = ['episode_count', 'runtime_min', 'season_number'];
const VARIABLE_FIELDS = new Set([
  'aliases', 'genres', 'tags', 'setting', 'themes', 'original_author', 'original_artist',
  'animation_studio', 'co_animation_studio', 'animation_cooperation', 'production_members', 'planning',
  'executive_producers', 'producers', 'animation_producers', 'line_producers', 'director', 'chief_director',
  'series_composition', 'character_original_design', 'character_design', 'music', 'sound_director', 'staff',
  'characters', 'opening_themes', 'ending_themes', 'insert_songs', 'music_production', 'broadcast_networks',
  'broadcast_slots', 'streaming_services', 'film_distributor', 'relations', 'episodes', 'episode_staff', 'awards',
  'official_other', 'external_ids'
]);

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
  if (value.length >= 7) {
    const month = Number(value.slice(5, 7));
    if (month < 1 || month > 12) return false;
  }
  if (value.length === 10) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  }
  return true;
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function quarterOfDate(value) {
  if (!/^\d{4}-\d{2}/.test(value || '')) return null;
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return Math.floor((month - 1) / 3) + 1;
}

function recordQuarterDates(record) {
  const dates = [record.release_start, record.theatrical_release_date].filter(Boolean);
  for (const parts of splitStructured(record.streaming_services)) {
    if (parts[3]) dates.push(parts[3]);
  }
  return dates;
}

function checkQuarterFile(record, fileName) {
  const match = fileName.match(/^(\d{4})-Q([1-4])\.csv$/);
  if (!match) return true;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  return recordQuarterDates(record).some((date) => Number(date.slice(0, 4)) === year && quarterOfDate(date) === quarter);
}

function validateVariableEscapes(value) {
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\\') continue;
    if (i + 1 >= text.length) return false;
    if (text[i + 1] === '\\' || text[i + 1] === '|') {
      i += 1;
      continue;
    }
    if (text.startsWith('::', i + 1)) {
      i += 2;
      continue;
    }
    return false;
  }
  return true;
}

function validateStructuredField(record, field, expectedParts, label, failures, itemValidator = null) {
  if (!record[field]) return;
  for (const parts of splitStructured(record[field])) {
    if (parts.length !== expectedParts) {
      failures.push(`${label}: ${field} の内部フィールド数が不正 (${parts.length}/${expectedParts})`);
      continue;
    }
    if (itemValidator) itemValidator(parts);
  }
}

function corroboratesDuplicate(left, right) {
  return [
    [left.original_title, right.original_title],
    [left.original_author, right.original_author],
    [left.animation_studio, right.animation_studio]
  ].some(([a, b]) => a && b && normalizeText(a) === normalizeText(b));
}

function validateDuplicates(entries, failures) {
  const externalSeen = new Map();
  const exactPairs = new Set();
  const titleBuckets = new Map();
  const candidatePairs = new Set();

  entries.forEach(({ record }, index) => {
    for (const externalId of externalIdSet(record)) {
      if (externalSeen.has(externalId)) {
        const previous = externalSeen.get(externalId);
        const pair = previous < index ? `${previous}:${index}` : `${index}:${previous}`;
        if (!exactPairs.has(pair)) {
          exactPairs.add(pair);
          failures.push(`外部ID完全一致の重複: ${entries[previous].record.id} / ${record.id}`);
        }
      } else {
        externalSeen.set(externalId, index);
      }
    }

    if (!record.media_type) return;
    const releases = [...releaseIdentitySet(record)];
    if (!releases.length) return;

    for (const title of titleSet(record)) {
      for (const releaseIdentity of releases) {
        const bucketKey = `${title}\u001f${record.media_type}\u001f${releaseIdentity}`;
        const previousIndices = titleBuckets.get(bucketKey) || [];
        for (const previous of previousIndices) {
          const pair = previous < index ? `${previous}:${index}` : `${index}:${previous}`;
          if (candidatePairs.has(pair) || exactPairs.has(pair)) continue;
          candidatePairs.add(pair);
          if (corroboratesDuplicate(entries[previous].record, record)) {
            failures.push(`作品重複候補: ${entries[previous].record.id} / ${record.id}`);
          }
        }
        previousIndices.push(index);
        titleBuckets.set(bucketKey, previousIndices);
      }
    }
  });
}

export function validateRecords(entries, columns) {
  const failures = [];
  const ids = new Map();
  const allRecords = entries.map((entry) => entry.record);
  const allIds = new Set(allRecords.map((record) => record.id).filter(Boolean));

  entries.forEach(({ fileName, record }, index) => {
    const label = `${fileName} record ${index + 1} (${record.id || 'no-id'})`;
    if (!/^A\d{8}$/.test(record.id || '')) failures.push(`${label}: 内部ID形式が不正`);
    if (ids.has(record.id)) failures.push(`${label}: 内部ID重複 (${ids.get(record.id)})`);
    else if (record.id) ids.set(record.id, label);
    if (!record.title_ja) failures.push(`${label}: title_ja 必須値欠落`);
    if (!MEDIA_TYPES.has(record.media_type)) failures.push(`${label}: media_type 定義値外 (${record.media_type})`);

    for (const field of DATE_FIELDS) {
      if (!validDate(record[field])) failures.push(`${label}: ${field} 日付形式不正 (${record[field]})`);
    }
    for (const field of NUMBER_FIELDS) {
      if (record[field] && (!Number.isFinite(Number(record[field])) || Number(record[field]) < 0)) {
        failures.push(`${label}: ${field} 数値形式不正 (${record[field]})`);
      }
    }
    for (const field of URL_FIELDS) {
      for (const value of splitEscaped(record[field]).filter(Boolean)) {
        if (!validHttpUrl(value)) failures.push(`${label}: ${field} URL不正 (${value})`);
      }
    }
    for (const field of VARIABLE_FIELDS) {
      if (!validateVariableEscapes(record[field])) failures.push(`${label}: ${field} の区切りescapeが不正`);
    }

    validateStructuredField(record, 'staff', 2, label, failures);
    validateStructuredField(record, 'characters', 3, label, failures);
    validateStructuredField(record, 'opening_themes', 6, label, failures);
    validateStructuredField(record, 'ending_themes', 6, label, failures);
    validateStructuredField(record, 'insert_songs', 6, label, failures);
    validateStructuredField(record, 'broadcast_slots', 2, label, failures);
    validateStructuredField(record, 'streaming_services', 5, label, failures, (parts) => {
      const [service, mode, , start, end] = parts;
      if (!service) failures.push(`${label}: streaming_services のサービス名が空です`);
      if (!STREAMING_MODES.has(mode)) failures.push(`${label}: streaming_services の配信形態が定義値外 (${mode})`);
      if (!validDate(start)) failures.push(`${label}: streaming_services 開始日不正 (${start})`);
      if (!validDate(end)) failures.push(`${label}: streaming_services 終了日不正 (${end})`);
    });
    validateStructuredField(record, 'episodes', 3, label, failures, (parts) => {
      if (!validDate(parts[2])) failures.push(`${label}: episodes 放送日不正 (${parts[2]})`);
    });
    validateStructuredField(record, 'episode_staff', 3, label, failures);
    validateStructuredField(record, 'awards', 3, label, failures);
    validateStructuredField(record, 'external_ids', 2, label, failures, (parts) => {
      if (!parts[0] || !parts[1]) failures.push(`${label}: external_ids は source::id が必須です`);
    });
    validateStructuredField(record, 'relations', 2, label, failures, (parts) => {
      const [type, targetId] = parts;
      if (!RELATION_TYPES.has(type)) failures.push(`${label}: relations 種別不正 (${type})`);
      if (!/^A\d{8}$/.test(targetId || '')) failures.push(`${label}: relations target ID形式不正 (${targetId || ''})`);
      else if (!allIds.has(targetId)) failures.push(`${label}: relations targetが存在しない (${targetId})`);
    });

    if (!checkQuarterFile(record, fileName)) failures.push(`${label}: 四半期ファイルの期間に開始情報がありません`);
  });

  validateDuplicates(entries, failures);
  return failures;
}

export function validateDataDirectory(dataDir = path.join(process.cwd(), 'data')) {
  const root = process.cwd();
  const columns = loadColumns(root);
  if (!fs.existsSync(dataDir)) return { failures: [], files: [], records: 0 };
  const files = listDataCsvFiles(dataDir);
  const entries = [];
  const failures = [];

  for (const fileName of files) {
    try {
      const rows = parseCsv(readUtf8Strict(path.join(dataDir, fileName)));
      const records = rowsToRecords(rows, columns);
      if (/^initial-\d{3}\.csv$/.test(fileName) && records.length > 450) {
        failures.push(`${fileName}: 初期導入上限450作品を超過 (${records.length})`);
      }
      records.forEach((record) => entries.push({ fileName, record }));
    } catch (error) {
      failures.push(`${fileName}: ${error.message}`);
    }
  }

  const manifestPath = path.join(dataDir, 'manifest.csv');
  if (files.length) {
    if (!fs.existsSync(manifestPath)) failures.push('manifest.csv がありません。');
    else {
      try {
        const manifestRows = parseCsv(readUtf8Strict(manifestPath));
        if (manifestRows[0]?.length !== 1 || manifestRows[0][0] !== 'file_name') failures.push('manifest.csv のヘッダーが不正です。');
        const listed = manifestRows.slice(1).map((row) => row[0]).filter(Boolean);
        if (JSON.stringify(listed) !== JSON.stringify(files)) failures.push('manifest.csv が実在CSV一覧と一致しません。');
        if (manifestRows.some((row) => row.length !== 1)) failures.push('manifest.csv にファイル名以外の情報があります。');
      } catch (error) {
        failures.push(`manifest.csv: ${error.message}`);
      }
    }
  }

  failures.push(...validateRecords(entries, columns));
  return { failures, files, records: entries.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), 'data');
  const result = validateDataDirectory(target);
  if (result.failures.length) {
    console.error('Data validation: FAIL');
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Data validation: PASS');
  console.log(`CSV files: ${result.files.length}`);
  console.log(`records: ${result.records}`);
}
