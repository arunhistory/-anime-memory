import fs from 'node:fs';
import path from 'node:path';
import {
  loadColumns,
  parseCsv,
  readUtf8Strict,
  recordsToCsv,
  rowsToRecords
} from '../csv/csv.mjs';
import { validateDataDirectory } from '../validate/data-validator.mjs';

const OPERATIONS = new Set(['replace', 'clear']);
const PROTECTED_FIELDS = new Set(['id', 'updated_at']);

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

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function findRecord(dataDir, columns, internalId) {
  if (!fs.existsSync(dataDir)) throw new Error('data/ がありません。修正対象の作品CSVが存在しません。');
  const matches = [];
  for (const name of fs.readdirSync(dataDir).filter((value) => /^(?:initial-\d{3}|\d{4}-Q[1-4])\.csv$/.test(value)).sort()) {
    const filePath = path.join(dataDir, name);
    const records = rowsToRecords(parseCsv(readUtf8Strict(filePath)), columns);
    records.forEach((record, index) => {
      if (record.id === internalId) matches.push({ name, filePath, records, index, record });
    });
  }
  if (matches.length === 0) throw new Error(`対象内部IDが見つかりません: ${internalId}`);
  if (matches.length !== 1) throw new Error(`対象内部IDが複数CSVに存在します: ${internalId}`);
  return matches[0];
}

export function applyManualCorrection({
  root = process.cwd(),
  internalId,
  field,
  operation = 'replace',
  value = '',
  updatedAt = todayUtc()
}) {
  const id = String(internalId || '').trim();
  const targetField = String(field || '').trim();
  const op = String(operation || '').trim().toLowerCase();

  if (!/^A\d{8}$/.test(id)) throw new Error(`内部ID形式が不正です: ${id || '(empty)'}`);
  if (!OPERATIONS.has(op)) throw new Error(`operation は replace または clear です: ${op}`);

  const columns = loadColumns(root);
  if (!columns.includes(targetField)) throw new Error(`共通70列に存在しないfieldです: ${targetField || '(empty)'}`);
  if (PROTECTED_FIELDS.has(targetField)) throw new Error(`${targetField} は手動修正できません。idは固定、updated_atは自動更新です。`);

  const dataDir = path.join(root, 'data');
  const target = findRecord(dataDir, columns, id);
  const beforeBytes = fs.readFileSync(target.filePath);
  const nextValue = op === 'clear' ? '' : String(value ?? '');
  const beforeValue = target.record[targetField] ?? '';

  if (beforeValue === nextValue) {
    return {
      changed: false,
      id,
      field: targetField,
      fileName: target.name,
      operation: op,
      beforeValue,
      afterValue: nextValue
    };
  }

  target.records[target.index] = {
    ...target.record,
    [targetField]: nextValue,
    updated_at: updatedAt
  };

  try {
    fs.writeFileSync(target.filePath, recordsToCsv(target.records, columns), 'utf8');
    const validation = validateDataDirectory(dataDir);
    if (validation.failures.length) {
      throw new Error(`手動修正後の全CSV検証に失敗しました:\n${validation.failures.map((item) => `- ${item}`).join('\n')}`);
    }
  } catch (error) {
    fs.writeFileSync(target.filePath, beforeBytes);
    throw error;
  }

  return {
    changed: true,
    id,
    field: targetField,
    fileName: target.name,
    operation: op,
    beforeValue,
    afterValue: nextValue
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = applyManualCorrection({
    internalId: args.id,
    field: args.field,
    operation: args.operation || 'replace',
    value: args.value ?? ''
  });

  if (!result.changed) {
    console.log('Manual anime correction: NO CHANGE');
    console.log(`id: ${result.id}`);
    console.log(`field: ${result.field}`);
    console.log(`file: data/${result.fileName}`);
    return;
  }

  console.log('Manual anime correction: PASS');
  console.log(`id: ${result.id}`);
  console.log(`field: ${result.field}`);
  console.log(`operation: ${result.operation}`);
  console.log(`file: data/${result.fileName}`);
  console.log('updated_at: refreshed automatically');
  console.log('all CSV validation: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Manual anime correction: FAIL\n${error.message}`);
    process.exit(1);
  });
}
