# UI / WASM 接続境界

この文書は、画面側JavaScriptと将来接続するWASMの責務境界を固定する。

## 原則

JavaScriptは次だけを担当する。

1. UI入力をそのまま収集する
2. WASMへ渡す
3. WASMから返った表示用結果をDOMへ描画する
4. ローディング、0件、エラー等の画面状態を表示する

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

## 検索ページ

### `anime-search-request`

検索実行時に発火するUIイベント。

```text
{
  query: string,
  operator: "AND" | "OR" | "NOT",
  categories: string[],
  sort: {
    key: "season" | "date" | "title" | "studio" | "episodes" | "runtime",
    direction: "asc" | "desc"
  }
}
```

これはUI入力の運搬形式であり、JavaScriptが検索条件を解釈した結果ではない。

### `anime-search-sort-change`

検索結果の並び替えUI変更時に発火する。

```text
{
  key: "season" | "date" | "title" | "studio" | "episodes" | "runtime",
  direction: "asc" | "desc"
}
```

実際の並び替えは `search.wasm` が行う。

### `window.AnimeSearchUI`

- `getRequest()` — 現在のUI入力を取得
- `setMessage(type, text)` — 状態メッセージ表示
- `setResultMeta(title, note)` — 件数・補足表示領域を更新
- `setBusy(boolean)` — 結果領域のbusy状態を更新
- `setEmpty(title, note, icon)` — 0件・初期・エラー等の空状態表示
- `renderCards(cards)` — 表示用カード配列をDOMへ描画

## 全件表示ページ

### `anime-all-sort-request`

```text
{
  key: "season" | "date" | "title" | "studio" | "episodes" | "runtime",
  direction: "asc" | "desc"
}
```

実際の並び替えは `all.wasm` が行う。

### `window.AnimeAllUI`

- `setStatus(state, title, note)` — idle / loading / done / error の状態表示
- `setBusy(boolean)` — 一覧領域のbusy状態を更新
- `setEmpty(title, note, icon)` — 空状態表示
- `replaceCards(cards)` — 一覧を置換
- `appendCards(cards)` — 段階描画用にカードを追記
- `getSortRequest()` — 現在のソートUI入力を取得

`appendCards()` は「1ページ上へ全件表示しつつ、内部では一定件数ずつ段階描画する」ためのUI境界である。

## 詳細ページ

URL形式:

```text
/detail/?id=A00000001
```

### `anime-detail-request`

```text
{
  id: string,
  match: "exact"
}
```

JavaScriptはIDをURLから受け取るだけで、CSVから作品を探さない。

`search.wasm` が内部ID完全一致で1作品を取得する。

### `window.AnimeDetailUI`

- `id` — URLから受け取った内部ID
- `setStatus(type, text)` — 詳細画面の状態表示
- `setTitle(value)` — タイトル表示更新
- `setHero(data)` — タイトル、補助タイトル、概要、タグ、画像を表示
- `setSectionVisibility(sectionId, visible)` — 情報が存在するカテゴリだけ表示
- `setSectionItems(sectionId, items)` — 判定済みの表示項目をカテゴリへ描画

`setHero()` と `setSectionItems()` は表示済み形式だけを受け取る。作品情報の解釈、推測、正規化は行わない。

`setSectionItems()` の表示用形式:

```text
[
  {
    label: string,
    value: string,
    href?: string
  }
]
```

`href` はHTTP / HTTPSだけDOMへリンクとして設定する。

## 共通カード描画

`window.AnimeUI.createAnimeCard()` は、WASM処理後の表示用データだけを受け取る。

```text
{
  href: string,
  title: string,
  subtitle: string,
  tags: string[],
  imageUrl: string,
  imageAlt: string
}
```

この表示用データを作るためにJavaScript側でCSVを解析したり、クール・総時間・検索一致度等を計算してはならない。

画像URLはDOMへ設定する前にHTTP / HTTPSのみ許可する。

DOMへの文字列挿入は `textContent` を使用し、取得データをHTML文字列として直接挿入しない。

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
