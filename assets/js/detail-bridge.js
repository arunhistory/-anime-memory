(() => {
  const bridgeUrl = document.currentScript?.src || window.location.href;
  const wasmModuleUrl = new URL('../wasm/search.js', bridgeUrl).href;
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
  const runtime = window.AnimeWasmRuntime;

  let wasm = null;
  let dataReady = false;

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

    const body = section.querySelector('.detail-data-list, .data-placeholder');
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

  const values = (record, definitions) => definitions.flatMap(([key, label]) => {
    const value = record?.[key];
    return value ? [{ label, value }] : [];
  });

  const links = (record, definitions) => definitions.flatMap(([key, label]) => {
    const value = record?.[key];
    return value ? [{ label, value, href: value }] : [];
  });

  const renderRecord = (record) => {
    const subtitleParts = [record.title_kana, record.title_romaji, record.title_en].filter(Boolean);
    setHero({
      title: record.title_ja || '作品タイトル',
      subtitle: subtitleParts.join(' / '),
      summary: record.synopsis || '概要情報は登録されていません。',
      tags: [record.media_type].filter(Boolean),
      imageUrl: record.image_url || '',
      imageAlt: record.title_ja || ''
    });

    setSectionItems('basic', values(record, [
      ['id', '内部ID'], ['aliases', '別名'], ['media_type', '媒体'], ['release_start', '開始日'], ['release_end', '終了日'],
      ['episode_count', '話数'], ['runtime_min', '標準時間'], ['series_id', 'シリーズID'], ['season_number', 'シーズン番号'],
      ['genres', 'ジャンル'], ['tags', 'タグ'], ['target_demographic', '対象層'], ['setting', '舞台・設定'],
      ['era', '時代'], ['themes', 'テーマ'], ['external_ids', '外部ID'], ['updated_at', '最終確認日']
    ]));
    setSectionItems('original', values(record, [
      ['original_type', '原作種別'], ['original_title', '原作名'], ['original_author', '原作者'], ['original_artist', '作画'],
      ['original_publisher', '出版社'], ['original_label', 'レーベル'], ['original_magazine', '掲載誌'], ['original_platform', '掲載・配信先']
    ]));
    setSectionItems('studio', values(record, [
      ['animation_studio', 'アニメーション制作'], ['co_animation_studio', '共同制作'], ['animation_cooperation', '制作協力']
    ]));
    setSectionItems('production', values(record, [
      ['production_name', '製作名義'], ['production_committee', '製作委員会'], ['production_members', '構成企業'],
      ['production_lead_company', '主幹企業'], ['planning', '企画'], ['executive_producers', 'エグゼクティブプロデューサー'],
      ['producers', 'プロデューサー'], ['animation_producers', 'アニメーションプロデューサー'], ['line_producers', 'ラインプロデューサー']
    ]));
    setSectionItems('staff', values(record, [
      ['director', '監督'], ['chief_director', '総監督'], ['series_composition', 'シリーズ構成'], ['character_original_design', 'キャラクター原案'],
      ['character_design', 'キャラクターデザイン'], ['music', '音楽'], ['sound_director', '音響監督'], ['staff', 'その他スタッフ']
    ]));
    setSectionItems('cast', values(record, [['characters', 'キャラクター・声優']]));
    setSectionItems('music', values(record, [
      ['opening_themes', 'オープニング'], ['ending_themes', 'エンディング'], ['insert_songs', '挿入歌'],
      ['music_production', '音楽制作'], ['soundtrack_label', 'サウンドトラックレーベル']
    ]));
    setSectionItems('broadcast', values(record, [['broadcast_networks', '放送局'], ['broadcast_slots', '放送枠']]));
    setSectionItems('streaming', values(record, [['streaming_services', '配信サービス']]));
    setSectionItems('theater', values(record, [['film_distributor', '配給'], ['theatrical_release_date', '劇場公開日']]));
    setSectionItems('relations', values(record, [['relations', '関連作品']]));
    setSectionItems('episodes', values(record, [['episodes', 'エピソード'], ['episode_staff', '各話スタッフ']]));
    setSectionItems('awards', values(record, [['awards', '受賞歴']]));
    setSectionItems('official', links(record, [
      ['official_url', '公式サイト'], ['official_x', '公式X'], ['official_youtube', '公式YouTube'], ['official_other', 'その他公式情報']
    ]));
  };

  const getEngineError = () => {
    if (!wasm || !runtime) return '詳細取得エンジンでエラーが発生しました。';
    return runtime.readCString(wasm, wasm._anime_search_last_error()) || '詳細取得エンジンでエラーが発生しました。';
  };

  const addCsvBytes = (bytes) => runtime.withBytes(wasm, bytes, (pointer, size) => {
    if (wasm._anime_search_add_csv(pointer, size) !== 1) throw new Error(getEngineError());
  });

  const requestDetail = () => {
    if (!animeId || !wasm || !dataReady) return;
    window.dispatchEvent(new CustomEvent('anime-detail-request', { detail: { id: animeId, match: 'exact' } }));

    runtime.withCString(wasm, animeId, (idPointer) => {
      const resultPointer = wasm._anime_search_record_json_by_id(idPointer);
      const json = runtime.readCString(wasm, resultPointer);
      const record = JSON.parse(json || 'null');
      if (!record) {
        setStatus('error', '指定された作品IDは見つかりませんでした。');
        setTitle('作品が見つかりません');
        return;
      }
      renderRecord(record);
      setStatus('', '');
    });
  };

  if (animeId) {
    if (idBadge) {
      const value = idBadge.querySelector('span:last-child');
      if (value) value.textContent = animeId;
      idBadge.hidden = false;
    }
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
    setSectionItems,
    requestDetail
  });

  const initialize = async () => {
    if (!animeId) return;
    if (!runtime) {
      setStatus('error', 'WASM接続ランタイムを読み込めませんでした。');
      return;
    }

    setStatus('info', '作品詳細を準備しています…');
    try {
      const imported = await import(wasmModuleUrl);
      wasm = await imported.default();
      if (wasm._anime_search_reset() !== 1) throw new Error(getEngineError());
      await runtime.feedCsvFiles((bytes) => addCsvBytes(bytes), { concurrency: 4 });
      if (wasm._anime_search_finalize() !== 1) throw new Error(getEngineError());
      dataReady = true;
      requestDetail();
    } catch (error) {
      dataReady = false;
      if (error?.code === 'DATA_NOT_CONNECTED') {
        setStatus('info', '詳細取得エンジン本体は配置済みです。作品CSVの接続後に表示できます。');
        return;
      }
      setStatus('error', error?.message || '作品詳細を読み込めませんでした。');
    }
  };

  void initialize();

  // 詳細ページはsearch.wasmへ内部IDの完全一致要求を渡す。
  // JS側ではCSV解析・検索判定・ソート・派生値計算を行わず、WASM結果を表示項目へ配置する。
})();
