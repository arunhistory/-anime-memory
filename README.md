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
- Gemini API: 確定済み事実だけを入力したサイト独自 `synopsis` 生成。Web探索・事実確定には使用しない。現在は接続を後工程へ保留する

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
公開IP確認・接続先IP固定
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
一次情報または別ホストEvidenceを照合
  ↓
日本アニメであることを確認
  ↓
確定した事実だけconfirmed
  ↓
関連リンクを優先度付きfrontierへ追加
  ↓
探索範囲を自己拡張
```

作品専用ホームページだけを対象にしない。ニュース、ブログ、ポータル、出版社、放送局、制作会社、配信、動画等の公開ページも探索対象にできる。

一覧・まとめ・総論ページはリンク発見に利用しても、そのページを作品Evidenceとして無条件保存しない。単一作品ページではページ主題を識別し、同じページに登場した別作品の詳細値を主題作品へ混入させない。

Evidenceは単純多数決で確定しない。scalar値が競合する場合は多数派があっても `conflict` とし、破壊的に採用しない。一次情報として直接性を確認できる作品ページ、または別ホストから一致して確認できた値だけを確定へ進める。

CSV自動登録には `origin_country=JP` の確定が必要で、非日本作品または日本制作であることを確認できない候補は探索stateに残してCSVへ通さない。

HTML本文や記事全文はGitHubへ保存しない。実行中の判定にのみ使用し、`crawler/state.json` にはURL、ページタイトル、関連度、作品候補、Evidence、確定状態、frontier、巡回済みURLハッシュ等の探索状態だけを保持する。

Crawlerはlocalhost、プライベートIP、リンクローカル、IPv4-mapped IPv6等を拒否する。DNS確認後の再解決による接続先すり替えを避けるため、確認済み公開IPへ接続を固定し、HTTPSのホスト名/SNIは元の公開ホスト名を維持する。

`Web Anime Discovery` は `workflow_dispatch` のみで、定期Cronは持たない。初期値は `dry_run=true`。探索工程自体には外部検索API、Gemini API、外部AI検索を接続しない。

検索APIを使わないため、最初のリンクグラフへ入るbootstrap seedを `crawler/seeds.txt` に保持する。seedは作品情報の確定元ではなく、自律巡回を開始する初期ノードである。

詳細は `docs/WEB_DISCOVERY.md` を参照。

## CSV自動収集とGemini概要生成

Web探索で確定した事実は `tools/discovery/to-record.mjs` で共通70列Recordへ変換し、既存の重複判定・CSV生成・全CSV検証へ接続する。

ジャンルは複数指定可能で、学園、ほのぼの、百合、BL、ラブコメ、異世界等を含む検索用分類を正式定義へ正規化する。原作タグ `original_type` は1作品1値とし、なろう系、ライトノベル系、Web小説系、漫画系、ゲーム系、オリジナル等の出自を混在させない。放送時間帯はジャンルへ入れない。

スタッフ、キャラクター/声優、OP/ED/挿入歌、放送枠、配信サービス、エピソード、話数別スタッフ、受賞歴等は、設計資料の固定 `::` 構造へ変換してからCSV validatorを通す。末尾が空欄の構造要素も列数を壊さず保持する。

`relations` は `relation_type::target_id` でサイト内部A-IDを参照するため、相手作品を一意に確定できない段階でタイトルから架空のIDを生成しない。必要な修正は既存の手動修正経路で、target ID存在検証を通した後に確定する。

初期導入では既存 `initial-NNN.csv` へ追記せず毎回新規ファイルを作成する。さらにGit履歴から直近24時間に追加された初期CSVの作品数を数え、複数実行を跨いでも450作品を超えない残枠だけを登録対象にする。追加のDB、Cron、quota保存テーブルは使わない。

Gemini処理コードは探索・事実確定から分離してあるが、現在はユーザー指示により実接続を保留している。`Anime Data Collect` の `gemini` 入力は既定 `false` で、明示的に有効化しない限りGemini API呼び出しもGemini用quota予約も行わない。モデル/API疎通の最終確定はGemini接続工程で実施する。

既存CSV後段の詳細は `docs/DATA_COLLECTION.md` を参照。

## 現在の実装範囲

実装・検証済み:

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
- IPv4-mapped IPv6・mixed public/private DNS拒否
- DNS確認済み公開IPへの接続固定
- 1ページ取得量 / 1回取得数 / 1ホスト取得数 / 探索深度の上限
- title / OGP / JSON-LD / 本文からのアニメ言及判定
- 一覧/総論ページの探索専用化
- ページ主題作品と副次的作品言及のEvidence分離
- 作品名候補抽出
- 同一サイト・外部サイト双方への優先度付きリンク探索
- Web本文を保存しない探索state
- 探索候補と根拠URLの永続化
- 探索メタデータ用の自前検索index
- Web探索候補からのEvidence抽出
- 一次情報直接性 / 複数ホスト一致 / conflict判定
- 日本アニメ確定ゲート
- explicit alias + 複合identityによる保守的Entity Resolution
- ジャンル複数選択・原作タグ単一選択の分類体系
- 70列の基本・制作・スタッフ・音楽・放送等のEvidence抽出
- 固定構造fieldsの抽出と構造検証
- confirmed事実だけの共通70列Record変換
- Web探索 → 共通70列CSV後段の接続
- HTTPS JSON API専用の互換取得器
- 共通70列への宣言的マッピング・正規化
- 可変長scalar/list値のescape
- 外部ID完全一致と複合条件による重複候補検出
- 初期導入 `initial-NNN.csv` 新規生成
- 初期導入の直近24時間450作品上限
- 四半期 `YYYY-QN.csv` 追加経路
- `manifest.csv` ファイル名専用生成
- CSVスキーマ / UTF-8 / ID / media_type / 日付 / URL / relations / 重複候補 / 四半期所属の公開前検証
- 手動修正の単項目置換 / 空欄化 / rollback / ID保護 / target検証
- Geminiを既定OFFにした収集Workflow
- 失敗時Commit禁止・force push禁止・data競合時停止
- 自動収集 / Web探索の自己試験とActions検証
- 実Webread-only crawler pilot
- エラー / 状態表示の共通UI
- C++ネイティブ試験 / ブラウザWASM ABIスモーク試験 / UI静的検証

Gemini接続後に行う工程:

- Geminiのモデル/API経路を現行仕様で確定
- GitHub ActionsからGemini実API疎通
- 確定済み事実のみを使った `synopsis` 実生成
- 実作品CSVの初回本番収集
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
