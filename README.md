# 日本アニメ総合検索サイト

GitHub・CSV・WASM統合型の日本アニメ総合検索サイト。

このリポジトリでは、実装設計資料で確定した責務分離を基準に実装する。

## 現行4ページ構成

公開画面は次の4ファイルに物理分離する。

- `/index.html` — トップページ
- `/search.html` — 検索ページ
- `/all.html` — 全件表示ページ
- `/detail.html?id=A00000001` — 詳細ページ

`search/index.html`、`all/index.html`、`detail/index.html` の旧重複ページは削除済み。
旧 `top.html` も公開ルートから除外し、現行導線には使用しない。

## ページごとの処理分離

- `index.html`: `common.js` のみ。WASM・作品CSVを読み込まない。
- `search.html`: `search.wasm` 系だけを使用。`all.wasm` は読み込まない。
- `all.html`: `all.wasm` 系だけを使用。検索WASMを読み込まない。
- `detail.html`: 内部ID完全一致取得のため `search.wasm` を使用。全件表示処理は読み込まない。

この分離により、トップや検索ページを開いただけで全作品処理が起動する構成にはしない。

## 基本責務

- GitHub: 保存 / 履歴 / Actions / Pages
- CSV: 作品データの正本
- `search.wasm`: 検索・条件判定・検索結果ソート・内部ID完全一致詳細取得
- `all.wasm`: 全件読込・全件出力・全件ソート
- JavaScript: UI / HTTP取得 / WASMとの受け渡し / DOM描画
- Web探索Tools: 公開Web巡回 / アニメ言及判定 / 作品候補発見 / Evidence抽出・照合 / 探索状態管理
- CSV収集Tools: 正規化 / 重複候補判定 / CSV生成 / 公開前検証
- Gemini API: 確定済み事実だけを入力したサイト独自 `synopsis` 生成。Web探索・事実確定には使用しない

## JavaScriptで行わない処理

JavaScript側では次を行わない。

- CSV内容の解析・正規化
- 年代・四季・ジャンル・媒体・スタッフ等による事前絞り込み
- 検索結果・全件一覧の並び替え計算
- 検索一致判定
- AND / OR / NOT の意味判定
- 日付範囲・数値範囲の判定

JavaScriptはUI入力を受け取り、CSV生バイト列と検索条件をWASMへ渡し、WASMから返った結果をDOMへ描画する橋渡しに限定する。

作品カードはWASMから返る内部ID `A00000001` 形式を使用し、`detail.html?id=...` へ一意に遷移する。`#` や同一一覧ページへのフォールバックを正常系導線として使用しない。

## C++ / WASM

`search.wasm` と `all.wasm` はC++17から別々の成果物としてビルドする。共通CSVパーサーと共通6ソートはC++ソースを共有し、検索障害と全件表示障害の影響範囲はバイナリ分離で限定する。

- 共通CSVスキーマ: 70列・固定ヘッダー・固定列順
- CSV: UTF-8 / RFC 4180基準
- 読込: CSVを生バイトのままWASMへ転送し、C++側で解析
- 検索: 完全一致 / 前方一致 / 部分一致
- 複合条件: AND / OR / 条件単位のNOT
- 範囲: 日付 / 数値
- 構造化日付: 配信開始日 / 配信終了日 / エピソード放送日
- 結果: レコードindex中心で保持し、表示用データを一定件数ずつ返却

## 検索対象

検索画面では、共通CSVへ保存する項目を原則すべて条件として指定できる。タイトル、分類、原作、制作・製作、スタッフ、キャスト、音楽、放送、配信、劇場、関連作品、エピソード、受賞歴、公式情報、外部ID等を同一 `search.wasm` で処理する。

詳細ページも別検索エンジンを作らず、`search.wasm` 内の内部ID完全一致取得を使用する。

## 共通ソート

検索ページと全件表示ページは次の6種類だけを共通で使用する。

1. 四季順
2. 年代順
3. タイトル順
4. 制作会社名順
5. 話数順
6. 総時間順

昇順 / 降順を切り替えられる。監督・声優・製作委員会等はソートへ増やさず検索条件として扱う。

## Web自動探索

外部検索APIを前提にせず、公開Webページ上のアニメ言及から作品候補を発見する探索エンジンを実装している。

```text
公開Webの起点URL
  ↓
robots.txt確認
  ↓
HTML / XML / RSS / Atom取得
  ↓
title / OGP / JSON-LD / 本文 / リンクを実行時解析
  ↓
アニメ言及スコアリング
  ↓
作品候補抽出
  ↓
作品ごとのEvidence抽出
  ↓
別ホストを含む複数Evidenceを照合
  ↓
一致した事実だけconfirmed
  ↓
関連リンクを優先度付きfrontierへ追加
  ↓
探索範囲を自己拡張
```

作品専用ホームページだけを対象にしない。ニュース、ブログ、ポータル、出版社、放送局、制作会社、配信、動画等の公開ページも同じ探索対象として扱う。

HTML本文や記事全文はGitHubへ保存しない。実行中の判定にのみ使用し、`crawler/state.json` にはURL、ページタイトル、関連度、作品候補、Evidence、確定状態、frontier、巡回済みURLハッシュ等の探索状態だけを保持する。

`Web Anime Discovery` は `workflow_dispatch` のみで、定期Cronは持たない。初期値は `dry_run=true`。この探索工程自体には外部検索API、Gemini API、外部AI検索を接続しない。

