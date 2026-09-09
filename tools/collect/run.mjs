import fs from 'node:fs';
import path from 'node:path';
import { collectConfiguredSources } from '../fetch/http-json.mjs';
import {
  loadColumns,
  parseCsv,
  rowsToRecords,
  recordsToCsv,
  recordsToCsvRows,
  readDataRecords,
  readUtf8Strict,
  writeManifest
} from '../csv/csv.mjs';
import {
  normalizeSourceItem,
  hasExactExternalId,
  isCompositeDuplicateCandidate,
  mergeOnlyBlank,
  splitStructured
} from '../normalize/record.mjs';
import { loadDiscoveryState } from '../discovery/state.mjs';
import { readyDiscoveryRecords } from '../discovery/to-record.mjs';
import { generateSynopses, GEMINI_SYNOPSIS_DEFAULT_MODEL } from '../gemini/synopsis.mjs';
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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new Error(`真偽値が不正です: ${value}`);
}

function parseConfig() {
  const raw = process.env.ANIME_SOURCE_CONFIG_JSON;
  if (!raw) throw new Error('api-json入力には ANIME_SOURCE_CONFIG_JSON が必要です。');
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
  for (const fields of splitStructured(record.streaming_services)) {
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
  return rowsToRecords(parseCsv(readUtf8Strict(targetPath)), columns);
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

function restoreFile(filePath, originalBytes) {
  if (originalBytes === null) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  } else {
    fs.writeFileSync(filePath, originalBytes);
  }
}

function writeTargetPreservingExisting(targetPath, selected, columns, mode) {
  if (mode !== 'quarterly' || !fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, recordsToCsv(selected, columns), 'utf8');
    return;
  }

  const existingText = readUtf8Strict(targetPath);
  rowsToRecords(parseCsv(existingText), columns);
  const separator = existingText.endsWith('\n') || existingText.endsWith('\r') ? '' : '\r\n';
  fs.writeFileSync(targetPath, `${existingText}${separator}${recordsToCsvRows(selected, columns)}`, 'utf8');
}

