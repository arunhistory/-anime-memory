# Webアニメ探索エンジン

## 目的

外部検索APIやGeminiを使わず、公開Webページを機械的に巡回し、Web上の「アニメ作品への言及」から未知の作品候補を発見する。

作品専用ホームページの有無は条件にしない。ニュース、ブログ、ポータル、出版社、放送局、制作会社、配信、動画ページ等も探索入口にできる。DiscoveryとCSV確定は分離し、見つけたページをそのまま事実として採用しない。

## 実行構造

```text
bootstrap seed / 保存済みfrontier
  ↓
URL正規化
  ↓
公開ホスト・公開IP確認
  ↓
robots.txt確認
  ↓
確認済みIPへ接続を固定
  ↓
HTML / XML / RSS / Atom取得
  ↓
本文・title・OGP・JSON-LD・リンクを実行時解析
  ↓
アニメ言及スコアリング
  ↓
一覧/総論ページか単一作品ページか判定
  ↓
ページ主題作品を識別
  ↓
作品候補 + Evidence抽出
  ↓
一次情報直接性 / 別ホスト一致 / conflict判定
  ↓
日本アニメ確認
  ↓
保守的Entity Resolution
  ↓
関連リンクを優先度付きfrontierへ追加
  ↓
別サイトを含め探索範囲を自己拡張
```

## 保存するもの / 保存しないもの

HTML全文、記事本文、画像、動画、検索結果スニペットの複製は探索状態へ保存しない。ページ本文はその実行中の判定にだけ使用する。

`crawler/state.json` には次の探索状態だけを保存する。

- frontier
- 巡回済みURLのSHA-256
- ページURL / ページタイトル / 関連度 / 最終確認時刻
- discovery-only判定
- 作品候補
- Evidenceの `field / value / sourceUrl / sourceClass / rule / observedAt`
- Evidenceから導いた `observed / confirmed / conflict`

作品情報の正本はstateではなく、公開前検証を通った共通CSVである。

## 通信安全性 / SSRF防御

CrawlerはHTTP/HTTPSだけを扱う。認証情報付きURL、localhost、プライベートIP、リンクローカル、メタデータ系アドレス、IPv4-mapped IPv6のprivate宛先を拒否する。

DNS結果にpublic/privateが混在するホストも安全側に拒否する。公開IPを検証した後は通常のfetchで再解決させず、その確認済みIPへ接続を固定する。HTTPSでは元の公開ホスト名をSNI/証明書検証に使用するため、IP固定のためにTLS検証を無効化しない。

Redirect先も再度URL/host/IP条件を確認する。

## robots.txt / 負荷制御

- `robots.txt` を取得し、Disallow/Allowを判定する。
- robots取得が通信エラー等で確認不能の場合、そのホストは安全側に停止する。
- 404/410でrobotsが存在しない場合はその状態を記録して通常判定へ進む。
- Crawl-delayがあれば尊重する。
- 独自の最小アクセス間隔を持つ。
- 1ページの最大取得量、タイムアウト、1回の最大ページ数、1ホストあたりの上限、最大リンク深度を持つ。
- 画像・動画・実行ファイル・アーカイブ等は巡回対象外とする。
- ログイン、Cookie、CAPTCHA、paywall等を回避しない。

robots.txtの許可は利用規約や権利上の利用許諾そのものではない。実データを採用・再配布するときの利用条件、画像権利等は別問題として扱う。

## ページ主題と一覧ページ

一覧、カテゴリ、年表、まとめ、総論のように複数作品を同列に扱うページは `discoveryOnly` とし、リンク発見には利用してもそのページから作品詳細Evidenceを永続化しない。

単一作品ページでは、title / OGP / 明示的な作品名表現からページ主題を識別する。同じページ内に関連作等が書かれていても、主題以外の候補は原則 `title_ja` Evidenceだけを保持する。これにより別作品の日付、制作会社、スタッフ等が混ざることを防ぐ。

URL文字列、一般的な「アニメ」解説文、曖昧な通常文章を作品タイトルとして登録しない回帰試験を持つ。

## Evidence確定

情報源は `primary` / `secondary` に分ける。

直接的な作品公式ページ等、ページ主題と候補作品が一致し一次情報として判断できるページは `primary`。その他のニュース、記事、ブログ等は原則 `secondary` とする。

値の確定条件は次のとおり。

