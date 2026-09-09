import { execFileSync } from 'node:child_process';
import { parseCsv, rowsToRecords } from '../csv/csv.mjs';

export const INITIAL_IMPORT_ROLLING_LIMIT = 450;
const INITIAL_PATH = /^data\/initial-\d{3}\.csv$/;

function defaultGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024
  });
}

export function parseRecentInitialAdds(logText) {
  const entries = [];
  let commit = '';
  const seen = new Set();
  for (const rawLine of String(logText || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('COMMIT:')) {
      const sha = line.slice('COMMIT:'.length).trim();
      commit = /^[0-9a-f]{40}$/i.test(sha) ? sha : '';
      continue;
    }
    if (!commit || !INITIAL_PATH.test(line)) continue;
    const key = `${commit}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ commit, path: line });
  }
  return entries;
}

export function countInitialCsvRecords(csvText, columns) {
  return rowsToRecords(parseCsv(String(csvText || '')), columns).length;
}

export function initialImportBudget({ cwd = process.cwd(), columns, gitExec = defaultGit } = {}) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('initial-budget-columns-required');

  let logText;
  try {
    logText = gitExec([
      'log',
      '--since=24 hours ago',
      '--diff-filter=A',
      '--format=COMMIT:%H',
      '--name-only',
      '--',
      'data/initial-*.csv'
    ], cwd);
  } catch (error) {
    throw new Error(`initial-budget-git-log-failed:${error.message}`);
  }

  const additions = parseRecentInitialAdds(logText);
  let used = 0;
  const files = [];
  for (const entry of additions) {
    let csvText;
    try {
      csvText = gitExec(['show', `${entry.commit}:${entry.path}`], cwd);
    } catch (error) {
      throw new Error(`initial-budget-git-show-failed:${entry.path}:${error.message}`);
    }
    const records = countInitialCsvRecords(csvText, columns);
    used += records;
    files.push({ ...entry, records });
  }

  if (used > INITIAL_IMPORT_ROLLING_LIMIT) {
    throw new Error(`initial-import-budget-already-exceeded:${used}/${INITIAL_IMPORT_ROLLING_LIMIT}`);
  }
  return {
    window: 'rolling-24-hours',
    limit: INITIAL_IMPORT_ROLLING_LIMIT,
    used,
    remaining: INITIAL_IMPORT_ROLLING_LIMIT - used,
    files
  };
}
