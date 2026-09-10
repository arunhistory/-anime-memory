import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listDataCsvFiles } from '../csv/csv.mjs';

const encoder = new TextEncoder();

function readWasmError(module) {
  if (!module?._anime_search_last_error || !module?.UTF8ToString) return 'unknown search.wasm error';
  const pointer = module._anime_search_last_error();
  return pointer ? module.UTF8ToString(pointer) : 'unknown search.wasm error';
}

function requireSuccess(module, result, operation) {
  if (result) return;
  throw new Error(`${operation} failed: ${readWasmError(module)}`);
}

function withBytes(module, bytes, callback) {
  if (!module?._malloc || !module?._free || !module?.HEAPU8) throw new Error('search.wasm memory API is unavailable.');
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pointer = module._malloc(Math.max(1, view.byteLength));
  if (!pointer) throw new Error('search.wasm memory allocation failed.');
  try {
    if (view.byteLength) module.HEAPU8.set(view, pointer);
    return callback(pointer, view.byteLength);
  } finally {
    module._free(pointer);
  }
}

function withCString(module, value, callback) {
  const bytes = encoder.encode(`${String(value ?? '')}\0`);
  return withBytes(module, bytes, (pointer) => callback(pointer));
}

function parseChunk(module, pointer) {
  if (!pointer) return { items: [], total: 0 };
  const text = module.UTF8ToString(pointer);
  if (!text) return { items: [], total: 0 };
  const parsed = JSON.parse(text);
  return {
    items: Array.isArray(parsed?.items) ? parsed.items : [],
    total: Number(parsed?.total || 0)
  };
}

export class KnownWorkWasmSearch {
  constructor(module, files) {
    this.module = module;
    this.files = [...files];
  }

  get available() {
    return Boolean(this.module && this.files.length);
  }

  get fileCount() {
    return this.files.length;
  }

  findExactTitle(title, limit = 20) {
    const value = String(title || '').trim();
    if (!this.available || !value) return [];
    const module = this.module;
    requireSuccess(module, module._anime_search_clear_terms(), 'anime_search_clear_terms');
    requireSuccess(module, module._anime_search_set_combine_mode(0), 'anime_search_set_combine_mode');
    withCString(module, value, (valuePointer) => {
      withCString(module, 'title', (selectorPointer) => {
        requireSuccess(
          module,
          module._anime_search_add_text_term(valuePointer, selectorPointer, 0, 0),
          'anime_search_add_text_term(title exact)'
        );
      });
    });
    requireSuccess(module, module._anime_search_execute(), 'anime_search_execute');
    const count = Number(module._anime_search_count() || 0);
    if (count <= 0) return [];
    const chunk = parseChunk(module, module._anime_search_chunk_json(0, Math.min(Math.max(1, Number(limit) || 20), 100)));
    return chunk.items;
  }

  hasExactTitle(title) {
    return this.findExactTitle(title, 1).length > 0;
  }

  getRecordById(id) {
    const value = String(id || '').trim();
    if (!this.available || !/^A\d{8}$/.test(value)) return null;
    const module = this.module;
    if (!module?._anime_search_record_json_by_id) throw new Error('search.wasm record lookup API is unavailable.');
    return withCString(module, value, (pointer) => {
      const resultPointer = module._anime_search_record_json_by_id(pointer);
      if (!resultPointer) return null;
      const text = module.UTF8ToString(resultPointer);
      if (!text || text === 'null') return null;
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    });
  }

  findUniqueExactRecord(title) {
    const matches = this.findExactTitle(title, 3);
    const ids = [...new Set(matches.map((item) => String(item?.id || '')).filter((id) => /^A\d{8}$/.test(id)))];
    if (ids.length !== 1) return null;
    return this.getRecordById(ids[0]);
  }
}

export async function loadKnownWorkWasmSearch(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const dataDir = path.resolve(options.dataDir || path.join(root, 'data'));
  const files = listDataCsvFiles(dataDir);
  if (!files.length) return new KnownWorkWasmSearch(null, []);

  const searchJs = path.join(root, 'assets', 'wasm', 'search.js');
  const searchWasm = path.join(root, 'assets', 'wasm', 'search.wasm');
  if (!fs.existsSync(searchJs) || !fs.existsSync(searchWasm)) {
    throw new Error('Registered-work lookup requires assets/wasm/search.js and search.wasm.');
  }

  const moduleUrl = `${pathToFileURL(searchJs).href}?known-work=${fs.statSync(searchJs).mtimeMs}`;
  const imported = await import(moduleUrl);
  if (typeof imported.default !== 'function') throw new Error('assets/wasm/search.js does not export the expected module factory.');

  const module = await imported.default({ wasmBinary: fs.readFileSync(searchWasm) });
  requireSuccess(module, module._anime_search_reset(), 'anime_search_reset');
  for (const fileName of files) {
    const bytes = fs.readFileSync(path.join(dataDir, fileName));
    withBytes(module, bytes, (pointer, size) => {
      requireSuccess(module, module._anime_search_add_csv(pointer, size), `anime_search_add_csv(${fileName})`);
    });
  }
  requireSuccess(module, module._anime_search_finalize(), 'anime_search_finalize');
  return new KnownWorkWasmSearch(module, files);
}
