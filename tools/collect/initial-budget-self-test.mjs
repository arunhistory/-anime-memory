import assert from 'node:assert/strict';
import { loadColumns, recordsToCsv } from '../csv/csv.mjs';
import {
  INITIAL_IMPORT_ROLLING_LIMIT,
  countInitialCsvRecords,
  initialImportBudget,
  parseRecentInitialAdds
} from './initial-budget.mjs';

const columns = loadColumns(process.cwd());

function fixtureCsv(count, start = 1) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const record = Object.fromEntries(columns.map((column) => [column, '']));
    record.id = `A${String(start + index).padStart(8, '0')}`;
    record.title_ja = `作品${start + index}`;
    record.media_type = 'TV';
    record.updated_at = '2026-09-10';
    records.push(record);
  }
  return recordsToCsv(records, columns);
}

const shaA = 'a'.repeat(40);
const shaB = 'b'.repeat(40);
const log = `COMMIT:${shaB}\ndata/initial-002.csv\n\nCOMMIT:${shaA}\ndata/initial-001.csv\nREADME.md\n`;
assert.deepEqual(parseRecentInitialAdds(log), [
  { commit: shaB, path: 'data/initial-002.csv' },
  { commit: shaA, path: 'data/initial-001.csv' }
]);
assert.equal(countInitialCsvRecords(fixtureCsv(3), columns), 3);

const show = new Map([
  [`${shaA}:data/initial-001.csv`, fixtureCsv(300, 1)],
  [`${shaB}:data/initial-002.csv`, fixtureCsv(100, 301)]
]);
const fakeGit = (args) => {
  if (args[0] === 'log') return log;
  if (args[0] === 'show' && show.has(args[1])) return show.get(args[1]);
  throw new Error(`unexpected git call: ${args.join(' ')}`);
};
const budget = initialImportBudget({ columns, gitExec: fakeGit });
assert.equal(budget.window, 'rolling-24-hours');
assert.equal(budget.limit, INITIAL_IMPORT_ROLLING_LIMIT);
assert.equal(budget.used, 400);
assert.equal(budget.remaining, 50);
assert.equal(budget.files.length, 2);

const emptyBudget = initialImportBudget({
  columns,
  gitExec: (args) => args[0] === 'log' ? '' : (() => { throw new Error('unexpected show'); })()
});
assert.equal(emptyBudget.used, 0);
assert.equal(emptyBudget.remaining, 450);

const overShow = new Map([
  [`${shaA}:data/initial-001.csv`, fixtureCsv(300, 1)],
  [`${shaB}:data/initial-002.csv`, fixtureCsv(151, 301)]
]);
assert.throws(() => initialImportBudget({
  columns,
  gitExec: (args) => {
    if (args[0] === 'log') return log;
    if (args[0] === 'show') return overShow.get(args[1]);
    throw new Error('unexpected git call');
  }
}), /initial-import-budget-already-exceeded:451\/450/);

console.log('Initial import rolling budget self-test: PASS');
console.log('rolling 24-hour maximum: 450');
console.log('multiple initial CSV additions counted: PASS');
console.log('existing over-budget history: BLOCKED');