- primaryで直接確認できた同一値 → `confirmed`
- secondaryでも別ホスト2つ以上で同一値 → `confirmed`
- secondary 1ホストだけ → `observed`
- scalar項目で異なる値が存在 → `conflict`、値は空欄

scalar競合は多数決で解決しない。2対1、primary対secondary等でも異なる値が残っている限り自動確定しない。

## 日本アニメ限定ゲート

Crawler内部Evidenceとして `origin_country` を使用する。これは70列CSVへ追加する列ではなく、自動登録可否を決める内部情報である。

日本制作であることがprimaryまたは独立した複数ホストから確認され `origin_country=JP` が `confirmed` になった候補だけをCSV候補へ進める。

`OTHER`、JP/OTHER競合、origin未確認はCSVへ通さない。実Webpilotでも非日本作品が候補に入ること自体は許容し、最終admissionで遮断する。

## Entity Resolution

表記の異なる候補を同一作品へまとめる場合は、似た文字列だけで統合しない。

明示的にconfirmedになったalias関係に加え、同じ `media_type` と、開始日・劇場公開日・アニメーション制作・原作タイトル等のidentity補強を要求する。日本/非日本originの矛盾がある候補は統合しない。

別名側の `title_ja` Evidenceは統合時に `aliases` へ移し、正式タイトル同士のscalar conflictを作らない。

第2期、劇場版、OVA、リメイク等を類似タイトルだけで同一IDにしない。

## 取得フィールド

基本タイトル、媒体、日付、ジャンル、原作、制作・製作、スタッフ、キャラクター/声優、音楽、放送、配信、劇場、エピソード、受賞歴、公式URL等をEvidence化する。

`staff`、`characters`、OP/ED/挿入歌、`broadcast_slots`、`streaming_services`、`episodes`、`episode_staff`、`awards` は共通CSV仕様の固定 `::` 構造で生成する。空の末尾フィールドがある場合も区切りを削除しない。

ジャンルは複数値、原作タグは1作品1値。放送時間帯をジャンルへ混ぜない。

画像は利用条件を確認できない一般Web画像を自動保存・転載しない。`relations` は対象のサイト内部A-IDが確定する前に推測生成しない。

## 探索優先度

アニメ、作品、キャスト、スタッフ、放送、配信、原作、PV等に関連するリンクを優先する。採用、会社概要、問い合わせ、ログイン、カート等は低優先度とする。

関連度の低いページからは有望なリンクだけを辿る。関連度の高いページからは外部ドメインも一定数までfrontierへ追加し、特定サイトだけに閉じない。

## 起点URL

外部検索APIを使わないため最初のリンクグラフへ入る起点URLが必要。`crawler/seeds.txt` またはActionsの `seed_urls` 入力から与える。

`crawler/seeds.txt` にはGitHub Actionsのread-only pilotで実際にrobots/取得が確認できた日本アニメ一覧ページをbootstrap seedとして設定している。これは作品ごとの事実情報源指定ではなく、探索エンジンがWebへ入るための初期ノードである。

以後はページ内リンク、JSON-LD URL、sitemap等から探索範囲を増やす。

## GitHub Actions

`Web Anime Discovery` を `workflow_dispatch` で起動する。Cronは持たない。初期値 `dry_run=true`。

入力は `max_pages`、`max_depth`、`per_host_limit`、追加 `seed_urls`、必要時の `allowed_hosts`。

非dry-run時は `crawler/state.json` だけをCommitする。他ファイルが意図せず変更された場合はCommitを拒否する。mainが同時に進みstateが競合した場合は上書きせず停止する。force pushは使わない。

## 実測

GitHub Actionsのread-only live pilotで実Webへ接続し、モックだけでなく実通信を確認済み。

単一ホスト制限pilotでは14ページ試行、12ページ取得、通信失敗0。非日本作品も候補として発見されたが、日本作品admission gateでCSV登録を遮断した。1ホストだけで日本制作を裏取りできない候補も `japanese-origin-not-confirmed` として安全側に停止した。

複数ホストpilotもrunner内だけで実行し、リポジトリへpilot stateをCommitしない。

## 接続していないもの

- Google / Yahoo / Brave / SerpAPI等の検索API
- Gemini APIによる探索・事実確認
- 外部AI検索

Geminiは探索エンジンから独立しており、現在は概要生成側の実接続もユーザー指示により保留している。
