import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadColumns } from '../csv/csv.mjs';
import { normalizeUrl } from '../discovery/url.mjs';
import { INITIAL_CSV_RECORD_LIMIT } from '../collect/public-package.mjs';
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
assert.match(collectWorkflow, /node tools\/collect\/initial-pending-self-test\.mjs/, 'initial public-package preflight missing');
assert.match(collectWorkflow, /node tools\/discovery\/structured-evidence-self-test\.mjs/, 'structured Evidence preflight missing');
assert.match(discoveryWorkflow, /known-work-wasm-self-test\.mjs/, 'search.wasm registered-work preflight missing');
assert.match(discoveryWorkflow, /known-work-skip-self-test\.mjs/, 'next-run registered-work enrichment preflight missing');

assert.equal(INITIAL_CSV_RECORD_LIMIT, 500, 'initial CSV package size must remain 500');
assert.equal(GEMINI_DAILY_CALL_LIMIT, 450, 'Gemini daily call limit must remain 450');
assert.match(productionWorkflow, /cycle\.mjs checkpoint/, '24-hour inactivity checkpoint missing');
assert.match(productionWorkflow, /cycle_action=continue/, 'bounded workflow continuation missing');
assert.match(productionWorkflow, /actions:\s*write/, 'bounded workflow continuation permission missing');
assert.match(productionWorkflow, /--max-pages 100/, 'production batch must remain bounded to 100 pages');
assert.match(productionWorkflow, /--per-host-limit 100/, 'production batch must keep a bounded per-host fetch limit');
assert.equal(/while true/.test(productionWorkflow), false, 'unbounded production loop returned');
assert.equal(/stop\s+--reason\s+package-complete/.test(productionWorkflow), false, 'one CSV package must not terminate the research cycle');
assert.equal(/cycle_final\.outputs\.active == 'true'\s*&&\s*steps\.collect\.outputs\.csv_created != 'true'/.test(productionWorkflow), false, 'CSV creation must not suppress the next research batch');
assert.match(productionWorkflow, /if grep -Eq '[^']+' \/tmp\/manifest\.csv; then/, 'Pages manifest retry must not fail on a stale successful response');
assert.match(productionWorkflow, /wikidata-series-expansion-self-test\.mjs/, 'full-series expansion must be production-preflight tested');
assert.match(productionWorkflow, /publishable-readiness-self-test\.mjs/, 'publication information gate must be production-preflight tested');
assert.match(productionWorkflow, /series-record-self-test\.mjs/, 'series CSV mapping must be production-preflight tested');
assert.match(productionWorkflow, /series-enrichment-self-test\.mjs/, 'series transactional enrichment must be production-preflight tested');
assert.match(productionWorkflow, /cold-start-self-test\.mjs/, 'frontier persistence/per-host behavior must be production-preflight tested');
assert.match(productionWorkflow, /frontier-priority-self-test\.mjs/, '200k frontier priority scaling must be production-preflight tested');
assert.match(discoveryWorkflow, /frontier-priority-self-test\.mjs/, '200k frontier priority scaling must be manual-discovery preflight tested');
assert.match(productionWorkflow, /git add -A confirmed/, 'confirmed master directory must be committed independently from public data');
assert.match(productionWorkflow, /git add -A data/, 'public data directory must remain a separate commit target');
assert.equal(productionWorkflow.includes('crawler/pending-initial.json'), false, 'legacy pending JSON must not return');

const validator = read('tools/validate/data-validator.mjs');
assert.match(validator, /'Web 最速'/, 'streaming mode Web 最速 spacing drifted');
assert.match(validator, /relations targetが存在しない/, 'relation target existence validation missing');
assert.match(validator, /original_type は原作タグ1つのみ指定可能/, 'single original_type enforcement missing');
assert.equal(validator.includes('isKnownLegacyInitial001'), false, 'obsolete legacy initial package exception must not remain');

const knownWorkWasm = read('tools/discovery/known-work-wasm.mjs');
assert.match(knownWorkWasm, /assets[^\n]+wasm[^\n]+search\.js/, 'registered-work lookup must reuse assets/wasm/search.js');
assert.match(knownWorkWasm, /search\.wasm/, 'registered-work lookup must reuse search.wasm');
assert.match(knownWorkWasm, /_anime_search_add_text_term/, 'registered-work lookup must use search.wasm text search ABI');
assert.match(knownWorkWasm, /'title'/, 'registered-work lookup must search the WASM title group');

