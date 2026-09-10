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
  splitStructured
} from '../normalize/record.mjs';
import { loadDiscoveryState } from '../discovery/state.mjs';
import { readyDiscoveryRecords } from '../discovery/to-record.mjs';
import { generateSynopses, GEMINI_SYNOPSIS_DEFAULT_MODEL } from '../gemini/synopsis.mjs';
import { validateDataDirectory } from '../validate/data-validator.mjs';
import { deduplicateIncoming } from './deduplicate.mjs';
import { applySeriesMetadataToCollection } from './series-enrichment.mjs';
import {
  INITIAL_CSV_RECORD_LIMIT,
  loadInitialPending,
  saveInitialPending,
  takeInitialPackage
} from './initial-pending.mjs';

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

function boundedInteger(value, name, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} は ${min}〜${max} の整数が必要です。`);
  return parsed;
}

function setGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value)}\n`, 'utf8');
}

function emitGeminiCalls(value) {
  setGithubOutput('gemini_calls', Number(value) || 0);
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
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, originalBytes);
  }
}

function atomicWriteText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function prepareEnrichmentWrites(dataDir, enrichments, columns) {
  const byFile = new Map();
  for (const item of Array.isArray(enrichments) ? enrichments : []) {
    const fileName = String(item?.fileName || '');
    if (!/^(?:initial-\d{3}|\d{4}-Q[1-4])\.csv$/.test(fileName)) throw new Error(`既存データ更新先が不正です: ${fileName}`);
    const id = String(item?.record?.id || '');
    if (!/^A\d{8}$/.test(id)) throw new Error(`既存データ更新IDが不正です: ${id || '(empty)'}`);
    if (!byFile.has(fileName)) byFile.set(fileName, new Map());
    byFile.get(fileName).set(id, item.record);
  }

  const writes = [];
  for (const [fileName, updates] of byFile) {
    const filePath = path.join(dataDir, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`既存データ更新先が見つかりません: ${fileName}`);
    const records = readTargetRecords(filePath, columns);
    const matched = new Set();
    const merged = records.map((record) => {
      const update = updates.get(String(record.id || ''));
      if (!update) return record;
      matched.add(record.id);
      return { ...update, id: record.id };
    });
    for (const id of updates.keys()) {
      if (!matched.has(id)) throw new Error(`既存データ更新対象IDが見つかりません: ${fileName}/${id}`);
    }
    writes.push({ filePath, text: recordsToCsv(merged, columns) });
  }
  return writes;
}

function writeTargetPreservingExisting(targetPath, selected, columns, mode) {
  if (mode !== 'quarterly' || !fs.existsSync(targetPath)) {
    atomicWriteText(targetPath, recordsToCsv(selected, columns));
    return;
  }

  const existingText = readUtf8Strict(targetPath);
  rowsToRecords(parseCsv(existingText), columns);
  const separator = existingText.endsWith('\n') || existingText.endsWith('\r') ? '' : '\r\n';
  atomicWriteText(targetPath, `${existingText}${separator}${recordsToCsvRows(selected, columns)}`);
}

async function loadInputRecords({ inputMode, root, columns, confirmedDate }) {
  if (inputMode === 'discovery') {
    const statePath = path.join(root, 'crawler', 'state.json');
    const state = loadDiscoveryState(statePath);
    const { records, skipped } = readyDiscoveryRecords(state, columns, confirmedDate);
    return {
      normalized: records,
      discoveryCandidates: state.candidates,
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
    discoveryCandidates: [],
    safeStoppedSources,
    discoverySkipped: 0,
    inputDetails: `configured API sources=${collectedGroups.length}`
  };
}

function snapshotPaths(paths) {
  const snapshots = new Map();
  for (const filePath of paths) {
    if (!filePath || snapshots.has(filePath)) continue;
    snapshots.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath) : null);
  }
  return snapshots;
}

