import fs from 'node:fs';
import path from 'node:path';

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });

export function readUtf8Strict(filePath) {
  const bytes = fs.readFileSync(filePath);
  try {
    return utf8Fatal.decode(bytes);
  } catch {
    throw new Error(`UTF-8として不正なバイト列です: ${filePath}`);
  }
}

export function loadColumns(root = process.cwd()) {
  const schemaPath = path.join(root, 'wasm-src/shared/schema.hpp');
  const source = readUtf8Strict(schemaPath);
  const block = source.match(/kColumns\s*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error('共通CSVスキーマを schema.hpp から読み取れません。');
  const columns = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (columns.length !== 70) throw new Error(`共通CSVスキーマ列数が70ではありません: ${columns.length}`);
  return columns;
}

export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be a string.');
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;

  const finishField = () => {
    row.push(field);
    field = '';
    quoteClosed = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (quoteClosed) {
      if (c === ',') {
        finishField();
        continue;
      }
      if (c === '\n') {
        finishRow();
        continue;
      }
      if (c === '\r') {
        if (source[i + 1] === '\n') i += 1;
        finishRow();
        continue;
      }
      throw new Error('CSVの閉じ引用符の後に不正な文字があります。');
    }

    if (c === '"') {
      if (field.length) throw new Error('CSVの非引用フィールド内に引用符があります。');
      quoted = true;
      continue;
    }
    if (c === ',') {
      finishField();
      continue;
    }
    if (c === '\n') {
      finishRow();
      continue;
    }
    if (c === '\r') {
      if (source[i + 1] === '\n') i += 1;
      finishRow();
      continue;
    }
    field += c;
  }

  if (quoted) throw new Error('CSVが引用フィールドの途中で終了しています。');
  if (field.length || row.length || quoteClosed) finishRow();
  if (!rows.length) throw new Error('CSVが空です。');
  return rows;
}

export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeRows(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}

export function rowsToRecords(rows, expectedColumns) {
  if (!rows.length) throw new Error('CSV header is missing.');
  const header = rows[0];
  if (header.length !== expectedColumns.length || header.some((name, index) => name !== expectedColumns[index])) {
    throw new Error('CSVヘッダーまたは列順が共通スキーマと一致しません。');
  }
  return rows.slice(1).filter((row) => !(row.length === 1 && row[0] === '')).map((row, rowIndex) => {
    if (row.length !== expectedColumns.length) {
      throw new Error(`CSV ${rowIndex + 2}行目の列数が不正です: ${row.length}`);
    }
    return Object.fromEntries(expectedColumns.map((column, index) => [column, row[index] ?? '']));
  });
}

export function recordsToCsv(records, columns) {
  const rows = [columns, ...records.map((record) => columns.map((column) => record[column] ?? ''))];
  return serializeRows(rows);
}

export function recordsToCsvRows(records, columns) {
  return serializeRows(records.map((record) => columns.map((column) => record[column] ?? '')));
}

export function listDataCsvFiles(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .filter((name) => /^(?:initial-\d{3}|\d{4}-Q[1-4])\.csv$/.test(name))
    .sort();
}

export function readDataRecords(dataDir, columns) {
  const result = [];
  for (const fileName of listDataCsvFiles(dataDir)) {
    const filePath = path.join(dataDir, fileName);
    const records = rowsToRecords(parseCsv(readUtf8Strict(filePath)), columns);
    for (const record of records) result.push({ fileName, record });
  }
  return result;
}

export function writeManifest(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const files = listDataCsvFiles(dataDir);
  fs.writeFileSync(path.join(dataDir, 'manifest.csv'), serializeRows([['file_name'], ...files.map((name) => [name])]), 'utf8');
  return files;
}
