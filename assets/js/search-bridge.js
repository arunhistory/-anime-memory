(() => {
  const bridgeUrl = document.currentScript?.src || window.location.href;
  const wasmModuleUrl = new URL('../wasm/search.js', bridgeUrl).href;
  const form = document.getElementById('search-form');
  const searchInput = document.getElementById('search-query');
  const toggle = document.getElementById('detail-toggle');
  const filters = document.getElementById('detail-filters');
  const activeFilters = document.getElementById('active-filters');
  const clearButton = document.getElementById('clear-search-ui');
  const sortKey = document.getElementById('sort-key');
  const sortDirection = document.getElementById('sort-direction');
  const message = document.getElementById('search-ui-message');
  const resultCount = document.getElementById('results-title');
  const resultNote = document.getElementById('result-note');
  const results = document.getElementById('results');
  const runtime = window.AnimeWasmRuntime;

  let wasm = null;
  let dataReady = false;
  let renderGeneration = 0;

  const initialQuery = new URLSearchParams(window.location.search).get('q');
  if (searchInput && initialQuery) searchInput.value = initialQuery;

  const setMessage = (type, text) => {
    if (!message) return;
    message.className = `ui-message ${type}`;
    message.textContent = text;
    message.hidden = !text;
  };

  const setResultMeta = (title, note = '') => {
    if (resultCount) resultCount.textContent = title;
    if (resultNote) resultNote.textContent = note;
  };

  const setBusy = (busy) => {
    if (results) results.setAttribute('aria-busy', String(Boolean(busy)));
  };

  const setEmpty = (title, note, icon = '⌕') => {
    window.AnimeUI?.setEmptyState(results, { icon, title, message: note });
  };

  const renderCards = (cards) => {
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

  const selectedOperator = () =>
    document.querySelector('.segmented button.selected')?.dataset.op || 'AND';

  const selectedCategories = () =>
    [...document.querySelectorAll('.filter-chip[aria-pressed="true"]')].map((button) => ({
      key: button.dataset.filter || '',
      label: button.textContent.trim()
    }));

  const getRequest = () => ({
    query: searchInput?.value || '',
    operator: selectedOperator(),
    categories: selectedCategories().map(({ key }) => key),
    sort: {
      key: sortKey?.value || 'season',
      direction: sortDirection?.dataset.dir || 'asc'
    }
  });

  const renderActiveFilters = () => {
    if (!activeFilters) return;
    activeFilters.replaceChildren();

    selectedCategories().forEach(({ key, label }) => {
      const pill = document.createElement('span');
      pill.className = 'active-filter';
      pill.textContent = label;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `${label}を外す`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        const target = document.querySelector(`.filter-chip[data-filter="${CSS.escape(key)}"]`);
        if (target) target.setAttribute('aria-pressed', 'false');
        renderActiveFilters();
      });

      pill.appendChild(remove);
      activeFilters.appendChild(pill);
    });
  };

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
    if (!wasm || !runtime) return '検索エンジンでエラーが発生しました。';
    return runtime.readCString(wasm, wasm._anime_search_last_error()) || '検索エンジンでエラーが発生しました。';
  };

  const addCsvBytes = (bytes) => runtime.withBytes(wasm, bytes, (pointer, size) => {
    if (wasm._anime_search_add_csv(pointer, size) !== 1) throw new Error(getEngineError());
  });

  const addTextTerm = (value, group, negated) => runtime.withCString(wasm, value, (valuePointer) =>
    runtime.withCString(wasm, group, (groupPointer) => {
      const ok = wasm._anime_search_add_text_term(valuePointer, groupPointer, 2, negated ? 1 : 0);
      if (ok !== 1) throw new Error(getEngineError());
    }));

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  const renderCurrentResults = async () => {
    if (!wasm || !dataReady) return;
    const generation = ++renderGeneration;
    const total = Number(wasm._anime_search_count());
    setBusy(true);

    if (total === 0) {
      setResultMeta('0作品', '条件に一致する作品はありません');
      setEmpty('見つかりませんでした', '条件を少し変えて、もう一度検索してみてください。');
      setBusy(false);
      return;
    }

    setResultMeta(`${total.toLocaleString()}作品`, '検索結果を順次表示しています');
    renderCards([]);

    const chunkSize = 100;
    for (let offset = 0; offset < total; offset += chunkSize) {
      if (generation !== renderGeneration) return;
      const pointer = wasm._anime_search_chunk_json(offset, chunkSize);
      const payload = JSON.parse(runtime.readCString(wasm, pointer));
      appendCards(payload.items || []);
      if (payload.hasMore) await nextFrame();
    }

    if (generation === renderGeneration) {
      setResultMeta(`${total.toLocaleString()}作品`, 'すべての検索結果を表示しました');
      setBusy(false);
    }
  };

  const executeSearch = async (request = getRequest()) => {
    const query = request.query.trim();
    window.dispatchEvent(new CustomEvent('anime-search-request', { detail: request }));

    if (!query) {
      setMessage('error', '検索語を入力してください。');
      setResultMeta('検索条件を入力してください', '検索結果はここに表示されます');
      setEmpty('探したい条件を入れてみよう', '自由検索でも、詳しい条件からでも検索できます。');
      return;
    }
    if (!wasm || !dataReady) {
      setMessage('info', '検索エンジンまたは作品データの準備が完了していません。');
      return;
    }

    setBusy(true);
    setMessage('info', '検索しています…');
    try {
      if (wasm._anime_search_clear_terms() !== 1) throw new Error(getEngineError());

      const groups = request.categories.length ? request.categories : ['all'];
      const isOr = request.operator === 'OR';
      const negated = request.operator === 'NOT';
      if (wasm._anime_search_set_combine_mode(isOr ? 1 : 0) !== 1) throw new Error(getEngineError());

      groups.forEach((group) => addTextTerm(query, group, negated));

      if (wasm._anime_search_execute() !== 1) throw new Error(getEngineError());
      if (wasm._anime_search_sort(sortCode(request.sort.key), directionCode(request.sort.direction)) !== 1) {
        throw new Error(getEngineError());
      }

      setMessage('', '');
      await renderCurrentResults();
    } catch (error) {
      setBusy(false);
      setMessage('error', error?.message || '検索中にエラーが発生しました。');
      setResultMeta('検索できませんでした', '入力内容または作品データを確認してください');
      setEmpty('検索できませんでした', '検索エンジンが処理を完了できませんでした。', '!');
    }
  };

  if (toggle && filters) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isOpen));
      filters.hidden = isOpen;
      const mark = toggle.querySelector('span');
      if (mark) mark.textContent = isOpen ? '＋' : '−';
    });
  }

  document.querySelectorAll('.segmented button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.segmented button').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
    });
  });

  document.querySelectorAll('.filter-chip').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!selected));
      renderActiveFilters();
    });
  });

  const applySort = async () => {
    const detail = {
      key: sortKey?.value || 'season',
      direction: sortDirection?.dataset.dir || 'asc'
    };
    window.dispatchEvent(new CustomEvent('anime-search-sort-change', { detail }));
    if (!wasm || !dataReady || Number(wasm._anime_search_count()) === 0) return;
    try {
      if (wasm._anime_search_sort(sortCode(detail.key), directionCode(detail.direction)) !== 1) {
        throw new Error(getEngineError());
      }
      await renderCurrentResults();
    } catch (error) {
      setMessage('error', error?.message || '並び替えに失敗しました。');
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

  if (clearButton) {
    clearButton.addEventListener('click', () => {
      renderGeneration += 1;
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('.filter-chip').forEach((button) => button.setAttribute('aria-pressed', 'false'));
      document.querySelectorAll('.segmented button').forEach((button, index) => {
        button.classList.toggle('selected', index === 0);
        button.setAttribute('aria-pressed', String(index === 0));
      });
      if (sortKey) sortKey.value = 'season';
      if (sortDirection) {
        sortDirection.dataset.dir = 'asc';
        sortDirection.textContent = '↑ 昇順';
      }
      renderActiveFilters();
      setMessage('info', '検索条件をクリアしました。');
      setResultMeta('検索条件を入力してください', '検索結果はここに表示されます');
      setEmpty('探したい条件を入れてみよう', '自由検索でも、詳しい条件からでも検索できます。');
      searchInput?.focus();
    });
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void executeSearch();
  });

  window.AnimeSearchUI = Object.freeze({
    getRequest,
    setMessage,
    setResultMeta,
    setBusy,
    setEmpty,
    renderCards,
    appendCards,
    executeSearch
  });

  const initialize = async () => {
    if (!runtime) {
      setMessage('error', 'WASM接続ランタイムを読み込めませんでした。');
      return;
    }
    setMessage('info', '検索エンジンを準備しています…');
    try {
      const imported = await import(wasmModuleUrl);
      wasm = await imported.default();
      if (wasm._anime_search_reset() !== 1) throw new Error(getEngineError());

      const fileCount = await runtime.feedCsvFiles((bytes) => addCsvBytes(bytes), { concurrency: 4 });
      if (wasm._anime_search_finalize() !== 1) throw new Error(getEngineError());
      dataReady = true;
      setMessage('success', `検索エンジン準備完了（CSV ${fileCount}ファイル）。`);

      if (searchInput?.value.trim()) await executeSearch();
    } catch (error) {
      dataReady = false;
      if (error?.code === 'DATA_NOT_CONNECTED') {
        setMessage('info', '検索エンジン本体は配置済みです。作品CSVの接続後に検索できます。');
        return;
      }
      setMessage('error', error?.message || '検索エンジンの読み込みに失敗しました。');
    }
  };

  void initialize();

  // JSはHTTP取得・WASMへの生バイト転送・UI入力転送・DOM描画だけを担当する。
  // 作品CSVの解析、正規化、検索一致判定、範囲判定、検索結果ソートはsearch.wasm側で行う。
})();