検索APIを使わないため、最初のリンクグラフへ入る起点URLは `crawler/seeds.txt` またはActions入力から与える。これは作品ごとの情報源指定ではなく、その後の自律巡回を開始する初期ノードである。

詳細は `docs/WEB_DISCOVERY.md` を参照。

## CSV自動収集とGemini概要生成

Web探索で複数ページから確認された事実は `tools/discovery/to-record.mjs` で共通70列Recordへ変換し、既存の重複判定・CSV生成・全CSV検証へ接続する。

Geminiは `tools/gemini/synopsis.mjs` に分離し、作品探索や事実確定には使用しない。共通Recordの確定済み非空値だけを入力して `synopsis` を生成する。APIキーはGitHub Actions Repository Secret `ANIME_GEMINI_API_KEY` からサーバー側だけで読み取り、PagesやブラウザJavaScriptへ渡さない。

標準モデルは `gemini-3.5-flash-lite`。Repository Variable `ANIME_GEMINI_MODEL` が設定されている場合のみモデルを差し替えられる。1作品につき概要生成API呼び出しは最大1回、1実行あたりのGemini呼び出し上限は450件。429、5xx、ネットワーク障害、出力不正時は再送せず安全停止し、その実行で既に概要生成できた作品だけを後段へ残す。

`Anime Data Collect` の `dry_run=true` ではGeminiを呼ばず、API枠を消費しない。`dry_run=false` の実収集時だけGemini概要生成を有効にする。外部から取得した概要文をそのままサイト独自概要として保存せず、Gemini生成前の `synopsis` は空欄にする。

既存CSV後段の詳細は `docs/DATA_COLLECTION.md` を参照。

## 現在の実装範囲

実装済み:

- ポップで明るい共通デザイン
- PC / モバイルのレスポンシブナビゲーション
- トップ / 検索 / 全件表示 / 詳細の4ファイル物理分離
- ページごとのWASM/JS処理分離
- 共通70列CSVスキーマ検証
- C++共通CSVパーサー
- `search.wasm` / `all.wasm` の別バイナリ
- 共通6ソート × 昇順/降順
- 検索の完全一致 / 前方一致 / 部分一致
- AND / OR / 条件単位NOT
- 日付・数値範囲検索
- 配信期間・エピソード放送日の構造化日付範囲検索
- 共通CSV各保存項目を選択できる詳細検索UI
- 全件表示の段階描画
- 詳細ページの内部ID取得経路
- 作品カードから内部ID別詳細ページへの一意遷移
- manifestから作品CSVを取得してWASMへ生バイト転送するJavaScript境界
- 公開WebのHTML / XML / RSS / Atom取得器
- robots.txt Allow/Disallow/Crawl-delay確認
- URL正規化・追跡パラメータ除去・localhost/プライベート宛先拒否
- 1ページ取得量 / 1回取得数 / 1ホスト取得数 / 探索深度の上限
- title / OGP / JSON-LD / 本文からのアニメ言及判定
- 作品名候補抽出
- 同一サイト・外部サイト双方への優先度付きリンク探索
- Web本文を保存しない探索state
- 探索候補と根拠URLの永続化
- 探索メタデータ用の自前検索index
- Web探索候補からのEvidence抽出
- 複数ホストEvidenceの一致 / conflict判定
- confirmed事実だけの共通70列Record変換
- Web探索 → 共通70列CSV後段の接続
- HTTPS JSON API専用の既存取得器
- 共通70列への宣言的マッピング・正規化
- 外部ID完全一致と複合条件による重複候補検出
- 初期導入 `initial-NNN.csv` 新規生成・450件上限
- 四半期 `YYYY-QN.csv` 追加経路
- `manifest.csv` ファイル名専用生成
- CSVスキーマ / UTF-8相当 / ID / media_type / 日付 / URL / relations / 重複候補 / 四半期所属の公開前検証
- Gemini Interactions API概要生成モジュール
- `ANIME_GEMINI_API_KEY` のGitHub Actions Secret接続
- 1作品1呼び出し / 1実行450呼び出し上限
- Gemini 429 / 5xx / ネットワーク / 不正出力の安全停止
- dry-run時Gemini未呼び出し
- 失敗時Commit禁止・force push禁止・data競合時停止
- 自動収集 / Web探索 / Geminiの自己試験とActions検証
- エラー / 状態表示の共通UI
- C++ネイティブ試験 / ブラウザWASM ABIスモーク試験 / UI静的検証

未実測・次工程:

- 実Webの初期起点選定とdry-run実測
- GitHub Actionsから登録済みGeminiキーを使った実API疎通
- 実作品CSVの初回収集
- 初期導入の「1日最大450作品」を複数実行間でも超えない日次ガード
- 初期導入完了後の四半期更新実運用

## データ実装時の原則

- 初期導入CSVと四半期CSVは同一スキーマにする。
- 作品情報を検索高速化のため別形式へ複製しない。
- `master.csv` や作品情報複製インデックスを作らない。
- `crawler/state.json` はWeb探索状態であり、確定作品情報の正本にしない。
- `manifest.csv` を使用する場合はCSVファイル名のみを保持する。
- `search.wasm` と `all.wasm` は別バイナリのまま維持する。
- 初期導入は既存CSVへ追記せず、新しい `initial-NNN.csv` を毎回生成する。
- 自動処理失敗時に既存の正常CSVを破壊しない。
