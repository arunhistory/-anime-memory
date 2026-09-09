import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const requiredFiles = [
  'index.html',
  'search/index.html',
  'all/index.html',
  'detail/index.html',
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

const htmlFiles = [
  'index.html',
  'search/index.html',
  'all/index.html',
  'detail/index.html'
];

const jsFiles = [
  'assets/js/common.js',
  'assets/js/wasm-runtime.js',
  'assets/js/search-bridge.js',
  'assets/js/all-bridge.js',
  'assets/js/detail-bridge.js'
];

const requiredIds = {
  'search/index.html': [
    'search-form',
    'search-query',
    'detail-toggle',
    'detail-filters',
    'active-filters',
    'clear-search-ui',
    'sort-key',
    'sort-direction',
    'search-ui-message',
    'results-title',
    'result-note',
    'results'
  ],
  'all/index.html': [
    'all-sort-key',
    'all-sort-direction',
    'all-status',
    'all-results'
  ],
  'detail/index.html': [
    'detail-status',
    'detail-id-badge',
    'detail-title',
    'detail-sub-title',
    'detail-synopsis',
    'detail-tags',
    'detail-sections'
  ]
};

const expectedSortValues = ['season', 'date', 'title', 'studio', 'episodes', 'runtime'];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

for (const file of requiredFiles) {
  if (!exists(file)) fail(`必須ファイルがありません: ${file}`);
}

for (const file of htmlFiles) {
  if (!exists(file)) continue;
  const html = read(file);

  if (!html.includes('<meta name="viewport"')) {
    fail(`viewport meta がありません: ${file}`);
  }

  if (/<script\s+[^>]*src=["']https?:\/\//i.test(html)) {
    fail(`外部scriptを直接読み込んでいます: ${file}`);
  }

  const directory = path.dirname(file);
  const refPattern = /(?:href|src)=["']([^"']+)["']/g;
  for (const match of html.matchAll(refPattern)) {
    const ref = match[1].trim();
    if (!ref || ref.startsWith('#') || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('mailto:') || ref.startsWith('tel:')) {
      continue;
    }

    const withoutQuery = ref.split(/[?#]/, 1)[0];
    if (!withoutQuery) continue;

    let resolved = path.normalize(path.join(directory, withoutQuery));
    if (resolved.endsWith(path.sep) || withoutQuery.endsWith('/')) {
      resolved = path.join(resolved, 'index.html');
    }

    if (!exists(resolved)) {
      fail(`参照先が存在しません: ${file} -> ${ref}`);
    }
  }
}

for (const file of ['search/index.html', 'all/index.html', 'detail/index.html']) {
  if (!exists(file)) continue;
  const html = read(file);
  if (!html.includes('assets/js/wasm-runtime.js')) {
    fail(`WASMランタイム参照がありません: ${file}`);
  }
}

for (const [file, ids] of Object.entries(requiredIds)) {
  if (!exists(file)) continue;
  const html = read(file);
  for (const id of ids) {
    const pattern = new RegExp(`id=["']${id}["']`);
    if (!pattern.test(html)) fail(`必須IDがありません: ${file} #${id}`);
  }
}

for (const file of ['search/index.html', 'all/index.html']) {
  if (!exists(file)) continue;
  const html = read(file);
  for (const value of expectedSortValues) {
    if (!new RegExp(`<option\\s+value=["']${value}["']`).test(html)) {
      fail(`共通ソート値がありません: ${file} value=${value}`);
    }
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

if (exists('assets/js/search-bridge.js')) {
  const js = read('assets/js/search-bridge.js');
  const forbiddenSearchResponsibilities = [
    ['TextDecoder(', 'search-bridge でCSV等のバイト列を文字列化している可能性があります'],
    ['split(",")', 'search-bridge でCSV解析を行っている可能性があります'],
    ["split(',')", 'search-bridge でCSV解析を行っている可能性があります']
  ];
  for (const [needle, label] of forbiddenSearchResponsibilities) {
    if (js.includes(needle)) fail(label);
  }
}

if (exists('assets/js/all-bridge.js')) {
  const js = read('assets/js/all-bridge.js');
  const forbiddenAllResponsibilities = [
    ['TextDecoder(', 'all-bridge でCSV等のバイト列を文字列化している可能性があります'],
    ['split(",")', 'all-bridge でCSV解析を行っている可能性があります'],
    ["split(',')", 'all-bridge でCSV解析を行っている可能性があります']
  ];
  for (const [needle, label] of forbiddenAllResponsibilities) {
    if (js.includes(needle)) fail(label);
  }
}

if (failures.length) {
  console.error('UI static validation: FAIL');
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('UI static validation: PASS');
console.log(`checked files: ${requiredFiles.length}`);
console.log('checked pages: TOP / SEARCH / ALL / DETAIL');
console.log('checked common sorts: 6');
