import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const requiredFiles = [
  'index.html',
  'search.html',
  'all.html',
  'detail.html',
  'assets/css/common.css',
  'assets/css/top.css',
  'assets/css/search.css',
  'assets/css/all.css',
  'assets/css/detail.css',
  'assets/js/common.js',
  'assets/js/wasm-runtime.js',
  'assets/js/search-bridge.js',
  'assets/js/all-bridge.js',
  'assets/js/detail-bridge.js',
  'assets/wasm/search.js',
  'assets/wasm/search.wasm',
  'assets/wasm/all.js',
  'assets/wasm/all.wasm'
];

const forbiddenDuplicatePages = [
  'search/index.html',
  'all/index.html',
  'detail/index.html'
];

const htmlFiles = ['index.html', 'search.html', 'all.html', 'detail.html'];
const jsFiles = [
  'assets/js/common.js',
  'assets/js/wasm-runtime.js',
  'assets/js/search-bridge.js',
  'assets/js/all-bridge.js',
  'assets/js/detail-bridge.js'
];

const requiredIds = {
  'search.html': [
    'search-form', 'search-query', 'detail-toggle', 'detail-filters', 'active-filters',
    'clear-search-ui', 'add-text-filter', 'add-date-filter', 'add-number-filter',
    'text-filter-rows', 'date-filter-rows', 'number-filter-rows',
    'sort-key', 'sort-direction', 'search-ui-message', 'results-title', 'result-note', 'results'
  ],
  'all.html': ['all-sort-key', 'all-sort-direction', 'all-status', 'all-results'],
  'detail.html': [
    'detail-status', 'detail-id-badge', 'detail-title', 'detail-sub-title',
    'detail-synopsis', 'detail-tags', 'detail-sections'
  ]
};

const expectedSortValues = ['season', 'date', 'title', 'studio', 'episodes', 'runtime'];
const searchableColumns = [
  'id','title_ja','title_kana','title_romaji','title_en','aliases','media_type','release_start','release_end','episode_count','runtime_min','series_id','season_number',
  'genres','tags','target_demographic','setting','era','themes','original_type','original_title','original_author','original_artist','original_publisher','original_label','original_magazine','original_platform',
  'animation_studio','co_animation_studio','animation_cooperation','production_name','production_committee','production_members','production_lead_company','planning','executive_producers','producers','animation_producers','line_producers',
  'director','chief_director','series_composition','character_original_design','character_design','music','sound_director','staff','characters',
  'opening_themes','ending_themes','insert_songs','music_production','soundtrack_label','broadcast_networks','broadcast_slots','streaming_services','film_distributor','theatrical_release_date',
  'relations','episodes','episode_staff','awards','synopsis','image_url','official_url','official_x','official_youtube','official_other','external_ids','updated_at'
];

function fail(message) { failures.push(message); }
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }
function exists(relativePath) { return fs.existsSync(path.join(root, relativePath)); }

for (const file of requiredFiles) {
  if (!exists(file)) fail(`必須ファイルがありません: ${file}`);
}
for (const file of forbiddenDuplicatePages) {
  if (exists(file)) fail(`旧重複ページが残っています: ${file}`);
}

