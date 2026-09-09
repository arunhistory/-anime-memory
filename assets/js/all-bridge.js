(() => {
  const bridgeUrl = document.currentScript?.src || window.location.href;
  const wasmModuleUrl = new URL('../wasm/all.js', bridgeUrl).href;
  const sortKey = document.getElementById('all-sort-key');
  const sortDirection = document.getElementById('all-sort-direction');
  const status = document.getElementById('all-status');
  const results = document.getElementById('all-results');
  const runtime = window.AnimeWasmRuntime;

  let wasm = null;
  let dataReady = false;
  let renderGeneration = 0;

  const setStatus = (state, title, note = '') => {
    if (!status) return;
    status.className = `status-banner ${state}`;

    const icon = status.querySelector('.status-icon');
    const strong = status.querySelector('strong');
    const small = status.querySelector('small');

    if (icon) icon.textContent = state === 'done' ? '✓' : state === 'error' ? '!' : state === 'loading' ? '' : '○';
    if (strong) strong.textContent = title;
    if (small) small.textContent = note;
  };

  const setBusy = (busy) => {
    if (results) results.setAttribute('aria-busy', String(Boolean(busy)));
  };

  const setEmpty = (title, note, icon = '▦') => {
    window.AnimeUI?.setEmptyState(results, { icon, title, message: note });
  };

  const replaceCards = (cards) => {
    if (!results || !window.AnimeUI || !Array.isArray(cards)) return;
    window.AnimeUI.clearNode(results);
    appendCards(cards);
  };

  const appendCards = (cards) => {
    if (!results || !window.AnimeUI || !Array.isArray(cards)) return;
    const fragment = document.createDocumentFragment();
    cards.forEach((card) => fragment.appendChild(window.AnimeUI.createAnimeCard(card)));
    results.appendChild(fragment);
  };

  const getSortRequest = () => ({
    key: sortKey?.value || 'season',
    direction: sortDirection?.dataset.dir || 'asc'
  });

  const sortCode = (key) => ({
    season: 0,
    date: 1,
    title: 2,
    studio: 3,
    episodes: 4,
    runtime: 5
  }[key] ?? 0);

  const directionCode = (direction) => direction === 'desc' ? 1 : 0;

  const getEngineError = () => {
    if (!wasm || !runtime) return '全件表示エンジンでエラーが発生しました。';
    return runtime.readCString(wasm, wasm._anime_all_last_error()) || '全件表示エンジンでエラーが発生しました。';
  };

  const addCsvBytes = (bytes) => runtime.withBytes(wasm, bytes, (pointer, size) => {
    if (wasm._anime_all_add_csv(pointer, size) !== 1) throw new Error(getEngineError());
  });

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  const renderAll = async () => {
    if (!wasm || !dataReady) return;
    const generation = ++renderGeneration;
    const total = Number(wasm._anime_all_count());
    setBusy(true);

    if (total === 0) {
      replaceCards([]);
      setEmpty('登録作品がありません', '作品CSVが追加されると、ここへ全作品が表示されます。');
      setStatus('done', '0作品', '表示対象の作品はありません');
      setBusy(false);
      return;
    }

    replaceCards([]);
    setStatus('loading', `${total.toLocaleString()}作品を表示中`, '同一ページへ一定件数ずつ追加しています');

    const chunkSize = 100;
    for (let offset = 0; offset < total; offset += chunkSize) {
      if (generation !== renderGeneration) return;
      const pointer = wasm._anime_all_chunk_json(offset, chunkSize);
      const payload = JSON.parse(runtime.readCString(wasm, pointer));
      appendCards(payload.items || []);
      if (payload.hasMore) await nextFrame();
    }

    if (generation === renderGeneration) {
      setStatus('done', `${total.toLocaleString()}作品を表示しました`, 'すべて同じページ内に表示しています');
      setBusy(false);
    }
  };

  const applySort = async () => {
    const detail = getSortRequest();
    window.dispatchEvent(new CustomEvent('anime-all-sort-request', { detail }));
    if (!wasm || !dataReady) return;

    try {
      if (wasm._anime_all_sort(sortCode(detail.key), directionCode(detail.direction)) !== 1) {
        throw new Error(getEngineError());
      }
      await renderAll();
    } catch (error) {
      setBusy(false);
      setStatus('error', '並び替えできませんでした', error?.message || '全件表示エンジンでエラーが発生しました');
    }
  };

  if (sortDirection) {
    sortDirection.addEventListener('click', () => {
      const current = sortDirection.dataset.dir === 'desc' ? 'desc' : 'asc';
      const next = current === 'asc' ? 'desc' : 'asc';
      sortDirection.dataset.dir = next;
      sortDirection.textContent = next === 'asc' ? '↑ 昇順' : '↓ 降順';
      void applySort();
    });
  }

  sortKey?.addEventListener('change', () => void applySort());

  window.AnimeAllUI = Object.freeze({
    setStatus,
    setBusy,
    setEmpty,
    replaceCards,
    appendCards,
    getSortRequest,
    renderAll
  });

  const initialize = async () => {
    if (!runtime) {
      setStatus('error', 'WASM接続ランタイムを読み込めませんでした', 'ページを再読み込みしてください');
      return;
    }

    setStatus('loading', '全件表示エンジンを準備しています', 'all.wasm を読み込んでいます');
    try {
      const imported = await import(wasmModuleUrl);
      wasm = await imported.default();
      if (wasm._anime_all_reset() !== 1) throw new Error(getEngineError());

      const fileCount = await runtime.feedCsvFiles((bytes) => addCsvBytes(bytes), { concurrency: 4 });
      if (wasm._anime_all_finalize() !== 1) throw new Error(getEngineError());
      dataReady = true;

      const currentSort = getSortRequest();
      if (wasm._anime_all_sort(sortCode(currentSort.key), directionCode(currentSort.direction)) !== 1) {
        throw new Error(getEngineError());
      }

      setStatus('loading', '作品データを読み込みました', `CSV ${fileCount}ファイルを all.wasm に読み込み済み`);
      await renderAll();
    } catch (error) {
      dataReady = false;
      setBusy(false);
      if (error?.code === 'DATA_NOT_CONNECTED') {
        setStatus('idle', '全件表示エンジン本体は配置済み', '作品CSVの接続後、自動で全作品を表示します');
        setEmpty('ここに全作品が並びます', '作品データはまだ接続されていません。');
        return;
      }
      setStatus('error', '全件表示を開始できませんでした', error?.message || 'all.wasm または作品CSVの読み込みに失敗しました');
      setEmpty('読み込めませんでした', 'ページを再読み込みしても解消しない場合は、作品データまたはWASMを確認してください。', '!');
    }
  };

  void initialize();

  // JSはHTTP取得・WASMへの生バイト転送・DOM描画だけを担当する。
  // 全CSVの作品レコード解析、全件抽出、6ソートはall.wasm側で行う。
})();
