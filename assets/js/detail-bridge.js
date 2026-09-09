(() => {
  const params = new URLSearchParams(window.location.search);
  const animeId = (params.get('id') || '').trim();
  const status = document.getElementById('detail-status');
  const idBadge = document.getElementById('detail-id-badge');
  const title = document.getElementById('detail-title');
  const sectionLinks = [...document.querySelectorAll('.detail-index a[href^="#"]')];
  const sections = [...document.querySelectorAll('[data-detail-section]')];

  const setStatus = (type, text) => {
    if (!status) return;
    status.className = `ui-message ${type}`;
    status.textContent = text;
    status.hidden = !text;
  };

  const setSectionVisibility = (sectionId, visible) => {
    const section = document.querySelector(`[data-detail-section="${CSS.escape(sectionId)}"]`);
    const link = document.querySelector(`.detail-index a[href="#${CSS.escape(sectionId)}"]`);
    if (section) section.hidden = !visible;
    if (link) link.hidden = !visible;
  };

  const setTitle = (value) => {
    if (title) title.textContent = value || '作品タイトル';
  };

  if (animeId) {
    if (idBadge) {
      const value = idBadge.querySelector('span:last-child');
      if (value) value.textContent = animeId;
      idBadge.hidden = false;
    }
    setStatus('info', '作品IDを受け取りました。search.wasm 接続後、このIDを完全一致条件として1作品を取得します。');

    window.dispatchEvent(new CustomEvent('anime-detail-request', {
      detail: {
        id: animeId,
        match: 'exact'
      }
    }));
  } else {
    setTitle('作品が指定されていません');
    setStatus('error', '詳細ページを表示するには作品IDが必要です。検索または全作品一覧から作品を選択してください。');
  }

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;
      const sectionId = visible.target.id;
      sectionLinks.forEach((link) => {
        link.classList.toggle('is-current', link.getAttribute('href') === `#${sectionId}`);
      });
    }, {
      rootMargin: '-22% 0px -62% 0px',
      threshold: [0, 0.2, 0.5]
    });

    sections.forEach((section) => observer.observe(section));
  }

  window.AnimeDetailUI = Object.freeze({
    id: animeId,
    setStatus,
    setTitle,
    setSectionVisibility
  });

  // 詳細ページはsearch.wasmへ内部IDの完全一致条件を渡す。
  // JS側ではCSV解析、ID検索、検索一致判定、作品情報の推測を行わない。
})();
