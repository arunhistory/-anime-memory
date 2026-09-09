(() => {
  const commonScriptUrl = document.currentScript?.src || '';
  const siteRootUrl = commonScriptUrl ? new URL('../../', commonScriptUrl) : new URL('./', window.location.href);

  document.querySelectorAll('button').forEach((button) => {
    button.addEventListener('pointerdown', () => button.classList.add('is-pressed'));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
      button.addEventListener(eventName, () => button.classList.remove('is-pressed'));
    });
  });

  const clearNode = (node) => {
    if (node) node.replaceChildren();
  };

  const setBusy = (node, busy) => {
    if (node) node.setAttribute('aria-busy', String(Boolean(busy)));
  };

  const setEmptyState = (container, { icon = '⌕', title = '', message = '' } = {}) => {
    if (!container) return;
    clearNode(container);

    const card = document.createElement('div');
    card.className = 'empty-state card-surface';

    const iconNode = document.createElement('div');
    iconNode.className = 'empty-icon';
    iconNode.setAttribute('aria-hidden', 'true');
    iconNode.textContent = icon;

    const heading = document.createElement('h2');
    heading.textContent = title;

    const paragraph = document.createElement('p');
    paragraph.textContent = message;

    card.append(iconNode, heading, paragraph);
    container.appendChild(card);
  };

  const safeImageUrl = (value) => {
    if (!value) return '';
    try {
      const url = new URL(value, window.location.href);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch (_) {
      return '';
    }
    return '';
  };

  const safeNavigationUrl = (value) => {
    if (!value) return '#';
    try {
      const url = new URL(value, window.location.href);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && url.origin === window.location.origin) {
        return url.href;
      }
    } catch (_) {
      return '#';
    }
    return '#';
  };

  const detailUrlForId = (id) => {
    const value = String(id || '').trim();
    if (!/^A\d{8}$/.test(value)) return '';
    const url = new URL('detail.html', siteRootUrl);
    url.searchParams.set('id', value);
    return url.href;
  };

  const createAnimeCard = ({ id = '', href = '#', title = '作品タイトル', subtitle = '', tags = [], imageUrl = '', imageAlt = '' } = {}) => {
    const article = document.createElement('article');
    article.className = 'anime-card card-surface';

    const link = document.createElement('a');
    link.className = 'anime-card-link';
    const detailUrl = detailUrlForId(id);
    link.href = safeNavigationUrl(detailUrl || href);

    const visual = document.createElement('div');
    visual.className = 'anime-card-visual';

    const safeUrl = safeImageUrl(imageUrl);
    if (safeUrl) {
      const image = document.createElement('img');
      image.src = safeUrl;
      image.alt = imageAlt || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      visual.appendChild(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.textContent = 'IMAGE';
      placeholder.setAttribute('aria-hidden', 'true');
      visual.appendChild(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'anime-card-body';

    if (Array.isArray(tags) && tags.length) {
      const tagRow = document.createElement('div');
      tagRow.className = 'tag-row';
      tags.forEach((tag, index) => {
        if (!tag) return;
        const tagNode = document.createElement('span');
        tagNode.className = `tag ${index % 3 === 1 ? 'pink' : index % 3 === 2 ? 'yellow' : 'blue'}`;
        tagNode.textContent = String(tag);
        tagRow.appendChild(tagNode);
      });
      body.appendChild(tagRow);
    }

    const heading = document.createElement('h2');
    heading.className = 'anime-card-title';
    heading.textContent = title || '作品タイトル';
    body.appendChild(heading);

    if (subtitle) {
      const sub = document.createElement('p');
      sub.className = 'anime-card-subtitle';
      sub.textContent = subtitle;
      body.appendChild(sub);
    }

    const more = document.createElement('span');
    more.className = 'anime-card-more';
    more.textContent = '詳しく見る →';
    body.appendChild(more);

    link.append(visual, body);
    article.appendChild(link);
    return article;
  };

  window.AnimeUI = Object.freeze({
    clearNode,
    setBusy,
    setEmptyState,
    createAnimeCard
  });
})();
