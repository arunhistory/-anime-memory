import fs from 'node:fs';
import path from 'node:path';

export const GEMINI_DAILY_CALL_LIMIT = 450;
export const GEMINI_QUOTA_TIME_ZONE = 'America/Los_Angeles';

function integer(value, name, min = 0, max = GEMINI_DAILY_CALL_LIMIT) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

export function geminiQuotaDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: GEMINI_QUOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function emptyGeminiUsage() {
  return { version: 1, days: {}, updatedAt: '' };
}

export function loadGeminiUsage(filePath) {
  if (!fs.existsSync(filePath)) return emptyGeminiUsage();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (parsed?.version !== 1 || !parsed.days || typeof parsed.days !== 'object' || Array.isArray(parsed.days)) {
    throw new Error('gemini-usage-state-invalid');
  }
  return parsed;
}

function dayEntry(state, day) {
  if (!state.days[day]) state.days[day] = { used: 0, reservations: {} };
  const entry = state.days[day];
  if (!Number.isInteger(entry.used) || entry.used < 0 || entry.used > GEMINI_DAILY_CALL_LIMIT) throw new Error('gemini-usage-used-invalid');
  if (!entry.reservations || typeof entry.reservations !== 'object' || Array.isArray(entry.reservations)) throw new Error('gemini-usage-reservations-invalid');
  for (const [runId, value] of Object.entries(entry.reservations)) {
    if (!runId || !Number.isInteger(value) || value < 0 || value > GEMINI_DAILY_CALL_LIMIT) throw new Error('gemini-usage-reservation-invalid');
  }
  return entry;
}

function reservedTotal(entry) {
  return Object.values(entry.reservations).reduce((sum, value) => sum + value, 0);
}

function pruneOldDays(state) {
  const days = Object.keys(state.days).sort();
  for (const day of days.slice(0, Math.max(0, days.length - 8))) delete state.days[day];
}

export function quotaStatus(state, now = new Date()) {
  const day = geminiQuotaDay(now);
  const entry = dayEntry(state, day);
  const reserved = reservedTotal(entry);
  const remaining = Math.max(0, GEMINI_DAILY_CALL_LIMIT - entry.used - reserved);
  return { day, used: entry.used, reserved, remaining, limit: GEMINI_DAILY_CALL_LIMIT };
}

export function reserveGeminiCalls(state, { runId, requested, now = new Date() }) {
  const id = String(runId || '').trim();
  if (!id) throw new Error('gemini-quota-run-id-required');
  const wanted = integer(requested, 'requested', 1);
  const day = geminiQuotaDay(now);
  const entry = dayEntry(state, day);

  if (Object.hasOwn(entry.reservations, id)) {
    const reservation = entry.reservations[id];
    return { ...quotaStatus(state, now), reservation, idempotent: true };
  }

  const available = Math.max(0, GEMINI_DAILY_CALL_LIMIT - entry.used - reservedTotal(entry));
  const reservation = Math.min(wanted, available);
  if (reservation <= 0) throw new Error('gemini-daily-budget-exhausted');
  entry.reservations[id] = reservation;
  state.updatedAt = new Date(now).toISOString();
  pruneOldDays(state);
  return { ...quotaStatus(state, now), reservation, idempotent: false };
}

export function finalizeGeminiCalls(state, { runId, actualCalls, day, now = new Date() }) {
  const id = String(runId || '').trim();
  if (!id) throw new Error('gemini-quota-run-id-required');
  const targetDay = String(day || geminiQuotaDay(now));
  const entry = dayEntry(state, targetDay);
  if (!Object.hasOwn(entry.reservations, id)) throw new Error('gemini-quota-reservation-missing');
  const reservation = entry.reservations[id];
  const actual = integer(actualCalls, 'actualCalls', 0, reservation);
  delete entry.reservations[id];
  entry.used += actual;
  if (entry.used > GEMINI_DAILY_CALL_LIMIT) throw new Error('gemini-daily-budget-overflow');
  state.updatedAt = new Date(now).toISOString();
  pruneOldDays(state);
  return { ...quotaStatus(state, new Date(now)), day: targetDay, finalized: actual, released: reservation - actual };
}

export function saveGeminiUsage(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function cli() {
  const [command = 'status', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const filePath = path.resolve(process.cwd(), String(args.state || 'crawler/gemini-usage.json'));
  const state = loadGeminiUsage(filePath);
  const runId = String(args['run-id'] || process.env.GITHUB_RUN_ID || '').trim();
  let result;

  if (command === 'reserve') {
    result = reserveGeminiCalls(state, { runId, requested: args.requested || GEMINI_DAILY_CALL_LIMIT });
    saveGeminiUsage(filePath, state);
  } else if (command === 'finalize') {
    result = finalizeGeminiCalls(state, { runId, actualCalls: args.actual || 0, day: args.day || undefined });
    saveGeminiUsage(filePath, state);
  } else if (command === 'status') {
    result = quotaStatus(state);
  } else {
    throw new Error('quota command must be reserve, finalize, or status');
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch((error) => {
    console.error(`Gemini quota: FAIL\n${error.message}`);
    process.exit(1);
  });
}
