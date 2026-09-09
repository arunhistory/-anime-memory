# 自動収集パイプライン

この段階では Gemini API を接続しない。外部情報源から確認済み事実を取得し、共通70列CSVへ正規化・重複判定・検証する経路だけを実装する。

## 実行経路

```text
承認済み JSON API
  ↓
GitHub Actions (Anime Data Collect)
  ↓
tools/fetch/http-json.mjs
  ↓
tools/normalize/record.mjs
  ↓
tools/collect/run.mjs
  ↓
tools/validate/data-validator.mjs
  ↓
data/initial-NNN.csv または data/YYYY-QN.csv
  ↓
data/manifest.csv
  ↓
検証成功時のみ Commit
```

Gemini の呼び出し、APIキー参照、概要生成はこの経路に存在しない。`synopsis` は Gemini 接続前の自動収集では空欄に固定する。

## 情報源の扱い

情報源そのものはコードへ固定しない。採用前に API 利用条件、商用利用、再配布、画像利用、取得制限を確認した情報源だけを Repository Variable `ANIME_SOURCE_CONFIG_JSON` へ設定する。

取得器は HTML スクレイピングを実装せず、`transport: "api-json"` の HTTPS JSON API のみ受け付ける。次の確認値がすべて `true` でなければ通信前に停止する。

- `apiTermsChecked`
- `commercialUse`
- `redistribution`
- `imageUse`
- `rateLimitChecked`

## Repository Variable

`ANIME_SOURCE_CONFIG_JSON` は version 1 の JSON とする。

```json
{
  "version": 1,
  "sources": [
    {
      "name": "approved-source",
      "transport": "api-json",
      "url": "https://api.example.invalid/anime",
      "itemsPath": "data.items",
      "externalIdNamespace": "approved-source",
      "externalIdPath": "id",
      "timeoutMs": 20000,
      "requestDelayMs": 250,
      "maxRequests": 100,
      "policy": {
        "apiTermsChecked": true,
        "commercialUse": true,
        "redistribution": true,
        "imageUse": true,
        "rateLimitChecked": true
      },
      "pagination": {
        "type": "page",
        "param": "page",
        "start": 1,
        "hasMorePath": "data.has_more"
      },
      "mapping": {
        "title_ja": "title.native",
        "title_en": "title.english",
        "media_type": {
          "path": "format",
          "mapValues": {
            "TV": "TV",
            "MOVIE": "MOVIE"
          },
          "unknownValue": "OTHER"
        },
        "release_start": "start_date",
        "animation_studio": {
          "path": "studios",
          "valuePath": "name"
        },
        "characters": {
          "path": "cast",
          "fields": ["character", "role", "actor"]
        }
      }
    }
  ]
}
```

上記URLは構造例であり採用情報源ではない。

配列値は `|`、`fields` を指定した配列要素は `::` で組み立てる。データ内の `|`、`::`、バックスラッシュはエスケープする。

認証が必要な API は秘密値を JSON へ書かず、header 設定から環境変数を参照する。

```json
{
  "headers": {
    "Authorization": {
      "env": "ANIME_SOURCE_TOKEN",
      "prefix": "Bearer "
    }
  }
}
```

`ANIME_SOURCE_TOKEN` は Repository Secret として設定する。秘密値そのものは設定JSON、CSV、ログへ保存しない。

## 初期導入

`mode=initial` は既存 `initial-NNN.csv` に追記しない。毎回次の連番ファイルを新規生成し、1回の確定件数を最大450作品に固定する。

外部ID完全一致の既存作品は登録しない。外部IDが一致しない場合でも、正規化タイトル/別名、`media_type`、`release_start`、原作情報または制作会社の複合一致を重複候補として検出し、自動統合せず登録を止める。

## 四半期更新

`mode=quarterly` は `year` と `Q1`〜`Q4` を指定する。`release_start`、`theatrical_release_date`、または `streaming_services` の開始日が対象四半期に含まれる新規作品だけを `YYYY-QN.csv` へ追加する。

既存の非空値は自動上書きしない。既存作品と外部ID完全一致した取得結果は追加しない。不確実な複合重複候補も自動統合しない。

## 失敗時

取得、正規化、CSV生成、重複判定、検証のどこかで失敗した場合は Commit しない。生成直後の検証で失敗した場合は対象ファイルを元状態へ戻す。

GitHubへの確定時は force push を使用しない。処理開始後に `data/` が他の Commit で進んでいた場合は自動確定を中止し、古い状態を基準に上書きしない。

## 実行方法

`Anime Data Collect` は定期実行を持たない。GitHub Actions の `workflow_dispatch` から必要時だけ起動する。初期値は `dry_run=true` で、生成と検証だけを行い Commit しない。

情報源が正式に選定・設定されるまでは収集実行を行わず、パイプラインのコードと回帰試験だけを使用する。