const discoveryRun = read('tools/discovery/run.mjs');
const discoveryEngine = read('tools/discovery/engine.mjs');
const frontierPriority = read('tools/discovery/frontier-priority.mjs');
const discoveryState = read('tools/discovery/state.mjs');
const discoveryCycle = read('tools/discovery/cycle.mjs');
const seriesLearning = read('tools/discovery/series-learning.mjs');
const seriesExpansion = read('tools/discovery/wikidata-series-expansion.mjs');
const seriesRecord = read('tools/discovery/series-record.mjs');
const researchCompletion = read('tools/discovery/research-completion.mjs');
const toRecord = read('tools/discovery/to-record.mjs');
const wikidataBootstrap = read('tools/discovery/wikidata-bootstrap.mjs');
const collector = read('tools/collect/run.mjs');
const confirmedCsv = read('tools/collect/confirmed-csv.mjs');
const publicPackage = read('tools/collect/public-package.mjs');
const seriesEnrichment = read('tools/collect/series-enrichment.mjs');
const initialPending = read('tools/collect/initial-pending.mjs');

assert.match(discoveryRun, /loadKnownWorkWasmSearch/, 'discovery runner must load registered works through search.wasm when web pages are available');
assert.match(discoveryRun, /knownWorkSearch/, 'discovery runner must pass search.wasm lookup into the engine');
assert.match(discoveryRun, /expandSeriesFromWikidata/, 'full-series expansion must run before ordinary page discovery');
assert.match(discoveryRun, /if \(state\.frontier\.length > 0\)/, 'empty web frontier must not be treated as a fatal bootstrap condition');
assert.equal(discoveryRun.includes('探索開始URLがありません'), false, 'empty frontier fatal error must not discard bootstrap/series progress');
assert.match(discoveryRun, /saveDiscoveryState\(statePath, result\.state\)/, 'bounded discovery progress must persist');

