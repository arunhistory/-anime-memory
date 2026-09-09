# UI / WASM 接続境界

この文書は、4つの公開HTMLとWASMの責務境界を固定する。

## 公開ページは4ファイルに物理分離

- `index.html` — TOP。WASM・作品CSVを読み込まない。
- `search.html` — 検索。`search.wasm` だけを使用する。
- `all.html` — 全作品。`all.wasm` だけを使用する。
- `detail.html?id=A00000001` — 詳細。内部ID完全一致取得のため `search.wasm` を使用する。

旧 `search/index.html`、`all/index.html`、`detail/index.html` は公開ページとして使用しない。4画面を1つのHTMLへ統合しない。

## JavaScript原則

JavaScriptは次だけを担当する。

1. UI入力を収集する
2. WASMへ渡す
3. WASMから返った表示用結果をDOMへ描画する
4. ローディング、0件、エラー等の画面状態を表示する
5. 内部IDから現行 `detail.html?id=...` への画面遷移を構成する

JavaScriptは次を行わない。

- CSV解析
- 正規化
- 検索一致判定
- AND / OR / NOT の意味解釈
- 日付・数値範囲判定
- クール判定
- 総時間計算
- 検索結果ソート
- 全件一覧ソート

## 検索ページ `search.html`

検索実行時のUI運搬形式:

```text
{
  query: string,
  operator: "AND" | "OR",
  textTerms: [...],
  dateRanges: [...],
  numberRanges: [...],
  sort: {
    key: "season" | "date" | "title" | "studio" | "episodes" | "runtime",
    direction: "asc" | "desc"
  }
}
```

各条件のNOTは条件単位で保持する。実際の一致判定・範囲判定・ソートは `search.wasm` が行う。

`search.html` は `all.wasm` / `all-bridge.js` を読み込まない。

## 全件表示ページ `all.html`

```text
{
  key: "season" | "date" | "title" | "studio" | "episodes" | "runtime",
  direction: "asc" | "desc"
}
```

実際の並び替えは `all.wasm` が行う。

全件処理は `all.html` を開いた時だけ起動する。TOP・検索・詳細ページへ全件読込処理を持ち込まない。

段階描画は全件ページ上で一定件数ずつDOMへ追加するためのUI境界である。

## 詳細ページ `detail.html?id=A00000001`

JavaScriptはURLから内部IDを受け取り、`search.wasm` の内部ID完全一致取得へ渡す。CSVから作品を探さない。

作品カードはWASM結果の `id` を使用し、必ず `detail.html?id=<内部ID>` へ遷移する。IDがないカードを正常な作品リンクとして扱わない。

## 共通カード描画

`window.AnimeUI.createAnimeCard()` はWASM処理後の表示用データだけを受け取る。

```text
{
  id: string,
  title: string,
  subtitle: string,
  tags: string[],
  imageUrl: string,
  imageAlt: string
}
```

DOMへの文字列挿入は `textContent` を使用する。画像URLはHTTP / HTTPSだけ許可する。作品詳細遷移は同一オリジンの `detail.html` に限定する。

## エラーの責務

UIは最低限、次の状態を表示できるようにする。

- WASMロード失敗
- CSV取得失敗
- CSV破損
- 不正入力
- 検索0件
- 全件読込中
- 全件読込完了
- 詳細ID未指定
- 対象作品未取得

原因判定そのものがWASMまたは取得処理側の責務である場合、JavaScriptは判定済み状態を表示するだけとする。
