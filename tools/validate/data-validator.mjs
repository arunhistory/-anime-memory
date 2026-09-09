import fs from 'node:fs';
import path from 'node:path';
import { loadColumns, parseCsv, rowsToRecords, listDataCsvFiles } from '../csv/csv.mjs';
import { splitEscaped, hasExactExternalId, isCompositeDuplicateCandidate } from '../normalize/record.mjs';

export const MEDIA_TYPES = new Set(['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'SHORT', 'OTHER']);
const RELATION_TYPES = new Set(['PREQUEL', 'SEQUEL', 'SPINOFF', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'REMAKE', 'REBOOT', 'COMPILATION', 'ALTERNATIVE', 'OTHER']);
const URL_FIELDS = ['image_url', 'official_url', 'official_x', 'official_youtube', 'official_other'];
const DATE_FIELDS = ['release_start', 'release_end', 'theatrical_release_date', 'updated_at'];
const NUMBER_FIELDS = ['episode_count', 'runtime_min', 'season_number'];

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

function structuredParts(value) {
  return splitEscaped(value).filter(Boolean).map((entry) => entry.split('::'));
}

function quarterOfDate(value) {
  if (!/^\d{4}-\d{2}/.test(value || '')) return null;
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return Math.floor((month - 1) / 3) + 1;
}

function recordQuarterDates(record) {
  const dates = [record.release_start, record.theatrical_release_date].filter(Boolean);
  for (const parts of structuredParts(record.streaming_services)) {
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
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (text[i] === '\\') escaped = true;
  }
  return !escaped;
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
    for (const column of columns) {
      if (!validateVariableEscapes(record[column])) failures.push(`${label}: ${column} のバックスラッシュescapeが途中で終了`);
    }

    for (const relation of structuredParts(record.relations)) {
      const [type, targetId] = relation;
      if (!RELATION_TYPES.has(type)) failures.push(`${label}: relations 種別不正 (${type})`);
      if (!/^A\d{8}$/.test(targetId || '')) failures.push(`${label}: relations target ID形式不正 (${targetId || ''})`);
      else if (!allIds.has(targetId)) failures.push(`${label}: relations targetが存在しない (${targetId})`);
    }

    if (!checkQuarterFile(record, fileName)) failures.push(`${label}: 四半期ファイルの期間に開始情報がありません`);
  });

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (hasExactExternalId(a.record, b.record)) {
        failures.push(`外部ID完全一致の重複: ${a.record.id} / ${b.record.id}`);
      } else if (isCompositeDuplicateCandidate(a.record, b.record)) {
        failures.push(`作品重複候補: ${a.record.id} / ${b.record.id}`);
      }
    }
  }

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
      const rows = parseCsv(fs.readFileSync(path.join(dataDir, fileName), 'utf8'));
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
        const manifestRows = parseCsv(fs.readFileSync(manifestPath, 'utf8'));
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
