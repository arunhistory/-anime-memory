(() => {
  const sortKey = document.getElementById('all-sort-key');
  const sortDirection = document.getElementById('all-sort-direction');
  const status = document.getElementById('all-status');
  const results = document.getElementById('all-results');

  const setStatus = (state, title, note = '') => {
    if (!status) return;
    status.className = `status-banner ${state}`;

    const icon = status.querySelector('.status-icon');
    const strong = status.querySelector('strong');
    const small = status.querySelector('small');

    if (icon) {
      icon.textContent = state === 'done' ? '✓' : state === 'error' ? '!' : state === 'loading' ? '' : '○';
    }
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

  const emitSortRequest = () => {
    window.dispatchEvent(new CustomEvent('anime-all-sort-request', {
      detail: getSortRequest()
    }));
  };

  if (sortDirection) {
    sortDirection.addEventListener('click', () => {
      const current = sortDirection.dataset.dir === 'desc' ? 'desc' : 'asc';
      const next = current === 'asc' ? 'desc' : 'asc';
      sortDirection.dataset.dir = next;
      sortDirection.textContent = next === 'asc' ? '↑ 昇順' : '↓ 降順';
      emitSortRequest();
    });
  }

  sortKey?.addEventListener('change', emitSortRequest);

  window.AnimeAllUI = Object.freeze({
    setStatus,
    setBusy,
    setEmpty,
    replaceCards,
    appendCards,
    getSortRequest
  });

  // このファイルはCSVバイト列の受け渡し、WASMへの要求、DOM描画の状態管理だけを担当する。
  // 全CSV読込、レコード解析、全件抽出、ソート計算はall.wasm側で処理する。
})();
