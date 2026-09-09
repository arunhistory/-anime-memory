(() => {
  const scriptUrl = document.currentScript?.src || window.location.href;
  const dataRootUrl = new URL('../../data/', scriptUrl);
  const manifestUrl = new URL('manifest.csv', dataRootUrl);
  const encoder = new TextEncoder();
  const allowedDataFile = /^(?:initial-\d{3}|\d{4}-Q[1-4])\.csv$/;

  class AnimeDataError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'AnimeDataError';
      this.code = code;
    }
  }

  const parseSingleColumnManifest = (text) => {
    const values = [];
    let value = '';
    let quoted = false;
    let quoteClosed = false;

    const finish = () => {
      const item = value.trim().replace(/^\uFEFF/, '');
      if (item) values.push(item);
      value = '';
      quoteClosed = false;
    };

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            value += '"';
            index += 1;
          } else {
            quoted = false;
            quoteClosed = true;
          }
        } else {
          value += char;
        }
        continue;
      }

      if (quoteClosed) {
        if (char === '\r') {
          if (text[index + 1] === '\n') index += 1;
          finish();
          continue;
        }
        if (char === '\n') {
          finish();
          continue;
        }
        throw new AnimeDataError('MANIFEST_INVALID', 'manifest.csv の引用符後に不正な文字があります。');
      }

      if (char === '"' && value.length === 0) {
        quoted = true;
        continue;
      }
      if (char === ',') {
        throw new AnimeDataError('MANIFEST_INVALID', 'manifest.csv はファイル名1列のみである必要があります。');
      }
      if (char === '\r') {
        if (text[index + 1] === '\n') index += 1;
        finish();
        continue;
      }
      if (char === '\n') {
        finish();
        continue;
      }
      value += char;
    }

    if (quoted) throw new AnimeDataError('MANIFEST_INVALID', 'manifest.csv の引用符が閉じていません。');
    if (value.length || quoteClosed) finish();

    const files = [];
    const seen = new Set();
    for (const item of values) {
      if (!allowedDataFile.test(item)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      files.push(item);
    }
    return files;
  };

  const getManifestFiles = async () => {
    let response;
    try {
      response = await fetch(manifestUrl, { credentials: 'same-origin', cache: 'default' });
    } catch (error) {
      throw new AnimeDataError('MANIFEST_FETCH_FAILED', `manifest.csv を取得できませんでした: ${error?.message || error}`);
    }

    if (response.status === 404) {
      throw new AnimeDataError('DATA_NOT_CONNECTED', '作品データはまだ接続されていません。');
    }
    if (!response.ok) {
      throw new AnimeDataError('MANIFEST_FETCH_FAILED', `manifest.csv の取得に失敗しました (${response.status})。`);
    }

    const files = parseSingleColumnManifest(await response.text());
    if (!files.length) {
      throw new AnimeDataError('DATA_NOT_CONNECTED', 'manifest.csv に作品CSVが登録されていません。');
    }
    return files;
  };

  const feedCsvFiles = async (onBytes, options = {}) => {
    if (typeof onBytes !== 'function') throw new TypeError('onBytes callback is required.');
    const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 4));
    const files = await getManifestFiles();

    for (let start = 0; start < files.length; start += concurrency) {
      const batch = files.slice(start, start + concurrency);
      const loaded = await Promise.all(batch.map(async (fileName) => {
        const url = new URL(fileName, dataRootUrl);
        let response;
        try {
          response = await fetch(url, { credentials: 'same-origin', cache: 'default' });
        } catch (error) {
          throw new AnimeDataError('CSV_FETCH_FAILED', `${fileName} を取得できませんでした: ${error?.message || error}`);
        }
        if (!response.ok) {
          throw new AnimeDataError('CSV_FETCH_FAILED', `${fileName} の取得に失敗しました (${response.status})。`);
        }
        return { fileName, bytes: new Uint8Array(await response.arrayBuffer()) };
      }));

      for (const item of loaded) {
        await onBytes(item.bytes, item.fileName);
      }
    }

    return files.length;
  };

  const withBytes = (module, bytes, callback) => {
    if (!module?._malloc || !module?._free || !module?.HEAPU8) throw new Error('WASM memory API is not ready.');
    const size = bytes.byteLength;
    const pointer = module._malloc(Math.max(1, size));
    if (!pointer) throw new Error('WASM memory allocation failed.');
    try {
      if (size) module.HEAPU8.set(bytes, pointer);
      return callback(pointer, size);
    } finally {
      module._free(pointer);
    }
  };

  const withCString = (module, value, callback) => {
    const bytes = encoder.encode(`${value ?? ''}\0`);
    return withBytes(module, bytes, (pointer) => callback(pointer));
  };

  const readCString = (module, pointer) => pointer ? module.UTF8ToString(pointer) : '';

  window.AnimeWasmRuntime = Object.freeze({
    AnimeDataError,
    feedCsvFiles,
    withBytes,
    withCString,
    readCString,
    manifestUrl: manifestUrl.href
  });
})();
