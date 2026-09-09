import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadColumns } from '../csv/csv.mjs';
import { normalizeUrl } from '../discovery/url.mjs';
import { INITIAL_IMPORT_ROLLING_LIMIT } from '../collect/initial-budget.mjs';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const expectedColumns = [
  'id','title_ja','title_kana','title_romaji','title_en','aliases','media_type','release_start','release_end','episode_count','runtime_min','series_id','season_number','genres','tags','target_demographic','setting','era','themes','original_type','original_title','original_author','original_artist','original_publisher','original_label','original_magazine','original_platform','animation_studio','co_animation_studio','animation_cooperation','production_name','production_committee','production_members','production_lead_company','planning','executive_producers','producers','animation_producers','line_producers','director','chief_director','series_composition','character_original_design','character_design','music','sound_director','staff','characters','opening_themes','ending_themes','insert_songs','music_production','soundtrack_label','broadcast_networks','broadcast_slots','streaming_services','film_distributor','theatrical_release_date','relations','episodes','episode_staff','awards','synopsis','image_url','official_url','official_x','official_youtube','official_other','external_ids','updated_at'
];
assert.deepEqual(loadColumns(root), expectedColumns, '70-column schema/order drifted');

for (const file of ['index.html', 'search.html', 'all.html', 'detail.html', 'assets/wasm/search.wasm', 'assets/wasm/all.wasm']) {
  assert.equal(exists(file), true, `required public artifact missing: ${file}`);
}
assert.equal(exists('search/index.html'), false, 'old duplicate search route returned');
assert.equal(exists('all/index.html'), false, 'old duplicate all route returned');
assert.equal(exists('detail/index.html'), false, 'old duplicate detail route returned');
assert.equal(exists('master.csv'), false, 'master.csv must not be introduced');
assert.equal(exists('data/master.csv'), false, 'data/master.csv must not be introduced');

const seeds = read('crawler/seeds.txt')
  .split(/\r?\n/)
  .map((line) => line.replace(/\s+#.*$/, '').trim())
  .filter((line) => line && !line.startsWith('#'));
assert.ok(seeds.length >= 1, 'crawler bootstrap seed is missing');
for (const seed of seeds) assert.ok(normalizeUrl(seed), `invalid public bootstrap seed: ${seed}`);

const discoveryWorkflow = read('.github/workflows/web-discovery.yml');
const collectWorkflow = read('.github/workflows/data-collect.yml');
assert.equal(/^\s*schedule\s*:/m.test(discoveryWorkflow), false, 'Web discovery must not gain cron scheduling');
assert.equal(/^\s*schedule\s*:/m.test(collectWorkflow), false, 'Data collection must not gain cron scheduling');
assert.match(discoveryWorkflow, /workflow_dispatch:/, 'Web discovery must remain explicit/event driven');
assert.match(collectWorkflow, /workflow_dispatch:/, 'Data collection must remain explicit/event driven');

function inputBlock(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `      ${name}:`);
  assert.notEqual(start, -1, `workflow input missing: ${name}`);
  const output = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^      [A-Za-z0-9_-]+:$/.test(lines[index])) break;
    output.push(lines[index]);
  }
  return output.join('\n');
}
assert.match(inputBlock(collectWorkflow, 'gemini'), /^\s*default:\s*false\s*$/m, 'Gemini must default OFF before connection');
assert.match(inputBlock(collectWorkflow, 'dry_run'), /^\s*default:\s*true\s*$/m, 'collection must default to dry-run');

