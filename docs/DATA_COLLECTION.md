# 自動収集パイプライン

公開Web探索で得た作品候補とEvidenceから、確定できる事実だけを共通70列CSV候補へ渡す。Geminiはサイト独自 `synopsis` の生成専用で、Web探索・事実確定には使用しない。GitHub Actions SecretからGemini APIへ到達する接続経路は実測済みだが、現在の実生成はGoogle側の `429 RESOURCE_EXHAUSTED` で停止しているため、本番既定は `gemini=false` のままとする。

## 標準実行経路

```text
公開Web
  ↓
GitHub Actions (Web Anime Discovery)
  ↓
アニメ言及を検出
  ↓
作品候補 + Evidence + 根拠URL
  ↓
ページ主題分離 / 日本アニメ確認 / 一次情報または独立source family照合
  ↓
Entity Resolution
  ↓
crawler/state.json
  ↓
GitHub Actions (Anime Data Collect / input=discovery)
  ↓
confirmed の事実だけ共通70列Recordへ変換
  ↓
既存作品との重複候補判定
  ↓
初期500件package / 四半期所属判定
  ↓
[Gemini利用可能時のみ] synopsis生成
  ↓
initial-NNN.csv / YYYY-QN.csv
  ↓
全CSV検証
  ↓
検証成功時だけ Commit
```

Geminiを使用しない現在の既定実行では `gemini=false` とし、API呼び出しもGemini用quota予約も行わない。Google側quota/billingが利用可能になるまで、同じ失敗を根拠なく再試行しない。

## Discovery入力

`Anime Data Collect` の標準入力は `discovery`。`crawler/state.json` の候補からCSV化できるものだけを取得する。

Evidenceはページ本文の複製ではなく、`field / value / sourceUrl / sourceClass / rule / observedAt` の最小情報として保持する。HTML本文、記事全文、画像、動画はstateへ保存しない。

情報源は `primary` / `secondary` に分ける。作品主題と一致する直接的な公式作品ページ等を一次情報として扱い、一次情報で直接確認できた値、または独立したsource family 2つ以上から一致確認できた値を `confirmed` とする。単独の二次情報は `observed`。同一運営・同系列の複数ホストは裏取り件数を水増ししないよう1 familyとして扱い、例としてWikipedia・Wikidata・Wikimedia Commons等のWikimedia系だけでは二次情報を自己確定させない。scalar値に異なる候補が存在する場合は、2対1等の多数決をせず `conflict` として値を空欄にする。

一覧、まとめ、総論ページはリンク発見に使用しても、そのページ自体を作品Evidenceとして無条件保存しない。単一作品ページに別作品が登場した場合、副次作品は原則タイトルEvidenceだけを残し、日付、媒体、スタッフ等を混入させない。

CSV登録候補には次の条件をすべて要求する。

- `origin_country=JP` が `confirmed`
- `title_ja` が `confirmed`
- `media_type` が `confirmed`
- `release_start` / `theatrical_release_date` / `animation_studio` のいずれかが `confirmed`

非日本作品、制作国不明、根拠不足、競合状態の候補はCSVへ通さずstateに残して追加探索を待つ。

## Evidence抽出範囲

基本情報、タイトル表記、放送・公開期間、話数、時間、分類、原作、制作・製作、主要スタッフ、キャスト、音楽、放送局、劇場情報、公式URL等を共通70列へ対応付ける。

固定構造を持つ項目は設計資料どおり次の形式へ変換する。

- `staff = 役職::氏名|...`
- `characters = キャラクター名::役区分::声優名|...`
- `opening_themes = OP::曲名::歌手::作詞::作曲::編曲|...`
- `ending_themes = ED::曲名::歌手::作詞::作曲::編曲|...`
- `insert_songs = 挿入歌::曲名::歌手::作詞::作曲::編曲|...`
- `broadcast_slots = 放送局::曜日時刻|...`
- `streaming_services = サービス::配信形態::地域::開始日::終了日|...`
- `episodes = 話数::サブタイトル::放送日|...`
- `episode_staff = 話数::役職::氏名|...`
- `awards = 年::賞名::受賞区分|...`

構造末尾が空欄でも `::` を消してフィールド数を壊さない。`streaming_services` の配信形態は、通常、独占、見放題独占、配信独占、最速、先行、地上波先行、`Web 最速`、同時配信、期間限定、レンタル、購入、無料、その他の定義値だけを認める。

