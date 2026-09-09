(() => {
  const bridgeUrl = document.currentScript?.src || window.location.href;
  const wasmModuleUrl = new URL('../wasm/search.js', bridgeUrl).href;
  const form = document.getElementById('search-form');
  const searchInput = document.getElementById('search-query');
  const toggle = document.getElementById('detail-toggle');
  const filters = document.getElementById('detail-filters');
  const activeFilters = document.getElementById('active-filters');
  const clearButton = document.getElementById('clear-search-ui');
  const addTextFilterButton = document.getElementById('add-text-filter');
  const addDateFilterButton = document.getElementById('add-date-filter');
  const addNumberFilterButton = document.getElementById('add-number-filter');
  const textFilterRows = document.getElementById('text-filter-rows');
  const dateFilterRows = document.getElementById('date-filter-rows');
  const numberFilterRows = document.getElementById('number-filter-rows');
  const sortKey = document.getElementById('sort-key');
  const sortDirection = document.getElementById('sort-direction');
  const message = document.getElementById('search-ui-message');
  const resultCount = document.getElementById('results-title');
  const resultNote = document.getElementById('result-note');
  const results = document.getElementById('results');
  const runtime = window.AnimeWasmRuntime;

  const TEXT_TARGETS = [
    ['all', '全保存項目'],
    ['title', 'タイトル・読み・別名'],
    ['media', '媒体種別'],
    ['genre', '分類・ジャンル・タグ・テーマ'],
    ['original', '原作情報'],
    ['studio', 'アニメーション制作'],
    ['production', '製作・委員会・企画・プロデューサー'],
    ['staff', 'スタッフ'],
    ['cast', 'キャラクター・声優'],
    ['music', 'OP・ED・挿入歌・音楽'],
    ['broadcast', '放送局・放送枠'],
    ['streaming', '配信サービス・配信形態'],
    ['theater', '劇場・配給'],
    ['relations', 'シリーズ・関連作品'],
    ['episodes', 'エピソード・各話スタッフ'],
    ['awards', '受賞歴'],
    ['synopsis', '概要'],
    ['official', '公式サイト・公式SNS'],
    ['external', '外部ID']
  ];

  const MATCH_MODES = [
    ['contains', '部分一致'],
    ['prefix', '前方一致'],
    ['exact', '完全一致']
  ];

  const DATE_TARGETS = [
    ['release_start', '開始日'],
    ['release_end', '終了日'],
    ['theatrical_release_date', '劇場公開日'],
    ['updated_at', '更新日']
  ];

  const NUMBER_TARGETS = [
    ['episode_count', '話数'],
    ['runtime_min', '1話・作品時間（分）'],
    ['season_number', 'シーズン番号']
  ];

  let wasm = null;
  let dataReady = false;
  let renderGeneration = 0;

  const initialQuery = new URLSearchParams(window.location.search).get('q');
  if (searchInput && initialQuery) searchInput.value = initialQuery;

  const setMessage = (type, text) => {
    if (!message) return;
    message.className = `ui-message ${type || 'info'}`;
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

  const makeSelect = (options, className, label) => {
    const select = document.createElement('select');
    if (className) select.className = className;
    select.setAttribute('aria-label', label);
    options.forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    });
    return select;
  };

  const makeNotToggle = () => {
    const label = document.createElement('label');
    label.className = 'not-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'filter-negated';
    const text = document.createElement('span');
    text.textContent = '含めない（NOT）';
    label.append(input, text);
    return label;
  };

  const makeRemoveButton = (row) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remove-filter';
    button.setAttribute('aria-label', 'この条件を削除');
    button.textContent = '×';
    button.addEventListener('click', () => {
      row.remove();
      renderActiveFilters();
    });
    return button;
  };

  const bindRowChange = (row) => {
    row.addEventListener('input', renderActiveFilters);
    row.addEventListener('change', renderActiveFilters);
  };

  const addTextFilterRow = (preset = {}) => {
    if (!textFilterRows) return null;
    const row = document.createElement('div');
    row.className = 'filter-row text-filter-row';

    const target = makeSelect(TEXT_TARGETS, 'filter-target', '検索対象');
    target.value = TEXT_TARGETS.some(([value]) => value === preset.group) ? preset.group : 'title';

    const value = document.createElement('input');
    value.className = 'filter-value';
    value.type = 'search';
    value.autocomplete = 'off';
    value.placeholder = '検索する語句';
    value.setAttribute('aria-label', '検索する語句');
    value.value = preset.value || '';

    const match = makeSelect(MATCH_MODES, 'filter-match', '一致方法');
    match.value = MATCH_MODES.some(([mode]) => mode === preset.match) ? preset.match : 'contains';

    const notToggle = makeNotToggle();
    notToggle.querySelector('input').checked = Boolean(preset.negated);

    row.append(target, value, match, notToggle, makeRemoveButton(row));
    bindRowChange(row);
    textFilterRows.appendChild(row);
    value.focus();
    renderActiveFilters();
    return row;
  };

  const addRangeFilterRow = (container, targets, kind, preset = {}) => {
    if (!container) return null;
    const row = document.createElement('div');
    row.className = `filter-row range-row ${kind}-filter-row`;

    const target = makeSelect(targets, 'filter-target', kind === 'date' ? '日付項目' : '数値項目');
    target.value = targets.some(([value]) => value === preset.column) ? preset.column : targets[0][0];

    const minimum = document.createElement('input');
    minimum.className = 'range-min';
    minimum.type = 'text';
    minimum.inputMode = kind === 'number' ? 'decimal' : 'numeric';
    minimum.placeholder = kind === 'number' ? '下限' : '開始（YYYY-MM-DD）';
    minimum.setAttribute('aria-label', kind === 'number' ? '下限' : '範囲開始日');
    minimum.value = preset.minimum || '';

    const separator = document.createElement('span');
    separator.className = 'range-separator';
    separator.textContent = '〜';

    const maximum = document.createElement('input');
    maximum.className = 'range-max';
    maximum.type = 'text';
    maximum.inputMode = kind === 'number' ? 'decimal' : 'numeric';
    maximum.placeholder = kind === 'number' ? '上限' : '終了（YYYY-MM-DD）';
    maximum.setAttribute('aria-label', kind === 'number' ? '上限' : '範囲終了日');
    maximum.value = preset.maximum || '';

    const notToggle = makeNotToggle();
    notToggle.querySelector('input').checked = Boolean(preset.negated);

    row.append(target, minimum, separator, maximum, notToggle, makeRemoveButton(row));
    bindRowChange(row);
    container.appendChild(row);
    minimum.focus();
    renderActiveFilters();
    return row;
  };

  const selectedOperator = () =>
    document.querySelector('.segmented button.selected')?.dataset.op || 'AND';

  const collectTextTerms = () => [...document.querySelectorAll('.text-filter-row')]
    .map((row) => ({
      group: row.querySelector('.filter-target')?.value || 'all',
      value: row.querySelector('.filter-value')?.value.trim() || '',
      match: row.querySelector('.filter-match')?.value || 'contains',
      negated: Boolean(row.querySelector('.filter-negated')?.checked)
    }))
    .filter((term) => term.value);

  const collectRanges = (selector) => [...document.querySelectorAll(selector)]
    .map((row) => ({
      column: row.querySelector('.filter-target')?.value || '',
      minimum: row.querySelector('.range-min')?.value.trim() || '',
      maximum: row.querySelector('.range-max')?.value.trim() || '',
      negated: Boolean(row.querySelector('.filter-negated')?.checked)
    }))
    .filter((range) => range.column && (range.minimum || range.maximum));

  const getRequest = () => ({
    query: searchInput?.value.trim() || '',
    operator: selectedOperator(),
    textTerms: collectTextTerms(),
    dateRanges: collectRanges('.date-filter-row'),
    numberRanges: collectRanges('.number-filter-row'),
    sort: {
      key: sortKey?.value || 'season',
      direction: sortDirection?.dataset.dir || 'asc'
    }
  });

  const labelFor = (options, value) => options.find(([key]) => key === value)?.[1] || value;

  const renderActiveFilters = () => {
    if (!activeFilters) return;
    activeFilters.replaceChildren();
    const request = getRequest();

    request.textTerms.forEach((term) => {
      const pill = document.createElement('span');
      pill.className = 'active-filter';
      const mode = labelFor(MATCH_MODES, term.match);
      pill.textContent = `${term.negated ? '除外：' : ''}${labelFor(TEXT_TARGETS, term.group)}「${term.value}」 ${mode}`;
      activeFilters.appendChild(pill);
    });

    request.dateRanges.forEach((range) => {
      const pill = document.createElement('span');
      pill.className = 'active-filter';
      pill.textContent = `${range.negated ? '除外：' : ''}${labelFor(DATE_TARGETS, range.column)} ${range.minimum || '指定なし'}〜${range.maximum || '指定なし'}`;
      activeFilters.appendChild(pill);
    });

    request.numberRanges.forEach((range) => {
      const pill = document.createElement('span');
      pill.className = 'active-filter';
      pill.textContent = `${range.negated ? '除外：' : ''}${labelFor(NUMBER_TARGETS, range.column)} ${range.minimum || '指定なし'}〜${range.maximum || '指定なし'}`;
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
  const matchCode = (mode) => ({ exact: 0, prefix: 1, contains: 2 }[mode] ?? 2);

  const getEngineError = () => {
    if (!wasm || !runtime) return '検索エンジンでエラーが発生しました。';
    return runtime.readCString(wasm, wasm._anime_search_last_error()) || '検索エンジンでエラーが発生しました。';
  };

  const addCsvBytes = (bytes) => runtime.withBytes(wasm, bytes, (pointer, size) => {
    if (wasm._anime_search_add_csv(pointer, size) !== 1) throw new Error(getEngineError());
  });

  const addTextTerm = (value, group, matchMode, negated) => runtime.withCString(wasm, value, (valuePointer) =>
    runtime.withCString(wasm, group, (groupPointer) => {
      const ok = wasm._anime_search_add_text_term(valuePointer, groupPointer, matchCode(matchMode), negated ? 1 : 0);
      if (ok !== 1) throw new Error(getEngineError());
    }));

  const addRangeTerm = (kind, range) => runtime.withCString(wasm, range.column, (columnPointer) =>
    runtime.withCString(wasm, range.minimum, (minimumPointer) =>
      runtime.withCString(wasm, range.maximum, (maximumPointer) => {
        const fn = kind === 'date' ? wasm._anime_search_add_date_range : wasm._anime_search_add_number_range;
        const ok = fn(columnPointer, minimumPointer, maximumPointer, range.negated ? 1 : 0);
        if (ok !== 1) throw new Error(getEngineError());
      })));

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
    window.dispatchEvent(new CustomEvent('anime-search-request', { detail: request }));

    const hasAnyCondition = Boolean(
      request.query || request.textTerms.length || request.dateRanges.length || request.numberRanges.length
    );
    if (!hasAnyCondition) {
      setMessage('error', '検索語または詳しい条件を1つ以上指定してください。');
      setResultMeta('検索条件を入力してください', '検索結果はここに表示されます');
      setEmpty('探したい条件を入れてみよう', '自由検索でも、詳しい条件だけでも検索できます。');
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
      if (wasm._anime_search_set_combine_mode(request.operator === 'OR' ? 1 : 0) !== 1) throw new Error(getEngineError());

      if (request.query) addTextTerm(request.query, 'all', 'contains', false);
      request.textTerms.forEach((term) => addTextTerm(term.value, term.group, term.match, term.negated));
      request.dateRanges.forEach((range) => addRangeTerm('date', range));
      request.numberRanges.forEach((range) => addRangeTerm('number', range));

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
      renderActiveFilters();
    });
  });

  addTextFilterButton?.addEventListener('click', () => addTextFilterRow());
  addDateFilterButton?.addEventListener('click', () => addRangeFilterRow(dateFilterRows, DATE_TARGETS, 'date'));
  addNumberFilterButton?.addEventListener('click', () => addRangeFilterRow(numberFilterRows, NUMBER_TARGETS, 'number'));

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
      textFilterRows?.replaceChildren();
      dateFilterRows?.replaceChildren();
      numberFilterRows?.replaceChildren();
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
      setEmpty('探したい条件を入れてみよう', '自由検索でも、詳しい条件だけでも検索できます。');
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
    executeSearch,
    addTextFilterRow,
    addDateFilterRow: (preset) => addRangeFilterRow(dateFilterRows, DATE_TARGETS, 'date', preset),
    addNumberFilterRow: (preset) => addRangeFilterRow(numberFilterRows, NUMBER_TARGETS, 'number', preset)
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
  // CSV解析・正規化・検索一致判定・AND/OR/NOT・範囲判定・検索結果ソートはsearch.wasm側で行う。
})();