const collectStep = collectWorkflow.indexOf('- name: Collect and build common CSV');
const geminiSecret = collectWorkflow.indexOf('ANIME_GEMINI_API_KEY:');
assert.ok(collectStep >= 0 && geminiSecret > collectStep, 'Gemini secret must not be job-wide');
assert.match(collectWorkflow.slice(collectStep), /ANIME_GEMINI_API_KEY:\s*\$\{\{\s*\(!inputs\.dry_run\s*&&\s*inputs\.gemini\)/, 'Gemini secret must be gated by explicit opt-in and non-dry-run');
assert.match(collectWorkflow, /node tools\/collect\/initial-budget-self-test\.mjs/, 'initial rolling-budget preflight missing');
assert.match(collectWorkflow, /node tools\/discovery\/structured-evidence-self-test\.mjs/, 'structured Evidence preflight missing');

assert.equal(INITIAL_IMPORT_ROLLING_LIMIT, 450, 'initial rolling 24-hour limit must remain 450');
const budgetSource = read('tools/collect/initial-budget.mjs');
assert.match(budgetSource, /--since=24 hours ago/, 'initial limit must span multiple runs over rolling 24 hours');
assert.match(budgetSource, /--diff-filter=A/, 'initial budget must count newly-added initial CSV files');

const validator = read('tools/validate/data-validator.mjs');
assert.match(validator, /'Web 最速'/, 'streaming mode Web 最速 spacing drifted');
assert.match(validator, /relations targetが存在しない/, 'relation target existence validation missing');
assert.match(validator, /original_type は原作タグ1つのみ指定可能/, 'single original_type enforcement missing');

const discoveryDir = path.join(root, 'tools', 'discovery');
const discoverySource = fs.readdirSync(discoveryDir)
  .filter((name) => name.endsWith('.mjs') && !name.endsWith('-self-test.mjs'))
  .map((name) => fs.readFileSync(path.join(discoveryDir, name), 'utf8'))
  .join('\n');
for (const forbidden of ['BRAVE_SEARCH_API_KEY', 'SERPAPI', 'GOOGLE_CUSTOM_SEARCH', 'ANIME_GEMINI_API_KEY']) {
  assert.equal(discoverySource.includes(forbidden), false, `discovery has forbidden external-search/Gemini coupling: ${forbidden}`);
}

const publicFiles = [
  'index.html', 'search.html', 'all.html', 'detail.html',
  ...fs.readdirSync(path.join(root, 'assets', 'js')).filter((name) => name.endsWith('.js')).map((name) => `assets/js/${name}`)
];
const publicSource = publicFiles.map(read).join('\n');
for (const forbidden of ['ANIME_GEMINI_API_KEY', 'GEMINI_API_KEY', 'AIza']) {
  assert.equal(publicSource.includes(forbidden), false, `Gemini/API secret marker leaked into public code: ${forbidden}`);
}

const stateText = read('crawler/state.json');
assert.equal(/<html[\s>]/i.test(stateText), false, 'raw HTML must not be persisted in crawler state');
assert.equal(exists('.github/workflows/discovery-quality-pilot-once.yml'), false, 'one-time live pilot workflow must be removed after verification');
assert.equal(exists('tools/discovery/relation-evidence.mjs'), false, 'unconnected relation prototype must not remain');

const productionCodeRoots = ['tools', 'wasm-src', 'assets/js'];
const unfinished = [];
function scan(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolute)) scan(path.join(relative, name));
    return;
  }
  if (!/\.(?:mjs|js|hpp|cpp|h)$/.test(relative)) return;
  const text = fs.readFileSync(absolute, 'utf8');
  if (/\b(?:TODO|FIXME)\b/.test(text)) unfinished.push(relative);
}
for (const target of productionCodeRoots) scan(target);
assert.deepEqual(unfinished, [], `unfinished code markers remain: ${unfinished.join(', ')}`);

console.log('Pre-Gemini repository audit: PASS');
console.log('70-column schema/order: PASS');
console.log('4-page + separate WASM artifacts: PASS');
console.log('bootstrap seed: PRESENT');
console.log('cron/polling workflows: NONE');
console.log('Gemini default: OFF');
console.log('Gemini secret scope: OPT-IN COLLECTION STEP ONLY');
console.log('rolling 24-hour initial limit: 450');
console.log('streaming/original/relation validation: PASS');
console.log('external search API coupling: NONE');
console.log('public secret exposure markers: NONE');
console.log('raw HTML persistence: NONE');
console.log('one-time pilot workflow: REMOVED');
console.log('TODO/FIXME markers: NONE');