`relations` は `relation_type::target_id` でサイト内部A-IDを参照する。対象作品が内部IDを持つ前にタイトルからIDを推測生成しない。関係を確定する場合は、対象A-IDが実在することをvalidatorで確認できる既存の手動修正経路を使う。

`image_url` は画像利用条件を満たすことを確認できない一般Web画像を自動転載対象にしないため、権利条件を確認できない場合は空欄を維持する。

`external_ids` は実際に外部サービスの識別子を確認できた場合だけ `source::id` として保存する。単なるWebページURLを外部IDとして捏造しない。

## ジャンルと原作タグ

分類定義は `tools/discovery/taxonomy.mjs` を正本とする。

`genres` は複数指定可能で、共通CSVでは `|` 区切りで保存する。学園、ほのぼの、百合、BL、ラブコメ、異世界、魔法少女、ロボット等を含め、Web表記揺れを正式ジャンルへ正規化する。同一ジャンルが一次情報または独立した複数source familyから確認された場合だけ確定する。

原作タグは `original_type` を使用し、1作品につき1つだけ保存する。オリジナル、漫画系、4コマ漫画系、ライトノベル系、Web小説系、なろう系、カクヨム系、一般小説系、児童文学系、ゲーム系、ソーシャルゲーム系、ノベルゲーム系、カードゲーム系、玩具系、特撮系、舞台系、音楽系、キャラクター企画系、メディアミックス、その他を扱う。

出自が明示される場合は出自を優先する。例として「小説家になろう発で、その後ライトノベルとして書籍化」は `なろう系` 1値とし、`なろう系|ライトノベル系` のような複数値は拒否する。

`深夜アニメ`、`朝アニメ`、`夕方アニメ`、`ゴールデン帯` 等の放送時間帯はジャンルにも原作タグにも使用しない。放送時間情報は `broadcast_slots` として分離する。

## 重複・Entity Resolution

外部IDがある入力では `source::id` の完全一致を最優先する。外部IDがないDiscovery入力では、正規化タイトル/別名、`media_type`、開始日または劇場公開日、原作情報またはアニメーション制作等の組合せを使う。

Web探索state内で異なるタイトル候補を1作品へまとめる場合も、明示的に確認済みのalias関係に加え、媒体と開始日・制作会社等のidentity一致を要求する。表記が似ているだけでは統合しない。日本/非日本のorigin競合がある候補も統合しない。

次回探索の既登録作品判定は専用の重複Indexを新設せず、公開検索で使用する `search.wasm` を流用する。既存CSVをWASMへ読み込み、`title_ja / title_kana / title_romaji / title_en / aliases` の完全一致で既登録作品を判定する。既登録作品はCandidate/Evidenceを再収集しないが、そのページから未知作品へ伸びるリンク探索は継続する。

不確実な候補は自動統合・既存値上書きをしない。

## 初期導入

`mode=initial` は既存 `initial-NNN.csv` に追記しない。確定済みの非重複作品が500件揃った場合だけ、次の連番ファイルを500作品で新規生成する。

500件未満のRecordは `crawler/pending-initial.json` へ保存し、次回の短時間バッチへ引き継ぐ。途中状態は公開用 `data/manifest.csv` に追加しない。CSV・manifest・探索state・途中状態は同じ確定処理で扱い、検証失敗時は生成前へ戻す。

Geminiは明示的に有効化した場合だけ日次450呼出し上限を適用する。Gemini無効時にはこの450上限を適用せず、500件package規則だけを適用する。Gemini有効時に450件で止まった概要生成結果も途中状態へ保存し、別日に500件揃うまで公開しない。

## 四半期更新

`mode=quarterly` は `year` と `Q1`〜`Q4` を指定する。`release_start`、`theatrical_release_date`、または `streaming_services` の開始日が対象四半期に含まれる新規作品だけを `YYYY-QN.csv` へ追加する。

既存の非空値は無条件上書きしない。不確実な重複候補も自動統合しない。

## Gemini概要生成 — 接続経路確認済み / 実生成はquota待ち

Gemini用コードは `tools/gemini/` に隔離され、Web探索・Evidence確定とは接続しない。`Anime Data Collect` の入力 `gemini` は既定 `false`。

