import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadColumns, parseCsv, readUtf8Strict, rowsToRecords } from '../csv/csv.mjs';
import { emptyDiscoveryState } from '../discovery/state.mjs';
import { loadConfirmedCsv } from './confirmed-csv.mjs';

const root = process.cwd();
const columns = loadColumns(root);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-package-integration-'));
fs.mkdirSync(path.join(tempRoot, 'wasm-src', 'shared'), { recursive: true });
fs.mkdirSync(path.join(tempRoot, 'crawler'), { recursive: true });
fs.copyFileSync(path.join(root, 'wasm-src', 'shared', 'schema.hpp'), path.join(tempRoot, 'wasm-src', 'shared', 'schema.hpp'));

function candidate(index) {
  const title = `統合試験作品${index + 1}`;
  const sourceA = `https://source-a.example.net/work/${index + 1}`;
  const sourceB = `https://source-b.example.org/work/${index + 1}`;
  const facts = {
    title_ja: title,
    media_type: 'TV',
    origin_country: 'JP',
    release_start: `2027-${String((index % 12) + 1).padStart(2, '0')}-01`,
    episode_count: '12',
    animation_studio: `試験スタジオ${index + 1}`,
    production_name: `試験製作${index + 1}`,
    director: `監督${index + 1}`,
    series_composition: `構成${index + 1}`,
    character_design: `デザイン${index + 1}`,
    sound_director: `音響${index + 1}`,
    original_type: '漫画',
    original_author: `原作者${index + 1}`,
    broadcast_networks: 'TOKYO MX',
    music: `音楽${index + 1}`,
    music_production: `音楽制作${index + 1}`,
    official_url: `https://official.example.jp/work/${index + 1}`
  };
  const evidence = [];
  for (const [field, value] of Object.entries(facts)) {
    for (const sourceUrl of [sourceA, sourceB]) {
      evidence.push({
        field,
        value,
        sourceUrl,
        sourceClass: 'secondary',
        directness: field === 'origin_country' ? 100 : 95,
        rule: field === 'origin_country'
          ? 'origin-country-labeled-japan'
          : field === 'media_type'
            ? 'media-type-labeled'
            : field === 'title_ja'
              ? 'page-title'
              : `fixture-${field}`,
        observedAt: '2026-09-12T00:00:00.000Z'
      });
    }
  }
  return {
    key: `integration-work-${index + 1}`,
    title,
    sources: [sourceA, sourceB],
    evidence,
    facts: {},
    series: {},
    research: {},
    lastSeen: '2026-09-12T00:00:00.000Z'
  };
}

const state = emptyDiscoveryState();
state.candidates = Array.from({ length: 501 }, (_, index) => candidate(index));
fs.writeFileSync(path.join(tempRoot, 'crawler', 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');

function runCollector() {
  return spawnSync(process.execPath, [path.join(root, 'tools', 'collect', 'run.mjs'), '--input', 'discovery', '--mode', 'initial', '--gemini', 'false'], {
    cwd: tempRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
}

const first = runCollector();
assert.equal(first.status, 0, first.stderr || first.stdout);
const confirmedPath = path.join(tempRoot, 'confirmed', 'confirmed.csv');
const confirmedRecords = loadConfirmedCsv(confirmedPath, columns);
assert.equal(confirmedRecords.length, 501, 'all identity-confirmed works must remain in the confirmed master');
assert.equal(confirmedRecords[0].id, 'A00000001');
assert.equal(confirmedRecords.at(-1).id, 'A00000501');

const csvPath = path.join(tempRoot, 'data', 'initial-001.csv');
const csvRecords = rowsToRecords(parseCsv(readUtf8Strict(csvPath)), columns);
assert.equal(csvRecords.length, 500);
assert.deepEqual(
  csvRecords.map((record) => record.id),
  confirmedRecords.slice(0, 500).map((record) => record.id),
  'public copy must reuse the fixed IDs from confirmed master'
);
assert.equal(readUtf8Strict(path.join(tempRoot, 'data', 'manifest.csv')), 'file_name\r\ninitial-001.csv\r\n');
assert.equal(fs.existsSync(path.join(tempRoot, 'crawler', 'pending-initial.json')), false, 'JSON pending state must not be recreated');

const second = runCollector();
assert.equal(second.status, 0, second.stderr || second.stdout);
assert.equal(fs.existsSync(path.join(tempRoot, 'data', 'initial-002.csv')), false, 'one remaining public-ready work must wait until the next 500-work package can be formed');
const confirmedAgain = loadConfirmedCsv(confirmedPath, columns);
assert.equal(confirmedAgain.length, 501, 'publication must not consume or delete confirmed master rows');
assert.deepEqual(confirmedAgain.map((record) => record.id), confirmedRecords.map((record) => record.id), 'confirmed IDs must remain stable across collection runs');

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('Confirmed/public package integration self-test: PASS');
console.log('501 identity-confirmed -> confirmed master keeps 501: PASS');
console.log('500 public copy + 1 waits for next public package: PASS');
console.log('confirmed/public folders are independent: PASS');
console.log('confirmed ID -> public ID: PRESERVED');
console.log('JSON pending state: REMOVED');
console.log('public manifest connection: PASS');
