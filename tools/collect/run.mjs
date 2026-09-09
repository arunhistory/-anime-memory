import fs from 'node:fs';
import path from 'node:path';
import { collectConfiguredSources } from '../fetch/http-json.mjs';
import { loadColumns, parseCsv, rowsToRecords, recordsToCsv, readDataRecords, writeManifest } from '../csv/csv.mjs';
import { normalizeSourceItem, hasExactExternalId, isCompositeDuplicateCandidate, mergeOnlyBlank, splitEscaped } from '../normalize/record.mjs';
import { validateDataDirectory } from '../validate/data-validator.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function parseConfig() {
  const raw = process.env.ANIME_SOURCE_CONFIG_JSON;
  if (!raw) throw new Error('ANIME_SOURCE_CONFIG_JSON が未設定です。情報源は勝手に決定しません。');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('ANIME_SOURCE_CONFIG_JSON が正しいJSONではありません。');
  }
}

function nextInternalId(existing) {
  let max = 0;
  for (const { record } of existing) {
    const match = String(record.id || '').match(/^A(\d{8})$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let current = max;
  return () => {
    current += 1;
    if (current > 99999999) throw new Error('内部IDの8桁上限に到達しました。');
    return `A${String(current).padStart(8, '0')}`;
  };
}

function nextInitialFile(dataDir) {
  if (!fs.existsSync(dataDir)) return 'initial-001.csv';
  let max = 0;
  for (const name of fs.readdirSync(dataDir)) {
    const match = name.match(/^initial-(\d{3})\.csv$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  if (max >= 999) throw new Error('initial-NNN.csv の連番上限に到達しました。');
  return `initial-${String(max + 1).padStart(3, '0')}.csv`;
}

function quarterForMonth(month) {
  if (month < 1 || month > 12) return null;
  return Math.floor((month - 1) / 3) + 1;
}

function candidateStartDates(record) {
  const dates = [record.release_start, record.theatrical_release_date].filter(Boolean);
  for (const entry of splitEscaped(record.streaming_services).filter(Boolean)) {
    const fields = entry.split('::');
    if (fields[3]) dates.push(fields[3]);
  }
  return dates;
}

function belongsToQuarter(record, year, quarter) {
  return candidateStartDates(record).some((date) => {
    const match = String(date).match(/^(\d{4})-(\d{2})/);
    return match && Number(match[1]) === year && quarterForMonth(Number(match[2])) === quarter;
  });
}

function readTargetRecords(targetPath, columns) {
  if (!fs.existsSync(targetPath)) return [];
  return rowsToRecords(parseCsv(fs.readFileSync(targetPath, 'utf8')), columns);
}

function deduplicateIncoming(incoming, existing, columns) {
  const accepted = [];
  const stats = { exactExisting: 0, candidateExisting: 0, exactIncomingMerged: 0, candidateIncoming: 0 };

  for (const item of incoming) {
    const exactExisting = existing.find(({ record }) => hasExactExternalId(record, item));
    if (exactExisting) {
      stats.exactExisting += 1;
      continue;
    }
    const candidateExisting = existing.find(({ record }) => isCompositeDuplicateCandidate(record, item));
    if (candidateExisting) {
      stats.candidateExisting += 1;
      console.warn(`重複候補のため自動登録しません: source title=${item.title_ja || '(empty)'} / existing=${candidateExisting.record.id}`);
      continue;
    }

    const exactIncomingIndex = accepted.findIndex((record) => hasExactExternalId(record, item));
    if (exactIncomingIndex >= 0) {
      accepted[exactIncomingIndex] = mergeOnlyBlank(accepted[exactIncomingIndex], item, columns);
      stats.exactIncomingMerged += 1;
      continue;
    }
    const candidateIncoming = accepted.find((record) => isCompositeDuplicateCandidate(record, item));
    if (candidateIncoming) {
      stats.candidateIncoming += 1;
      console.warn(`取得内の重複候補を自動統合しません: ${item.title_ja || '(empty)'}`);
      continue;
    }
    accepted.push(item);
  }
  return { accepted, stats };
}

function validateSourceConfigShape(config, columns) {
  for (const source of config.sources || []) {
    if (source.mapping && typeof source.mapping === 'object') {
      for (const column of Object.keys(source.mapping)) {
        if (!columns.includes(column)) throw new Error(`${source.name}: 共通CSVに存在しないmapping列です: ${column}`);
        if (column === 'id') throw new Error(`${source.name}: 内部IDは外部情報源から設定できません。`);
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'initial').toLowerCase();
  if (!['initial', 'quarterly'].includes(mode)) throw new Error('--mode は initial または quarterly です。');

  const root = process.cwd();
  const dataDir = path.join(root, 'data');
  const columns = loadColumns(root);
  const config = parseConfig();
  validateSourceConfigShape(config, columns);

  const confirmedDate = new Date().toISOString().slice(0, 10);
  const existing = readDataRecords(dataDir, columns);
  const collectedGroups = await collectConfiguredSources(config);
  const normalized = [];

  for (const { source, items } of collectedGroups) {
    for (const raw of items) {
      const record = normalizeSourceItem(raw, source, columns, confirmedDate);
      // Gemini未接続段階では、外部の概要文をサイト独自概要として保存しない。
      record.synopsis = '';
      normalized.push(record);
    }
  }

  const { accepted: uniqueIncoming, stats } = deduplicateIncoming(normalized, existing, columns);
  let selected = uniqueIncoming;
  let targetName;

  if (mode === 'initial') {
    selected = selected.slice(0, 450);
    targetName = nextInitialFile(dataDir);
  } else {
    const year = Number(args.year);
    const quarterText = String(args.quarter || '').toUpperCase();
    const quarterMatch = quarterText.match(/^Q([1-4])$/);
    if (!Number.isInteger(year) || year < 1900 || year > 9999 || !quarterMatch) {
      throw new Error('quarterly は --year YYYY --quarter Q1..Q4 が必須です。');
    }
    const quarter = Number(quarterMatch[1]);
    selected = selected.filter((record) => belongsToQuarter(record, year, quarter));
    targetName = `${year}-Q${quarter}.csv`;
  }

  if (selected.length === 0) {
    console.log('新規登録対象は0件です。既存CSVは変更しません。');
    console.log(JSON.stringify({ fetched: normalized.length, selected: 0, ...stats }));
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const targetPath = path.join(dataDir, targetName);
  if (mode === 'initial' && fs.existsSync(targetPath)) throw new Error(`${targetName} は既に存在します。初期CSVへ追記しません。`);

  const nextId = nextInternalId(existing);
  for (const record of selected) record.id = nextId();

  const existingTarget = mode === 'quarterly' ? readTargetRecords(targetPath, columns) : [];
  const output = [...existingTarget, ...selected];
  fs.writeFileSync(targetPath, recordsToCsv(output, columns), 'utf8');
  writeManifest(dataDir);

  const validation = validateDataDirectory(dataDir);
  if (validation.failures.length) {
    try { fs.rmSync(targetPath); } catch {}
    if (existingTarget.length) fs.writeFileSync(targetPath, recordsToCsv(existingTarget, columns), 'utf8');
    if (fs.existsSync(dataDir)) writeManifest(dataDir);
    throw new Error(`生成CSV検証に失敗しました:\n${validation.failures.map((value) => `- ${value}`).join('\n')}`);
  }

  console.log('Anime collection pipeline: PASS');
  console.log(`mode: ${mode}`);
  console.log(`target: data/${targetName}`);
  console.log(`fetched records: ${normalized.length}`);
  console.log(`new records: ${selected.length}`);
  console.log(`existing exact duplicates skipped: ${stats.exactExisting}`);
  console.log(`uncertain duplicate candidates skipped: ${stats.candidateExisting + stats.candidateIncoming}`);
  console.log('Gemini: DISCONNECTED');
}

main().catch((error) => {
  console.error(`Anime collection pipeline: FAIL\n${error.message}`);
  process.exit(1);
});