for (const file of htmlFiles) {
  if (!exists(file)) continue;
  const html = read(file);
  if (!html.includes('<meta name="viewport"')) fail(`viewport meta がありません: ${file}`);
  if (/<script\s+[^>]*src=["']https?:\/\//i.test(html)) fail(`外部scriptを直接読み込んでいます: ${file}`);

  const directory = path.dirname(file);
  const refPattern = /(?:href|src)=["']([^"']+)["']/g;
  for (const match of html.matchAll(refPattern)) {
    const ref = match[1].trim();
    if (!ref || ref.startsWith('#') || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('mailto:') || ref.startsWith('tel:')) continue;
    const withoutQuery = ref.split(/[?#]/, 1)[0];
    if (!withoutQuery) continue;
    let resolved = path.normalize(path.join(directory, withoutQuery));
    if (resolved.endsWith(path.sep) || withoutQuery.endsWith('/')) resolved = path.join(resolved, 'index.html');
    if (!exists(resolved)) fail(`参照先が存在しません: ${file} -> ${ref}`);
  }
}

const pageContracts = {
  'index.html': {
    required: ['search.html', 'all.html', 'assets/js/common.js'],
    forbidden: ['wasm-runtime.js', 'search-bridge.js', 'all-bridge.js', 'detail-bridge.js']
  },
  'search.html': {
    required: ['assets/js/common.js', 'assets/js/wasm-runtime.js', 'assets/js/search-bridge.js', 'all.html'],
    forbidden: ['all-bridge.js', 'detail-bridge.js']
  },
  'all.html': {
    required: ['assets/js/common.js', 'assets/js/wasm-runtime.js', 'assets/js/all-bridge.js', 'search.html'],
    forbidden: ['search-bridge.js', 'detail-bridge.js']
  },
  'detail.html': {
    required: ['assets/js/common.js', 'assets/js/wasm-runtime.js', 'assets/js/detail-bridge.js', 'search.html', 'all.html'],
    forbidden: ['all-bridge.js']
  }
};

for (const [file, contract] of Object.entries(pageContracts)) {
  if (!exists(file)) continue;
  const html = read(file);
  for (const needle of contract.required) {
    if (!html.includes(needle)) fail(`独立ページ必須参照がありません: ${file} -> ${needle}`);
  }
  for (const needle of contract.forbidden) {
    if (html.includes(needle)) fail(`別ページの処理を読み込んでいます: ${file} -> ${needle}`);
  }
}

for (const [file, ids] of Object.entries(requiredIds)) {
  if (!exists(file)) continue;
  const html = read(file);
  for (const id of ids) {
    if (!new RegExp(`id=["']${id}["']`).test(html)) fail(`必須IDがありません: ${file} #${id}`);
  }
}

for (const file of ['search.html', 'all.html']) {
  if (!exists(file)) continue;
  const html = read(file);
  for (const value of expectedSortValues) {
    if (!new RegExp(`<option\\s+value=["']${value}["']`).test(html)) fail(`共通ソート値がありません: ${file} value=${value}`);
  }
}

for (const file of jsFiles) {
  if (!exists(file)) continue;
  const js = read(file);
  const forbidden = [
    ['innerHTML', 'innerHTML を使用しています'],
    ['eval(', 'eval を使用しています'],
    ['new Function(', 'new Function を使用しています'],
    ['document.write(', 'document.write を使用しています']
  ];
  for (const [needle, label] of forbidden) {
    if (js.includes(needle)) fail(`${label}: ${file}`);
  }
}

if (exists('assets/js/common.js')) {
  const js = read('assets/js/common.js');
  if (!js.includes('detail.html')) fail('作品カードが独立 detail.html へ遷移する保証がありません');
  if (!js.includes("/^A\\d{8}$/")) fail('作品カード内部IDの形式検証がありません');
}

if (exists('assets/js/search-bridge.js')) {
  const js = read('assets/js/search-bridge.js');
  for (const [needle, label] of [
    ['TextDecoder(', 'search-bridge でCSV等のバイト列を文字列化している可能性があります'],
    ['split(",")', 'search-bridge でCSV解析を行っている可能性があります'],
    ["split(',')", 'search-bridge でCSV解析を行っている可能性があります']
  ]) {
    if (js.includes(needle)) fail(label);
  }
  for (const api of ['_anime_search_add_text_term', '_anime_search_add_date_range', '_anime_search_add_number_range']) {
    if (!js.includes(api)) fail(`検索WASM APIが接続されていません: ${api}`);
  }
  for (const column of searchableColumns) {
    if (!js.includes(`'${column}'`) && !js.includes(`"${column}"`)) fail(`詳細検索UIに共通CSV項目がありません: ${column}`);
  }
  for (const virtualDate of ['streaming_start', 'streaming_end', 'episode_air_date']) {
    if (!js.includes(`'${virtualDate}'`) && !js.includes(`"${virtualDate}"`)) fail(`構造化日付検索UIがありません: ${virtualDate}`);
  }
}

if (exists('assets/js/all-bridge.js')) {
  const js = read('assets/js/all-bridge.js');
  for (const [needle, label] of [
    ['TextDecoder(', 'all-bridge でCSV等のバイト列を文字列化している可能性があります'],
    ['split(",")', 'all-bridge でCSV解析を行っている可能性があります'],
    ["split(',')", 'all-bridge でCSV解析を行っている可能性があります']
  ]) {
    if (js.includes(needle)) fail(label);
  }
}

if (failures.length) {
  console.error('UI static validation: FAIL');
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('UI static validation: PASS');
console.log('checked physical pages: index.html / search.html / all.html / detail.html');
console.log('checked cross-page script isolation: PASS');
console.log('checked anime-card detail routing: PASS');
console.log('checked common sorts: 6');
console.log(`checked searchable CSV columns: ${searchableColumns.length}`);
