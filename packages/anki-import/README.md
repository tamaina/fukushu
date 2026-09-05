# @fukushu/anki-import

ブラウザ向けAnkiパッケージ読込ライブラリ。ZIP/zstd制限、SQLite schema 11/18、protobuf、テンプレート解釈、HTML/CSSの検査、メディア検証を担当します。Vue、Fukushuのカード型、IndexedDB、FSRS、GIFT parserには依存しません。

## APIと実行環境

- `@fukushu/anki-import/archive` の `decodeArchive(bytes, { wasmUrl })`: ZIPとSQLiteを読み、structured clone可能な中間データを返します。DOM不要でworkerから利用できます。WASM URLまたはNodeでのパスはホストが指定します。
- `@fukushu/anki-import` の `convertArchive(decoded, options?)`: DOM環境でテンプレートとメディアを変換し、`AnkiPackage`を返します。`signal`と`onProgress`を受け付けます。
- `parseApkg(bytes, { wasmUrl, ...options })`: 上記2段階を連続実行する簡易API。workerの作成・終了は行いません。
- `@fukushu/anki-import/safety`: `safeAnkiHtml` / `safeAnkiCss`。表示時・バックアップ復元時にも同じ検査を利用できます。

`AnkiPackage`にはAnki deck ID、GUID＋ordinalによるカードキー、表裏HTML、描画方式、元テンプレート、review履歴、メディアのバイト列、独立した診断型が含まれます。FukushuのIDや保存レコードは生成しません。診断に架空のソース行番号は付けません。

カード由来の診断にはdeck名・カードキー・問題文の抜粋を付けます。文章中心のテンプレートには、装飾を省略したplain/Markdownの変換候補を返します。採用はホスト側で選択し、隠し要素・メディア・複雑な構造は変換しません。問題がないdeckは名前に関係なく結果から除外します。

内部メディア参照は既存データとの互換性のため`fukushu-media:<SHA-256>`を維持しています。参照をBlob URLへ解決する処理と、独自テンプレートを安全なiframeで表示する処理はホスト側の責務です。サニタイズだけでHTML/CSSの画面への影響を隔離できるわけではありません。

`app`はworkerの起動とキャンセル、WASM/PWA資産の接続、Fukushuカードへの変換、Blob化、ソース照合、履歴再構築、一括保存を担当します。SQLiteのWASMをバンドルするため、`app`にも`sql.js`をビルド用devDependencyとして保持しています。

## 検証

`pnpm --filter @fukushu/anki-import test`でAnki形式・テンプレート・安全性を単独検証できます。公式Anki fixtureと生成手順は[tests/fixtures](tests/fixtures/README.md)にあります。アプリ側ではID変換、保存・更新、FSRS、バックアップの統合テストとPlaywrightを実行します。
