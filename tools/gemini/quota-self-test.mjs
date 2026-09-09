import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GEMINI_DAILY_CALL_LIMIT,
  GEMINI_QUOTA_TIME_ZONE,
  emptyGeminiUsage,
  finalizeGeminiCalls,
  geminiQuotaDay,
  loadGeminiUsage,
  quotaStatus,
  reserveGeminiCalls,
  saveGeminiUsage
} from './quota.mjs';

assert.equal(GEMINI_DAILY_CALL_LIMIT, 450);
assert.equal(GEMINI_QUOTA_TIME_ZONE, 'America/Los_Angeles');
assert.equal(geminiQuotaDay(new Date('2026-09-09T06:59:59Z')), '2026-09-08');
assert.equal(geminiQuotaDay(new Date('2026-09-09T07:00:00Z')), '2026-09-09');

const state = emptyGeminiUsage();
const now = new Date('2026-09-09T12:00:00Z');
const first = reserveGeminiCalls(state, { runId: 'run-1', requested: 300, now });
assert.equal(first.reservation, 300);
assert.equal(first.reserved, 300);
assert.equal(quotaStatus(state, now).remaining, 150);

const duplicate = reserveGeminiCalls(state, { runId: 'run-1', requested: 450, now });
assert.equal(duplicate.reservation, 300);
assert.equal(duplicate.reserved, 300);
assert.equal(duplicate.idempotent, true);
assert.equal(quotaStatus(state, now).remaining, 150);

const second = reserveGeminiCalls(state, { runId: 'run-2', requested: 300, now });
assert.equal(second.reservation, 150);
assert.equal(second.reserved, 450);
assert.equal(quotaStatus(state, now).remaining, 0);
assert.throws(() => reserveGeminiCalls(state, { runId: 'run-3', requested: 1, now }), /gemini-daily-budget-exhausted/);

const finalized = finalizeGeminiCalls(state, { runId: 'run-1', actualCalls: 25, day: first.day, now });
assert.equal(finalized.finalized, 25);
assert.equal(finalized.released, 275);
assert.equal(quotaStatus(state, now).used, 25);
assert.equal(quotaStatus(state, now).reserved, 150);
assert.equal(quotaStatus(state, now).remaining, 275);
assert.throws(() => finalizeGeminiCalls(state, { runId: 'run-2', actualCalls: 151, day: second.day, now }), /actualCalls must be an integer/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-gemini-quota-'));
const filePath = path.join(temp, 'crawler', 'gemini-usage.json');
saveGeminiUsage(filePath, state);
const restored = loadGeminiUsage(filePath);
assert.deepEqual(restored, state);
fs.rmSync(temp, { recursive: true, force: true });

console.log('Gemini quota self-test: PASS');
console.log('cross-run reservation: PASS');
console.log('crash-safe conservative reservation: PASS');
console.log('unused reservation release after finalize: PASS');
console.log('provider-day timezone: America/Los_Angeles');
