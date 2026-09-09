# 自動収集パイプライン

公開Web探索で得た作品候補と複数ページのEvidenceから、確定できる事実だけを共通70列CSVへ渡し、その確定済み事実からGeminiでサイト独自 `synopsis` を生成する。

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
別ホスト間で事実照合
  ↓
crawler/state.json
  ↓
GitHub Actions (Anime Data Collect / input=discovery)
  ↓
confirmed の事実だけ共通70列Recordへ変換
  ↓
既存作品との重複候補判定
  ↓
Gemini概要生成（実収集時のみ）
  ↓
initial-NNN.csv / YYYY-QN.csv
  ↓
全CSV検証
  ↓
検証成功時だけ Commit
```

Geminiは作品探索や事実確定には使わない。入力するのはCSV候補Recordの確定済み非空値だけで、外部から取得した既存概要文をそのまま `synopsis` として保存しない。

## Discovery入力

`Anime Data Collect` の標準入力は `discovery`。`crawler/state.json` の候補からCSV化できるものだけを取得する。

Evidence はページ本文の複製ではなく、`field / value / sourceUrl / rule / observedAt` の最小情報として保持する。同じ値が別ホストから確認された場合に `confirmed` とし、単独ホストだけなら `observed`、競合する値が解消できない場合は `conflict` とする。

CSVへ渡すのは `confirmed` だけ。`observed` と `conflict` は自動確定しない。現在のEvidence抽出対象は、作品名、媒体種別、放送・公開開始日、劇場公開日、ジャンル、原作タグ、アニメーション制作、監督、シリーズ構成、キャラクターデザイン、音楽、音響監督。残りの70列項目は同じEvidence方式へ順次拡張する。

CSV登録候補になるには、少なくとも作品名と媒体種別が複数ホストで確認済みで、さらに開始日・劇場公開日・アニメーション制作のいずれかに確認済みの識別補強情報が必要。根拠が不足している候補は `crawler/state.json` に残し、追加探索を待つ。

## ジャンルと原作タグ

分類定義は `tools/discovery/taxonomy.mjs` を正本とする。

`genres` は複数指定可能で、共通CSVでは `|` 区切りで保存する。アニメを実際に探す用途を優先し、一般的な大分類だけでなく、学園、ほのぼの、百合、BL、ラブコメ、異世界、魔法少女、ロボット等のアニメ検索で重要な系統も正式ジャンルとして扱う。Web上の表記揺れは正式ジャンルへ正規化する。

ジャンルEvidenceは値ごとに独立して照合する。同一ジャンルが別ホスト2つ以上から確認された場合にそのジャンルを `confirmed` とし、確定した複数ジャンルだけを `genres` へ保存する。

原作タグは70列の `original_type` を使用し、1作品につき1つだけ保存する。正式値には、オリジナル、漫画系、4コマ漫画系、ライトノベル系、Web小説系、なろう系、カクヨム系、一般小説系、児童文学系、ゲーム系、ソーシャルゲーム系、ノベルゲーム系、カードゲーム系、玩具系、特撮系、舞台系、音楽系、キャラクター企画系、メディアミックス、その他を使用する。

原作の出自が明示されている場合は出自を優先する。たとえば「小説家になろう発で、その後ライトノベルとして書籍化」と確認できる場合、`original_type` は `なろう系` の1値とし、`なろう系|ライトノベル系` のような複数値は認めない。複数の原作タグ候補がEvidence上で競合し確定できない場合は `conflict` としてCSVへ入れない。

`深夜アニメ`、`朝アニメ`、`夕方アニメ`、`ゴールデン帯` 等の放送時間帯はジャンルにも原作タグにも使用しない。放送時間に関する事実を保持する場合は既存の `broadcast_slots` を使用し、分類体系とは分離する。

`tools/validate/data-validator.mjs` は、未定義ジャンル、ジャンル重複、未定義原作タグ、`original_type` の複数指定を不正として拒否する。原作タグをジャンルとして誤抽出しない回帰試験も `tools/discovery/taxonomy-self-test.mjs` で実施する。

## Gemini概要生成

Gemini処理は `tools/gemini/synopsis.mjs` に分離する。GitHub Actions Repository Secret `ANIME_GEMINI_API_KEY` をサーバー側だけで読み取り、Pages、ブラウザJavaScript、CSV、ログへAPIキーを出さない。

標準モデルは `gemini-3.5-flash-lite`。必要な場合だけ Repository Variable `ANIME_GEMINI_MODEL` で差し替えられる。Gemini Interactions APIを使用し、Google Search groundingやその他のツールは有効化しない。

概要生成は空の `synopsis` を持つ作品につき最大1回。既に `synopsis` があるRecordは上書きせず、そのまま保持する。1実行のGemini呼び出しは最大450件に固定する。

429、5xx、ネットワーク障害、応答JSON不正、概要空欄などが起きた場合は同じ作品をその場で再送せず安全停止する。それ以前に正常生成できた作品だけを後段へ残す。401、403、400など設定・認証系の恒常エラーは処理全体を失敗させる。

`dry_run=true` ではGeminiを呼ばない。`dry_run=false` の実収集時だけ `--gemini true` を渡すため、確認用dry-runでGemini枠を消費しない。

## 既存JSON API入力

以前実装したHTTPS JSON API取得器は互換経路として残している。`Anime Data Collect` で `input=api-json` を明示した場合だけ使用する。標準経路ではない。

`api-json` を使う場合だけ Repository Variable `ANIME_SOURCE_CONFIG_JSON` と、必要なら Repository Secret `ANIME_SOURCE_TOKEN` を参照する。APIキー等の秘密値を設定JSON、CSV、ログへ直接保存しない。

API取得器は採用前にAPI利用条件、商用利用、再配布、画像利用、取得制限を確認済みの情報源だけを受け入れる。`transport: "api-json"` のHTTPS JSON API以外はこの互換取得器では扱わない。

## 重複判定

外部IDがある入力では `source::id` の完全一致を最優先する。外部IDがないDiscovery入力を含む複合判定では、正規化したタイトル/別名、`media_type`、開始日または劇場公開日、原作情報またはアニメーション制作の一致を使う。

不確実な重複候補は自動統合しない。既存CSVの正常データを上書きして解決しない。

## 初期導入

`mode=initial` は既存 `initial-NNN.csv` に追記しない。毎回次の連番ファイルを新規生成し、1回の確定件数を最大450作品に制限する。

設計上の「1日最大450作品」を複数実行を跨いで保証する日次ガードはまだ未実装のため、実運用開始前に追加検証が必要。

## 四半期更新

`mode=quarterly` は `year` と `Q1`〜`Q4` を指定する。`release_start`、`theatrical_release_date`、または `streaming_services` の開始日が対象四半期に含まれる新規作品だけを `YYYY-QN.csv` へ追加する。

既存の非空値は自動上書きしない。不確実な重複候補も自動統合しない。

## 失敗時

取得、Evidence変換、重複判定、Gemini概要生成、CSV生成、検証のどこかで致命的に失敗した場合は Commit しない。生成後の検証に失敗した場合は対象CSVとmanifestを元状態へ戻す。

GitHubへの確定時は force push を使用しない。処理開始後に `data/` が別Commitで進んでいた場合は自動確定を中止し、古い状態を基準に上書きしない。

## 実行方法

`Web Anime Discovery` と `Anime Data Collect` はどちらも `workflow_dispatch` のみで、Cronは持たない。`Anime Data Collect` の初期値は `dry_run=true`。

実Web探索用の起点はまだ未設定で、モックWebを使った回帰試験とパイプライン検証まで実測済み。登録済み `ANIME_GEMINI_API_KEY` はGitHub Actionsへ渡され、実Gemini APIへのリクエスト到達までは確認済みだが、疎通試験はHTTP 429で安全停止しており概要生成成功はまだ未確認。実作品収集もまだ実行していない。
