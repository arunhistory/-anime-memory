(() => {
  const toggle = document.getElementById('detail-toggle');
  const filters = document.getElementById('detail-filters');
  if (toggle && filters) toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    filters.hidden = open;
    toggle.firstElementChild.textContent = open ? '＋' : '−';
  });

  document.querySelectorAll('.segmented button').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.segmented button').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  }));

  const dir = document.getElementById('sort-direction');
  if (dir) dir.addEventListener('click', () => {
    const asc = dir.dataset.dir !== 'desc';
    dir.dataset.dir = asc ? 'desc' : 'asc';
    dir.textContent = asc ? '↓ 降順' : '↑ 昇順';
  });

  // 検索条件の解釈・CSV解析・ソートはJSでは行わない。
  // search.wasm 接続時、このファイルはUI入力を渡し、結果をDOMへ描画する橋渡しだけを担当する。
})();