GitHub Actions Repository Secret `ANIME_GEMINI_API_KEY` が実行時環境へ正常に渡り、Google Gemini APIまで到達することはライブ試験で確認した。現在の既定モデル `gemini-3.5-flash-lite` に対して、Interactions経路とGenerateContent経路をそれぞれ1回ずつ診断したところ、双方とも認証エラーではなくHTTP 429 `RESOURCE_EXHAUSTED` で停止した。このため、現在の障害はリポジトリ内の接続経路ではなくGoogle側quota/billing層として扱う。

同じ429を根拠なく繰り返さない。Google側のquota/billingが利用可能になったことを確認できるまで本番 `gemini=true` は使用しない。失敗したライブ試験用の一時Workflowは削除済み。APIキーはPages、ブラウザJavaScript、CSV、crawler state、ログへ保存しない。

ライブ診断に先立って確保した1呼出し分は、生成成功を確認できていないため安全側の予約として `crawler/gemini-usage.json` に残している。実生成が利用可能になった時点で、まず1件の疎通確認を行い、成功後に通常の1作品1回・日次上限管理へ進む。

## 既存JSON API入力

HTTPS JSON API取得器は互換経路として残している。`Anime Data Collect` で `input=api-json` を明示した場合だけ使用する。標準経路は `discovery`。

`api-json` を使う場合だけ Repository Variable `ANIME_SOURCE_CONFIG_JSON` と、必要なら Repository Secret `ANIME_SOURCE_TOKEN` を参照する。秘密値を設定JSON、CSV、ログへ直接保存しない。

## 失敗時・競合時

取得、Evidence変換、重複判定、CSV生成、検証のどこかで致命的に失敗した場合はCommitしない。生成後の検証に失敗した場合は対象CSVとmanifestを元状態へ戻す。

GitHubへの確定時はforce pushを使用しない。処理開始後に `data/` が別Commitで進んでいた場合は自動確定を中止し、古い状態を基準に上書きしない。Actions側も同系統の書込みを `concurrency` で直列化する。

## 実行方法と実測状況

`Web Anime Discovery` と `Anime Data Collect` は手動 `workflow_dispatch` のまま。統合本番用 `Anime Research Production` だけが1月1日・4月1日・7月1日・10月1日に新しい探索周期を開始する。

本番周期の各Actions実行は100ページで終了し、stateをCommitした後、周期がactiveの場合だけ次の短時間実行を `workflow_dispatch` する。新しい確定・非重複の日本アニメ作品が24時間見つからない、frontierが空になる、または500件CSVを1つ公開した時点でactiveを解除する。解除後は次の四半期開始まで実行を起動しない。

`crawler/seeds.txt` には実測済みbootstrap seedが設定されている。GitHub ActionsのライブbootstrapでWikipediaを許可ホストに限定して40ページを本番stateへ巡回し、40/40ページ取得、通信失敗0、23作品候補、4,154件の継続frontierを生成して `crawler/state.json` へ保存した。robots、公開IP確認、DNS pinning、取得量制御、HTML解析、候補抽出、日本アニメgate、Evidence確定条件を実Webに対して確認している。

このbootstrap後も、同一系列の別ホストだけでEvidenceが自己確定しないようsource family単位の重複抑止を追加し、Wikimedia系クロスホスト自己確定の禁止をCIで検証している。

初回0件時は登録済みCSVを教師にできないため、未学習ソースでも同じfield/valueが独立した2つのsource familyで一致した場合に限りfieldを確定できる。自己申告の公式ページ1件だけでは確定しない。製作国ラベルの直接記載は国判定に使用できるが、Record化にはタイトル・媒体種別・識別補助項目を含む重要Evidence全体で2系列以上を必須とする。frontier保存時は1ホスト5,000件を上限とし、単一サイトが5万件枠を占有して照合先を押し出さない。

初回台帳はWikidata Query Serviceから1実行最大200行ずつ取得する。対象はanimeの下位classで、`country of origin (P495) = Japan (Q17)` が明示されたItemに限定し、Item label、媒体class、publication dateをEvidenceとして保存する。WikidataとWikipediaは同じ `wikimedia-family` なので相互に2票とは数えず、公開Web上の別系列Evidenceと一致した作品だけをRecord化する。日付または制作会社の一致を優先し、それがない場合もタイトルと媒体種別がそれぞれ独立2系列で一致した時だけ同一作品として扱う。未確認の日付はRecordへ出力しない。offsetと完了状態は `crawler/state.json` に保存し、同じ範囲を無限取得しない。

実作品CSVの本番Commitはまだ行っていない。Geminiは接続経路までは確認済みだが、実生成はGoogle側429解消待ちである。
