(() => {
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

  const initialQuery = new URLSearchParams(window.location.search).get('q');
  if (searchInput && initialQuery) searchInput.value = initialQuery;

  const setMessage = (type, text) => {
    if (!message) return;
    message.className = `ui-message ${type}`;
    message.textContent = text;
    message.hidden = !text;
  };

  const selectedOperator = () =>
    document.querySelector('.segmented button.selected')?.dataset.op || 'AND';

  const selectedCategories = () =>
    [...document.querySelectorAll('.filter-chip[aria-pressed="true"]')].map((button) => ({
      key: button.dataset.filter || '',
      label: button.textContent.trim()
    }));

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

  if (sortDirection) {
    sortDirection.addEventListener('click', () => {
      const current = sortDirection.dataset.dir === 'desc' ? 'desc' : 'asc';
      const next = current === 'asc' ? 'desc' : 'asc';
      sortDirection.dataset.dir = next;
      sortDirection.textContent = next === 'asc' ? '↑ 昇順' : '↓ 降順';

      window.dispatchEvent(new CustomEvent('anime-search-sort-change', {
        detail: {
          key: sortKey?.value || 'season',
          direction: next
        }
      }));
    });
  }

  if (sortKey) {
    sortKey.addEventListener('change', () => {
      window.dispatchEvent(new CustomEvent('anime-search-sort-change', {
        detail: {
          key: sortKey.value,
          direction: sortDirection?.dataset.dir || 'asc'
        }
      }));
    });
  }

  if (clearButton) {
    clearButton.addEventListener('click', () => {
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
      searchInput?.focus();
    });
  }

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const request = {
        query: searchInput?.value || '',
        operator: selectedOperator(),
        categories: selectedCategories().map(({ key }) => key),
        sort: {
          key: sortKey?.value || 'season',
          direction: sortDirection?.dataset.dir || 'asc'
        }
      };

      window.dispatchEvent(new CustomEvent('anime-search-request', { detail: request }));
      setMessage('info', '検索UIは準備済みです。検索データと search.wasm の接続後、この入力をそのまま検索処理へ渡します。');
      if (resultCount) resultCount.textContent = '検索エンジン接続待ち';
      if (resultNote) resultNote.textContent = '画面と入力経路は動作しています';
      if (results) results.setAttribute('aria-busy', 'false');
    });
  }

  // このファイルはUI入力の収集・WASMへの受け渡し・DOM描画だけを担当する。
  // CSV解析、正規化、検索一致判定、AND/OR/NOTの意味解釈、範囲判定、ソート処理は行わない。
})();