async function loadInputRecords({ inputMode, root, columns, confirmedDate }) {
  if (inputMode === 'discovery') {
    const statePath = path.join(root, 'crawler', 'state.json');
    const state = loadDiscoveryState(statePath);
    const { records, skipped } = readyDiscoveryRecords(state, columns, confirmedDate);
    return {
      normalized: records,
      safeStoppedSources: 0,
      discoverySkipped: skipped.length,
      inputDetails: `crawler/state.json candidates=${state.candidates.length}`
    };
  }

  const config = parseConfig();
  validateSourceConfigShape(config, columns);
  const collectedGroups = await collectConfiguredSources(config);
  const normalized = [];
  let safeStoppedSources = 0;

  for (const { source, items, stoppedEarly, stopReason } of collectedGroups) {
    if (stoppedEarly) {
      safeStoppedSources += 1;
      console.warn(`${source.name}: 取得途中で安全停止しました。取得成功分のみ検証対象にします: ${stopReason}`);
    }
    for (const raw of items) {
      const record = normalizeSourceItem(raw, source, columns, confirmedDate);
      record.synopsis = '';
      normalized.push(record);
    }
  }

  return {
    normalized,
    safeStoppedSources,
    discoverySkipped: 0,
    inputDetails: `configured API sources=${collectedGroups.length}`
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'initial').toLowerCase();
  const inputMode = String(args.input || 'discovery').toLowerCase();
  const geminiEnabled = parseBoolean(args.gemini, false);
  if (!['initial', 'quarterly'].includes(mode)) throw new Error('--mode は initial または quarterly です。');
  if (!['discovery', 'api-json'].includes(inputMode)) throw new Error('--input は discovery または api-json です。');

  const root = process.cwd();
  const dataDir = path.join(root, 'data');
  const columns = loadColumns(root);

  if (fs.existsSync(dataDir)) {
    const existingValidation = validateDataDirectory(dataDir);
    if (existingValidation.failures.length) {
      throw new Error(`既存CSVに問題があるため収集を開始しません:\n${existingValidation.failures.map((value) => `- ${value}`).join('\n')}`);
    }
  }

  const confirmedDate = new Date().toISOString().slice(0, 10);
  const existing = readDataRecords(dataDir, columns);
  const input = await loadInputRecords({ inputMode, root, columns, confirmedDate });
  const normalized = input.normalized;

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
    console.log(JSON.stringify({
      input: inputMode,
      candidates: normalized.length,
      selected: 0,
      discoverySkipped: input.discoverySkipped,
      safeStoppedSources: input.safeStoppedSources,
      gemini: geminiEnabled ? 'enabled' : 'disabled',
      ...stats
    }));
    return;
  }

  let geminiStats = {
    model: process.env.ANIME_GEMINI_MODEL || GEMINI_SYNOPSIS_DEFAULT_MODEL,
    candidates: selected.length,
    calls: 0,
    generated: 0,
    existingSynopsis: 0,
    stoppedEarly: false,
    stopReason: ''
  };

  if (geminiEnabled) {
    const result = await generateSynopses(selected, {
      apiKey: process.env.ANIME_GEMINI_API_KEY,
      model: process.env.ANIME_GEMINI_MODEL || undefined,
      requestDelayMs: process.env.ANIME_GEMINI_REQUEST_DELAY_MS,
      timeoutMs: process.env.ANIME_GEMINI_TIMEOUT_MS,
      maxCalls: 450
    });
    selected = result.records;
    geminiStats = result.stats;
    if (geminiStats.stoppedEarly) {
      console.warn(`Gemini概要生成を安全停止しました。成功分のみCSV候補に残します: ${geminiStats.stopReason}`);
    }
    if (selected.length === 0) {
      console.warn('Gemini概要生成の成功作品が0件のため、既存CSVは変更しません。');
      return;
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const targetPath = path.join(dataDir, targetName);
  if (mode === 'initial' && fs.existsSync(targetPath)) throw new Error(`${targetName} は既に存在します。初期CSVへ追記しません。`);

  if (mode === 'quarterly') readTargetRecords(targetPath, columns);
  const originalTarget = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null;
  const manifestPath = path.join(dataDir, 'manifest.csv');
  const originalManifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;

  const nextId = nextInternalId(existing);
  for (const record of selected) record.id = nextId();

  try {
    writeTargetPreservingExisting(targetPath, selected, columns, mode);
    writeManifest(dataDir);

    const validation = validateDataDirectory(dataDir);
    if (validation.failures.length) {
      throw new Error(`生成CSV検証に失敗しました:\n${validation.failures.map((value) => `- ${value}`).join('\n')}`);
    }
  } catch (error) {
    restoreFile(targetPath, originalTarget);
    restoreFile(manifestPath, originalManifest);
    throw error;
  }

  console.log('Anime collection pipeline: PASS');
  console.log(`input: ${inputMode}`);
  console.log(`input details: ${input.inputDetails}`);
  console.log(`mode: ${mode}`);
  console.log(`target: data/${targetName}`);
  console.log(`candidate records: ${normalized.length}`);
  console.log(`new records: ${selected.length}`);
  console.log(`discovery candidates not ready: ${input.discoverySkipped}`);
  console.log(`safe-stopped API sources: ${input.safeStoppedSources}`);
  console.log(`existing exact duplicates skipped: ${stats.exactExisting}`);
  console.log(`uncertain duplicate candidates skipped: ${stats.candidateExisting + stats.candidateIncoming}`);
  console.log(`Gemini: ${geminiEnabled ? 'CONNECTED' : 'SKIPPED'}`);
  console.log(`Gemini model: ${geminiStats.model}`);
  console.log(`Gemini calls: ${geminiStats.calls}`);
  console.log(`Gemini generated: ${geminiStats.generated}`);
  console.log(`Gemini existing synopsis preserved: ${geminiStats.existingSynopsis}`);
  if (geminiStats.stoppedEarly) console.log(`Gemini safe-stop: ${geminiStats.stopReason}`);
}

main().catch((error) => {
  console.error(`Anime collection pipeline: FAIL\n${error.message}`);
  process.exit(1);
});