assert.match(discoveryEngine, /hasExactTitle/, 'discovery engine must query search.wasm for registered works');
assert.match(discoveryEngine, /knownStateCandidatesRetained/, 'registered candidates must stay researchable while information is incomplete');
assert.match(discoveryEngine, /knownWorkEvidenceReused/, 'registered-work evidence must be reused for enrichment');
assert.match(discoveryEngine, /seriesPriorityBoost/, 'series-first link prioritization must be connected');
assert.match(discoveryEngine, /informationPriorityBoost/, 'missing information categories must affect link priority');
assert.match(discoveryEngine, /recordCandidateResearch/, 'candidate research progress must be recorded from fetched pages');
assert.match(discoveryEngine, /buildFrontierPriorityIndex\(frontier, queued\)/, 'frontier grouped priority index must be connected');
assert.match(discoveryEngine, /popBestFrontier\(frontierPriorityIndex, queued, trustModel, hostCounts, perHostLimit\)/, 'per-host bounded grouped frontier selection must be connected');
assert.match(discoveryEngine, /compactFrontier\(frontier, queued\)/, 'frontier must compact only after the bounded batch');
assert.equal(/function\s+popBest\s*\(/.test(discoveryEngine), false, 'legacy O(n) popBest frontier scan returned');
assert.match(frontierPriority, /scoreResearchRoute/, 'group-head selection must re-evaluate current learned route trust');
assert.match(frontierPriority, /heapPush/, 'frontier index must use heap ordering within route groups');
assert.match(frontierPriority, /hostCounts/, 'frontier priority index must preserve per-host fetch bounds');

assert.match(seriesLearning, /relatedSeriesHints/, 'series learner must expose related work hints');
assert.equal(seriesLearning.includes('MAX_SERIES_MEMBERS'), false, 'canonical series members must not be silently capped');
assert.match(seriesExpansion, /\?item wdt:P179 \?series/, 'full-series expansion must enumerate members through series membership');
assert.match(seriesExpansion, /\?item wdt:P495 wd:Q17/, 'full-series expansion must retain the Japan-origin gate');
assert.equal(seriesExpansion.includes('MAX_EXPANDED_SERIES'), false, 'expanded-series progress must not silently stop at 20,000');
assert.match(discoveryState, /wikidataSeriesExpansion/, 'full-series expansion progress must persist across bounded runs');
assert.equal(discoveryState.includes('MAX_FRONTIER'), false, 'frontier must not be silently capped at 50,000');
assert.equal(discoveryState.includes('MAX_FRONTIER_PER_HOST'), false, 'frontier persistence must not silently discard one host after 5,000 URLs');
assert.equal(/\.slice\(0,\s*20000\)\s*;/.test(discoveryState), false, 'candidate state must not be silently capped at 20,000');
assert.equal(confirmedCsv.includes('INITIAL_PENDING_RECORD_LIMIT'), false, 'confirmed master must not be silently capped at 20,000');
assert.equal(publicPackage.includes('INITIAL_PENDING_RECORD_LIMIT'), false, 'public package selection must not use the removed pending-state cap');
assert.equal(initialPending.includes('loadInitialPending'), false, 'legacy pending-state persistence must remain removed');
assert.equal(initialPending.includes('saveInitialPending'), false, 'legacy pending-state persistence must remain removed');
assert.equal(discoveryCycle.includes('MAX_SEEN'), false, 'cycle eligible history must not be silently capped at 20,000');
assert.match(discoveryCycle, /bootstrapIncomplete/, 'empty-frontier stop must account for unfinished bootstrap work');
assert.match(discoveryCycle, /pendingSeries/, 'empty-frontier stop must account for unfinished series expansion');

assert.match(researchCompletion, /information-rich/, 'publication research completion mode missing');
assert.match(researchCompletion, /researched-to-exhaustion/, 'scarce-work research saturation fallback missing');
assert.match(toRecord, /publishableDiscoveryReadiness/, 'CSV publication must use information-aware readiness');
assert.match(toRecord, /series-not-expanded/, 'series records must not publish before full-series expansion');
assert.match(toRecord, /seriesIdForRef/, 'series_id must be derived from canonical series reference');
assert.match(wikidataBootstrap, /wdt:P179/, 'Wikidata bootstrap must learn series membership');
assert.match(wikidataBootstrap, /wdt:P155/, 'Wikidata bootstrap must learn previous works');
assert.match(wikidataBootstrap, /wdt:P156/, 'Wikidata bootstrap must learn next works');
assert.match(wikidataBootstrap, /sourceTitle/, 'Wikidata relation graph must preserve directed source/target works');
assert.match(seriesRecord, /seriesIdForRef/, 'stable series common-ID mapping missing');
assert.match(seriesRecord, /unresolvedRelations/, 'unregistered relation targets must remain unresolved instead of dangling');
assert.match(seriesRecord, /seriesIdConflicts/, 'non-empty series ID conflicts must be surfaced instead of overwritten');
assert.match(seriesEnrichment, /applySeriesMetadata/, 'series metadata must be staged across existing and selected records');
assert.match(collector, /syncConfirmedMaster/, 'collector must update the identity-confirmed master before publication');
assert.match(confirmedCsv, /record\.id = nextId\(\)/, 'confirmed master must assign stable A IDs before publication');
assert.match(collector, /attachConfirmedIds\(input\.normalized, confirmedMaster\)[\s\S]*applySeriesMetadataToCollection/, 'public rows must inherit confirmed-master IDs before relation target resolution');
assert.match(collector, /saveConfirmedCsv\(confirmedPath, confirmedMaster, columns\)/, 'collector must persist confirmed master independently from public CSV');
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
assert.equal(exists('.github/workflows/title-driven-search-live-pilot.yml'), false, 'title-driven one-time live pilot workflow must be removed after verification');
assert.equal(exists('tools/discovery/relation-evidence.mjs'), false, 'unconnected relation prototype must not remain');
assert.equal(exists('crawler/pending-initial.json'), false, 'legacy pending JSON must not be committed');

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
console.log('confirmed/public CSV directories: SEPARATE');
console.log('confirmed-master ID before public relation staging: PASS');
console.log('legacy pending JSON/CSV state: REMOVED');
console.log('Gemini daily call limit: 450 / opt-in only');
console.log('24-hour confirmed-work inactivity stop: PRESENT');
console.log('single CSV package cycle-stop: BLOCKED');
console.log('bootstrap/series premature frontier-empty stop: BLOCKED');
console.log('Pages stale-manifest retry: PRESENT');
console.log('registered-work next-run lookup: search.wasm + enrichment retained');
console.log('series-first research: FULL-SERIES PRE-EXPANSION');
console.log('series_id / relations CSV bridge: CONNECTED + VALIDATED');
console.log('sparse publication: BLOCKED BY INFORMATION COMPLETION');
console.log('candidate/frontier/confirmed/cycle 20k-50k silent caps: REMOVED');
console.log('frontier selection: GROUPED HEAP + CURRENT TRUST RE-EVALUATION');
console.log('per-host fetch protection: BOUNDED PER BATCH WITHOUT PERSISTENCE LOSS');
console.log('streaming/original/relation validation: PASS');
console.log('external search API coupling: NONE');
console.log('public secret exposure markers: NONE');
console.log('raw HTML persistence: NONE');
console.log('one-time pilot workflow: REMOVED');
console.log('TODO/FIXME markers: NONE');