function restoreSnapshots(snapshots) {
  for (const [filePath, bytes] of snapshots) restoreFile(filePath, bytes);
}

async function main() {
  emitGeminiCalls(0);
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'initial').toLowerCase();
  const inputMode = String(args.input || 'discovery').toLowerCase();
  const geminiEnabled = parseBoolean(args.gemini, false);
  const geminiMaxCalls = boundedInteger(process.env.ANIME_GEMINI_MAX_CALLS, 'ANIME_GEMINI_MAX_CALLS', 1, 450, 450);
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

  const pendingPath = path.join(root, 'crawler', 'pending-initial.json');
  const pending = mode === 'initial' ? loadInitialPending(pendingPath, columns) : { records: [] };
  const { accepted: uniqueIncoming, workingExisting, stats } = deduplicateIncoming(
    mode === 'initial' ? [...pending.records, ...normalized] : normalized,
    existing,
    columns
  );
  const staged = uniqueIncoming;
  let selected = staged;
  let targetName;

  if (mode === 'initial') {
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

  let geminiStats = {
    model: process.env.ANIME_GEMINI_MODEL || GEMINI_SYNOPSIS_DEFAULT_MODEL,
    candidates: staged.length,
    calls: 0,
    generated: 0,
    existingSynopsis: 0,
    stoppedEarly: false,
    stopReason: ''
  };

  if (geminiEnabled) {
    const geminiPool = mode === 'initial' ? staged : selected;
    const geminiCandidates = geminiPool.filter((record) => !String(record.synopsis || '').trim()).slice(0, geminiMaxCalls);
    const result = await generateSynopses(geminiCandidates, {
      apiKey: process.env.ANIME_GEMINI_API_KEY,
      model: process.env.ANIME_GEMINI_MODEL || undefined,
      requestDelayMs: process.env.ANIME_GEMINI_REQUEST_DELAY_MS,
      timeoutMs: process.env.ANIME_GEMINI_TIMEOUT_MS,
      maxCalls: geminiMaxCalls
    });
    geminiStats = result.stats;
    result.records.forEach((record, index) => {
      geminiCandidates[index].synopsis = record.synopsis;
    });
    emitGeminiCalls(geminiStats.calls);
    if (geminiStats.stoppedEarly) {
      console.warn(`Gemini概要生成を安全停止しました。成功分のみCSV候補に残します: ${geminiStats.stopReason}`);
    }
    if (mode === 'quarterly') selected = selected.filter((record) => String(record.synopsis || '').trim());
  }

  if (mode === 'initial') {
    selected = takeInitialPackage(staged, { requireSynopsis: geminiEnabled }).selected;
  }

  if (selected.length > 0) {
    const nextId = nextInternalId(existing);
    for (const record of selected) record.id = nextId();
  }

  const seriesStage = applySeriesMetadataToCollection({
    originalExisting: existing,
    workingExisting,
    selected,
    targetName,
    candidates: input.discoveryCandidates,
    columns
  });
  const enrichments = seriesStage.existingUpdates;
  const enrichmentWrites = prepareEnrichmentWrites(dataDir, enrichments, columns);
  setGithubOutput('enriched_records', enrichments.length);

  if (selected.length === 0) {
    const snapshotTargets = [...enrichmentWrites.map((item) => item.filePath), ...(mode === 'initial' ? [pendingPath] : [])];
    const snapshots = snapshotPaths(snapshotTargets);
    try {
      for (const write of enrichmentWrites) atomicWriteText(write.filePath, write.text);
      if (mode === 'initial') saveInitialPending(pendingPath, staged, columns);
      if (fs.existsSync(dataDir)) {
        const validation = validateDataDirectory(dataDir);
        if (validation.failures.length) throw new Error(`既存CSV補完後の検証に失敗しました:\n${validation.failures.map((value) => `- ${value}`).join('\n')}`);
      }
    } catch (error) {
      restoreSnapshots(snapshots);
      throw error;
    }

    if (mode === 'initial') {
      console.log(`初期CSVは${INITIAL_CSV_RECORD_LIMIT}作品が揃うまで生成しません。途中状態を保存しました: ${staged.length}/${INITIAL_CSV_RECORD_LIMIT}`);
    } else {
      console.log('新規登録対象は0件です。既存CSVへの検証済み空欄補完のみ反映しました。');
    }
    setGithubOutput('csv_created', 'false');
    setGithubOutput('pending_records', mode === 'initial' ? staged.length : 0);
    console.log(JSON.stringify({
      input: inputMode,
      candidates: normalized.length,
      selected: 0,
      enrichedExisting: enrichments.length,
      seriesIdsAdded: seriesStage.seriesStats.seriesIdsAdded,
      seriesRelationsAdded: seriesStage.seriesStats.relationsAdded,
      unresolvedSeriesRelations: seriesStage.seriesStats.unresolvedRelations,
      pending: mode === 'initial' ? staged.length : 0,
      packageSize: mode === 'initial' ? INITIAL_CSV_RECORD_LIMIT : null,
      discoverySkipped: input.discoverySkipped,
      safeStoppedSources: input.safeStoppedSources,
      gemini: geminiEnabled ? 'enabled' : 'disabled',
      ...stats
    }));
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const targetPath = path.join(dataDir, targetName);
  if (mode === 'initial' && fs.existsSync(targetPath)) throw new Error(`${targetName} は既に存在します。初期CSVへ追記しません。`);

  if (mode === 'quarterly') readTargetRecords(targetPath, columns);
  const manifestPath = path.join(dataDir, 'manifest.csv');
  const remainingStaged = mode === 'initial'
    ? takeInitialPackage(staged, { requireSynopsis: geminiEnabled }).remaining
    : [];

  const snapshotTargets = [
    ...enrichmentWrites.map((item) => item.filePath),
    targetPath,
    manifestPath,
    ...(mode === 'initial' ? [pendingPath] : [])
  ];
  const snapshots = snapshotPaths(snapshotTargets);

  try {
    for (const write of enrichmentWrites) atomicWriteText(write.filePath, write.text);
    writeTargetPreservingExisting(targetPath, selected, columns, mode);
    writeManifest(dataDir);
    if (mode === 'initial') saveInitialPending(pendingPath, remainingStaged, columns);

    const validation = validateDataDirectory(dataDir);
    if (validation.failures.length) {
      throw new Error(`生成CSV検証に失敗しました:\n${validation.failures.map((value) => `- ${value}`).join('\n')}`);
    }
  } catch (error) {
    restoreSnapshots(snapshots);
    throw error;
  }

  setGithubOutput('csv_created', 'true');
  setGithubOutput('pending_records', remainingStaged.length);

  console.log('Anime collection pipeline: PASS');
  console.log(`input: ${inputMode}`);
  console.log(`input details: ${input.inputDetails}`);
  console.log(`mode: ${mode}`);
  console.log(`target: data/${targetName}`);
  console.log(`candidate records: ${normalized.length}`);
  console.log(`new records: ${selected.length}`);
  console.log(`registered records enriched: ${enrichments.length}`);
  console.log(`series IDs added: ${seriesStage.seriesStats.seriesIdsAdded}`);
  console.log(`series relations added: ${seriesStage.seriesStats.relationsAdded}`);
  console.log(`series relations awaiting registered target: ${seriesStage.seriesStats.unresolvedRelations}`);
  if (mode === 'initial') console.log(`pending initial records: ${remainingStaged.length}`);
  console.log(`discovery candidates not ready: ${input.discoverySkipped}`);
  console.log(`safe-stopped API sources: ${input.safeStoppedSources}`);
  console.log(`existing exact duplicates skipped: ${stats.exactExisting}`);
  console.log(`same discovery identities merged: ${stats.identityIncomingMerged}`);
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
