(() => {
  const params = new URLSearchParams(window.location.search);
  const animeId = (params.get('id') || '').trim();
  const status = document.getElementById('detail-status');
  const idBadge = document.getElementById('detail-id-badge');
  const title = document.getElementById('detail-title');
  const subTitle = document.getElementById('detail-sub-title');
  const synopsis = document.getElementById('detail-synopsis');
  const tagRow = document.getElementById('detail-tags');
  const visual = document.querySelector('.visual-placeholder');
  const sectionLinks = [...document.querySelectorAll('.detail-index a[href^="#"]')];
  const sections = [...document.querySelectorAll('[data-detail-section]')];

  const setStatus = (type, text) => {
    if (!status) return;
    status.className = `ui-message ${type}`;
    status.textContent = text;
    status.hidden = !text;
  };

  const safeHttpUrl = (value) => {
    if (!value) return '';
    try {
      const url = new URL(value, window.location.href);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch (_) {
      return '';
    }
    return '';
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

  const setHero = ({ title: nextTitle = '', subtitle = '', summary = '', tags = [], imageUrl = '', imageAlt = '' } = {}) => {
    setTitle(nextTitle);
    if (subTitle) subTitle.textContent = subtitle;
    if (synopsis) synopsis.textContent = summary;

    if (tagRow) {
      tagRow.replaceChildren();
      if (Array.isArray(tags)) {
        tags.forEach((tag, index) => {
          if (!tag) return;
          const node = document.createElement('span');
          node.className = `tag ${index % 3 === 1 ? 'pink' : index % 3 === 2 ? 'yellow' : 'blue'}`;
          node.textContent = String(tag);
          tagRow.appendChild(node);
        });
      }
    }

    if (visual) {
      visual.replaceChildren();
      const safeUrl = safeHttpUrl(imageUrl);
      if (safeUrl) {
        const image = document.createElement('img');
        image.src = safeUrl;
        image.alt = imageAlt || nextTitle || '';
        image.decoding = 'async';
        visual.appendChild(image);
      } else {
        const placeholder = document.createElement('span');
        placeholder.textContent = 'IMAGE';
        placeholder.setAttribute('aria-hidden', 'true');
        visual.appendChild(placeholder);
      }
    }
  };

  const setSectionItems = (sectionId, items = []) => {
    const section = document.querySelector(`[data-detail-section="${CSS.escape(sectionId)}"]`);
    if (!section) return;

    const body = section.querySelector('.data-placeholder');
    if (!body) return;

    if (!Array.isArray(items) || items.length === 0) {
      setSectionVisibility(sectionId, false);
      return;
    }

    setSectionVisibility(sectionId, true);
    body.classList.remove('data-placeholder', 'emphasis');
    body.classList.add('detail-data-list');
    body.replaceChildren();

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'detail-data-row';

      if (typeof item === 'string') {
        const value = document.createElement('span');
        value.textContent = item;
        row.appendChild(value);
      } else if (item && typeof item === 'object') {
        if (item.label) {
          const label = document.createElement('strong');
          label.textContent = String(item.label);
          row.appendChild(label);
        }

        const safeUrl = safeHttpUrl(item.href);
        if (safeUrl) {
          const link = document.createElement('a');
          link.href = safeUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = String(item.value ?? safeUrl);
          row.appendChild(link);
        } else {
          const value = document.createElement('span');
          value.textContent = String(item.value ?? '');
          row.appendChild(value);
        }
      }

      body.appendChild(row);
    });
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
    setHero,
    setSectionVisibility,
    setSectionItems
  });

  // 詳細ページはsearch.wasmへ内部IDの完全一致条件を渡す。
  // JS側ではCSV解析、ID検索、検索一致判定、作品情報の推測を行わない。
})();
