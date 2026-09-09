# 自動収集パイプライン

公開Web探索で得た作品候補とEvidenceから、確定できる事実だけを共通70列CSV候補へ渡す。Geminiはサイト独自 `synopsis` の生成専用で、現在はユーザー指示により実接続を後工程へ保留している。

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
ページ主題分離 / 日本アニメ確認 / 一次情報または別ホスト照合
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
初期導入24時間上限 / 四半期所属判定
  ↓
[Gemini接続後のみ] synopsis生成
  ↓
initial-NNN.csv / YYYY-QN.csv
  ↓
全CSV検証
  ↓
検証成功時だけ Commit
```

Geminiを使用しない現在の既定実行では `gemini=false` とし、API呼び出しもGemini用quota予約も行わない。

## Discovery入力

`Anime Data Collect` の標準入力は `discovery`。`crawler/state.json` の候補からCSV化できるものだけを取得する。

Evidenceはページ本文の複製ではなく、`field / value / sourceUrl / sourceClass / rule / observedAt` の最小情報として保持する。HTML本文、記事全文、画像、動画はstateへ保存しない。

情報源は `primary` / `secondary` に分ける。作品主題と一致する直接的な公式作品ページ等を一次情報として扱い、一次情報で直接確認できた値、または別ホスト2つ以上から一致確認できた値を `confirmed` とする。単独の二次情報は `observed`。scalar値に異なる候補が存在する場合は、2対1等の多数決をせず `conflict` として値を空欄にする。

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

`genres` は複数指定可能で、共通CSVでは `|` 区切りで保存する。学園、ほのぼの、百合、BL、ラブコメ、異世界、魔法少女、ロボット等を含め、Web表記揺れを正式ジャンルへ正規化する。同一ジャンルが一次情報または独立した複数ホストから確認された場合だけ確定する。

原作タグは `original_type` を使用し、1作品につき1つだけ保存する。オリジナル、漫画系、4コマ漫画系、ライトノベル系、Web小説系、なろう系、カクヨム系、一般小説系、児童文学系、ゲーム系、ソーシャルゲーム系、ノベルゲーム系、カードゲーム系、玩具系、特撮系、舞台系、音楽系、キャラクター企画系、メディアミックス、その他を扱う。

出自が明示される場合は出自を優先する。例として「小説家になろう発で、その後ライトノベルとして書籍化」は `なろう系` 1値とし、`なろう系|ライトノベル系` のような複数値は拒否する。

`深夜アニメ`、`朝アニメ`、`夕方アニメ`、`ゴールデン帯` 等の放送時間帯はジャンルにも原作タグにも使用しない。放送時間情報は `broadcast_slots` として分離する。

## 重複・Entity Resolution

外部IDがある入力では `source::id` の完全一致を最優先する。外部IDがないDiscovery入力では、正規化タイトル/別名、`media_type`、開始日または劇場公開日、原作情報またはアニメーション制作等の組合せを使う。

Web探索state内で異なるタイトル候補を1作品へまとめる場合も、明示的に確認済みのalias関係に加え、媒体と開始日・制作会社等のidentity一致を要求する。表記が似ているだけでは統合しない。日本/非日本のorigin競合がある候補も統合しない。

不確実な候補は自動統合・既存値上書きをしない。

## 初期導入

`mode=initial` は既存 `initial-NNN.csv` に追記しない。毎回次の連番ファイルを新規生成する。

1回450件だけでなく、`tools/collect/initial-budget.mjs` がGit履歴から**直近24時間に新規追加された `initial-NNN.csv` の作品数**を数える。残り枠だけを新規候補へ割り当て、複数実行を跨いでも450作品を超えない。既に履歴上450を超えている状態を検出した場合は安全停止する。

この上限管理のために追加DB、Cron、永続quotaテーブルは作らない。Git履歴そのものを実測基準にする。

## 四半期更新

`mode=quarterly` は `year` と `Q1`〜`Q4` を指定する。`release_start`、`theatrical_release_date`、または `streaming_services` の開始日が対象四半期に含まれる新規作品だけを `YYYY-QN.csv` へ追加する。

既存の非空値は無条件上書きしない。不確実な重複候補も自動統合しない。

## Gemini概要生成 — 現在保留

Gemini用コードは `tools/gemini/` に隔離され、Web探索・Evidence確定とは接続しない。`Anime Data Collect` の入力 `gemini` は既定 `false`。

現段階ではGeminiの実API接続、モデル/API経路の最終決定、実 `synopsis` 生成を行わない。接続工程へ進んだ時点で現行の公式仕様を確認し、APIキーをGitHub Actions Secretからサーバー側だけで使用する。Pages、ブラウザJavaScript、CSV、ログへキーを出さない。

## 既存JSON API入力

HTTPS JSON API取得器は互換経路として残している。`Anime Data Collect` で `input=api-json` を明示した場合だけ使用する。標準経路は `discovery`。

`api-json` を使う場合だけ Repository Variable `ANIME_SOURCE_CONFIG_JSON` と、必要なら Repository Secret `ANIME_SOURCE_TOKEN` を参照する。秘密値を設定JSON、CSV、ログへ直接保存しない。

## 失敗時・競合時

取得、Evidence変換、重複判定、CSV生成、検証のどこかで致命的に失敗した場合はCommitしない。生成後の検証に失敗した場合は対象CSVとmanifestを元状態へ戻す。

GitHubへの確定時はforce pushを使用しない。処理開始後に `data/` が別Commitで進んでいた場合は自動確定を中止し、古い状態を基準に上書きしない。Actions側も同系統の書込みを `concurrency` で直列化する。

## 実行方法と実測状況

`Web Anime Discovery` と `Anime Data Collect` は `workflow_dispatch` のみで、Cronは持たない。`Anime Data Collect` は `dry_run=true`、`gemini=false` が既定値。

`crawler/seeds.txt` には実測済みbootstrap seedが設定されている。GitHub Actionsのread-only live pilotで、robots、公開IP確認、DNS pinning、取得量制御、HTML解析、候補抽出、日本アニメgate、Evidence確定条件を実Webに対して確認している。

実作品CSVの本番CommitとGemini実接続はまだ行っていない。
