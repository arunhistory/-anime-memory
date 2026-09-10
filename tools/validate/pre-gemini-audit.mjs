import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadColumns } from '../csv/csv.mjs';
import { normalizeUrl } from '../discovery/url.mjs';
import { INITIAL_CSV_RECORD_LIMIT } from '../collect/initial-pending.mjs';
import { GEMINI_DAILY_CALL_LIMIT } from '../gemini/quota.mjs';

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
const productionWorkflow = read('.github/workflows/research-production.yml');
assert.equal(/^\s*schedule\s*:/m.test(discoveryWorkflow), false, 'Web discovery must not gain cron scheduling');
assert.equal(/^\s*schedule\s*:/m.test(collectWorkflow), false, 'Data collection must not gain cron scheduling');
assert.match(discoveryWorkflow, /workflow_dispatch:/, 'Web discovery must remain explicit/event driven');
assert.match(collectWorkflow, /workflow_dispatch:/, 'Data collection must remain explicit/event driven');
assert.match(productionWorkflow, /cron:\s*'17 0 1 1,4,7,10 \*'/, 'production cycle must start only on quarterly dates');

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
assert.match(collectWorkflow, /node tools\/collect\/initial-pending-self-test\.mjs/, 'initial pending-state preflight missing');
assert.match(collectWorkflow, /node tools\/discovery\/structured-evidence-self-test\.mjs/, 'structured Evidence preflight missing');
assert.match(discoveryWorkflow, /known-work-wasm-self-test\.mjs/, 'search.wasm registered-work preflight missing');
assert.match(discoveryWorkflow, /known-work-skip-self-test\.mjs/, 'next-run registered-work enrichment preflight missing');

assert.equal(INITIAL_CSV_RECORD_LIMIT, 500, 'initial CSV package size must remain 500');
assert.equal(GEMINI_DAILY_CALL_LIMIT, 450, 'Gemini daily call limit must remain 450');
assert.match(productionWorkflow, /cycle\.mjs checkpoint/, '24-hour inactivity checkpoint missing');
assert.match(productionWorkflow, /cycle_action=continue/, 'bounded workflow continuation missing');
assert.match(productionWorkflow, /actions:\s*write/, 'bounded workflow continuation permission missing');
assert.match(productionWorkflow, /--max-pages 100/, 'production batch must remain bounded to 100 pages');
assert.equal(/while true/.test(productionWorkflow), false, 'unbounded production loop returned');
assert.equal(/stop\s+--reason\s+package-complete/.test(productionWorkflow), false, 'one CSV package must not terminate the research cycle');
assert.equal(/cycle_final\.outputs\.active == 'true'\s*&&\s*steps\.collect\.outputs\.csv_created != 'true'/.test(productionWorkflow), false, 'CSV creation must not suppress the next research batch');
assert.match(productionWorkflow, /if grep -Eq '[^']+' \/tmp\/manifest\.csv; then/, 'Pages manifest retry must not fail on a stale successful response');

const validator = read('tools/validate/data-validator.mjs');
assert.match(validator, /'Web 最速'/, 'streaming mode Web 最速 spacing drifted');
assert.match(validator, /relations targetが存在しない/, 'relation target existence validation missing');
assert.match(validator, /original_type は原作タグ1つのみ指定可能/, 'single original_type enforcement missing');

const knownWorkWasm = read('tools/discovery/known-work-wasm.mjs');
assert.match(knownWorkWasm, /assets[^\n]+wasm[^\n]+search\.js/, 'registered-work lookup must reuse assets/wasm/search.js');
assert.match(knownWorkWasm, /search\.wasm/, 'registered-work lookup must reuse search.wasm');
assert.match(knownWorkWasm, /_anime_search_add_text_term/, 'registered-work lookup must use search.wasm text search ABI');
assert.match(knownWorkWasm, /'title'/, 'registered-work lookup must search the WASM title group');
const discoveryRun = read('tools/discovery/run.mjs');
const discoveryEngine = read('tools/discovery/engine.mjs');
const seriesLearning = read('tools/discovery/series-learning.mjs');
const wikidataBootstrap = read('tools/discovery/wikidata-bootstrap.mjs');
const collector = read('tools/collect/run.mjs');
assert.match(discoveryRun, /loadKnownWorkWasmSearch/, 'discovery runner must load registered works through search.wasm');
assert.match(discoveryRun, /knownWorkSearch/, 'discovery runner must pass search.wasm lookup into the engine');
assert.match(discoveryEngine, /hasExactTitle/, 'discovery engine must query search.wasm for registered works');
assert.match(discoveryEngine, /knownStateCandidatesRetained/, 'registered candidates must stay researchable after CSV registration');
assert.match(discoveryEngine, /knownWorkEvidenceReused/, 'registered-work evidence must be reused for enrichment');
assert.match(discoveryEngine, /seriesPriorityBoost/, 'series-first link prioritization must be connected');
assert.match(seriesLearning, /relatedSeriesHints/, 'series learner must expose related work hints');
assert.match(wikidataBootstrap, /wdt:P179/, 'Wikidata bootstrap must learn series membership');
assert.match(wikidataBootstrap, /wdt:P155/, 'Wikidata bootstrap must learn previous works');
assert.match(wikidataBootstrap, /wdt:P156/, 'Wikidata bootstrap must learn next works');
assert.match(collector, /prepareEnrichmentWrites/, 'collector must stage registered-work blank-field enrichment');
assert.match(collector, /restoreSnapshots/, 'collector enrichment must have rollback');

const discoveryDir = path.join(root, 'tools', 'discovery');
const discoverySource = fs.readdirSync(discoveryDir)
  .filter((name) => name.endsWith('.mjs') && !name.endsWith('self-test.mjs'))
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
  if (relative === 'tools/validate/pre-gemini-audit.mjs') return;
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
console.log('manual discovery/collection cron: NONE');
console.log('quarterly production activation: PRESENT');
console.log('Gemini default: OFF');
console.log('Gemini secret scope: OPT-IN COLLECTION STEP ONLY');
console.log('initial CSV package size: 500');
console.log('Gemini daily call limit: 450 / opt-in only');
console.log('24-hour confirmed-work inactivity stop: PRESENT');
console.log('single CSV package cycle-stop: BLOCKED');
console.log('Pages stale-manifest retry: PRESENT');
console.log('registered-work next-run lookup: search.wasm + enrichment retained');
console.log('series-first research: PRESENT');
console.log('streaming/original/relation validation: PASS');
console.log('external search API coupling: NONE');
console.log('public secret exposure markers: NONE');
console.log('raw HTML persistence: NONE');
console.log('one-time pilot workflow: REMOVED');
console.log('TODO/FIXME markers: NONE');
