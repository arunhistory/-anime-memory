# 作品確定CSV / 公開用CSV

このリポジトリでは、作品の存在・同一性が確定した段階と、公開可能な情報量まで深掘りが完了した段階を別のCSVで管理する。

## 作品確定CSV

保存先: `confirmed/confirmed.csv`

- 作品の存在・同一性が確定した時点で登録する。
- 共通70列CSVスキーマを使用する。
- 未取得の情報項目は空欄のまま保持できる。
- 内部ID `A########` はここで確定し、その後変更しない。
- 深掘りで新しい確定情報が得られた場合は、空欄だけを補完する。
- 公開用CSVへコピーされた後も行を削除しない。
- 既存公開CSVしか存在しない旧状態からは、既存IDを維持したまま作品確定CSVへ取り込む。

## 公開用CSV

保存先: `data/`

- `data/manifest.csv`
- `data/initial-NNN.csv`
- `data/YYYY-QN.csv`

公開判定を通過した作品だけを格納する。初期公開では未公開の公開可能作品が500件揃った時点で、500件を新しい `initial-NNN.csv` として生成する。既存の初期CSVへ追記しない。

公開用CSVへ入る作品は `confirmed/confirmed.csv` の内部IDをそのまま使用する。公開は作品確定CSVからのコピーであり、作品確定CSV側の行を消費・削除しない。

## 処理順序

```text
作品発見
  ↓
作品同一性の確認
  ↓
confirmed/confirmed.csv へ登録・内部ID確定
  ↓
確定作品名 × 未完成項目で深掘り
  ↓
本文確認・Evidence・独立情報源照合
  ↓
作品確定CSVの空欄を補完
  ↓
公開判定
  ↓
未公開の公開可能作品が500件揃う
  ↓
data/initial-NNN.csv へ同一IDでコピー
  ↓
data/manifest.csv 更新
```

`crawler/pending-initial.json` のような公開待ち専用の別状態は使用しない。作品確定状態は `confirmed/confirmed.csv`、公開状態は `data/` のCSV群を基準とする。
