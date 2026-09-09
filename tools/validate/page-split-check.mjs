import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const expectedPages = ['index.html', 'search.html', 'all.html', 'detail.html'];
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => failures.push(message);

const rootHtml = fs.readdirSync(root)
  .filter((name) => name.endsWith('.html'))
  .sort();
const expectedSorted = [...expectedPages].sort();
if (JSON.stringify(rootHtml) !== JSON.stringify(expectedSorted)) {
  fail(`公開ルートHTMLは4ページだけである必要があります: actual=${rootHtml.join(', ')}`);
}

for (const file of expectedPages) {
  if (!exists(file)) fail(`独立ページがありません: ${file}`);
}
for (const oldPage of ['search/index.html', 'all/index.html', 'detail/index.html', 'top.html']) {
  if (exists(oldPage)) fail(`旧重複ページが公開領域に残っています: ${oldPage}`);
}

const contracts = {
  'index.html': {
    must: ['search.html', 'all.html', 'assets/js/common.js'],
    mustNot: ['wasm-runtime.js', 'search-bridge.js', 'all-bridge.js', 'detail-bridge.js']
  },
  'search.html': {
    must: ['index.html', 'all.html', 'assets/js/wasm-runtime.js', 'assets/js/search-bridge.js'],
    mustNot: ['all-bridge.js', 'detail-bridge.js']
  },
  'all.html': {
    must: ['index.html', 'search.html', 'assets/js/wasm-runtime.js', 'assets/js/all-bridge.js'],
    mustNot: ['search-bridge.js', 'detail-bridge.js']
  },
  'detail.html': {
    must: ['index.html', 'search.html', 'all.html', 'assets/js/wasm-runtime.js', 'assets/js/detail-bridge.js'],
    mustNot: ['all-bridge.js']
  }
};

for (const [file, contract] of Object.entries(contracts)) {
  if (!exists(file)) continue;
  const html = read(file);
  for (const needle of contract.must) {
    if (!html.includes(needle)) fail(`${file} に必要な独立導線/処理がありません: ${needle}`);
  }
  for (const needle of contract.mustNot) {
    if (html.includes(needle)) fail(`${file} が別ページ用処理を読み込んでいます: ${needle}`);
  }
}

const indexHtml = exists('index.html') ? read('index.html') : '';
if (!/action=["']\.\/search\.html["']/.test(indexHtml)) fail('TOP検索フォームが search.html へ遷移しません');
if (!/href=["']\.\/search\.html["']/.test(indexHtml)) fail('TOPから検索ページへの導線がありません');
if (!/href=["']\.\/all\.html["']/.test(indexHtml)) fail('TOPから全作品ページへの導線がありません');

const commonJs = exists('assets/js/common.js') ? read('assets/js/common.js') : '';
if (!commonJs.includes("new URL('detail.html'")) fail('作品カードの詳細遷移先が detail.html に固定されていません');
if (!commonJs.includes('/^A\\d{8}$/')) fail('作品カードの内部ID検証がありません');

if (failures.length) {
  console.error('Page split validation: FAIL');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('Page split validation: PASS');
console.log('public pages: index.html / search.html / all.html / detail.html');
console.log('TOP loads no WASM; SEARCH/ALL/DETAIL load only their assigned bridge');
console.log('anime cards route by internal ID to detail.html');
