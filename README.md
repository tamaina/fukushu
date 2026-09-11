# Fukushu

自分の問題集を読み込んで、忘れる前に復習するための学習アプリです。GIFT・Ankiの問題集に対応し、回答結果に応じてFSRSが次の復習時期を決めます。

**[アプリを開く](https://fukushu.aqz.workers.dev)** · [APKGの対応範囲](docs/apkg-support.md) · [GIFTの対応範囲](docs/gift-support.md)

## できること

- **手持ちの教材で学習**：選択問題、短答、数値、組み合わせ問題、フラッシュカードなどを読み込めます。
- **復習時期を自動調整**：正誤や自己評価に応じてFSRSが復習日を計算します。学習履歴も確認できます。
- **ブラウザ内に保存**：アカウント登録は不要。問題集・メディア・学習履歴はIndexedDBに保存し、サーバーへ送信しません。
- **バックアップと端末移行**：「設定」のバックアップから書き出し・復元できます。端末間の自動同期はありません。

## 使い方

1. 「問題集を読み込む」でファイルを選ぶか、問題のテキストを貼り付けます。
2. プレビューと診断を確認して保存します。Anki CSV／TSVでは列の割り当て、APKGでは履歴取込の有無も選べます。
3. 保存した問題集で学習し、復習を続けます。

まず試す場合は[samples/import](samples/import)のサンプルを利用できます。ブラウザのデータを削除すると学習データも失われるため、定期的にバックアップしてください。

## 読み込める形式

| 形式             | 主な対応内容                                                                                       | 詳細                                                |
| ---------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| GIFT             | 単一・複数選択、True/False、短答、Matching、数値、Essay、Description。数式・フィードバックにも対応 | [GIFT対応範囲](docs/gift-support.md)                |
| Anki APKG        | 標準カード、Cloze、静的な独自テンプレート、画像・音声、学習履歴、再取込による更新                  | [APKG互換性](docs/apkg-support.md)                  |
| Anki互換CSV／TSV | Basic、表裏反転、任意の反転、入力回答、Cloze。列の割り当てを変更可能                               | [サンプル](samples/import)                          |
| メディア入りZIP  | Anki互換CSV／TSVと参照画像・音声をまとめて読み込み                                                 | [サンプルZIP](samples/import/sample-anki-media.zip) |

Ankiテキストでは`#separator`、`#html`、`#columns`とdeck／notetype／tags／GUID列を解釈します。独自テンプレートやCSSを含む教材にはAPKGを利用してください。

Matchingは自動採点、Essayは回答後に自己評価、Descriptionは学習カードとして利用できます。APKGは最大256MiBです。AnkiのJavaScript・アドオンやスケジューラーを完全に再現するものではなく、表示や次回復習日が異なる場合があります。

## 開発

Node.js 22以上とpnpm 11を使用します。

```sh
pnpm install
pnpm dev
```

検証とビルド：

```sh
pnpm check       # 整形・lint・型検査・unitテスト・ビルド
pnpm test:e2e    # Playwrightによるブラウザテスト
```

Playwrightのブラウザが未導入の場合は、`pnpm --filter app exec playwright install chromium`を実行してください。公開APKGを使う追加検証は[互換性レポート](docs/compatibility/apkg-public-corpus.md)に手順を記載しています。

Cloudflare WorkersのStatic Assetsへ配信します。Cloudflare認証を済ませた環境で、ビルドしてからデプロイします。

```sh
pnpm build
pnpm --filter app exec wrangler deploy --keep-vars
```

設定は[wrangler.jsonc](packages/app/wrangler.jsonc)にあります。サーバー側のAPIやWorkerスクリプトは持ちません。

## 構成

| パッケージ                                               | 役割                                                |
| -------------------------------------------------------- | --------------------------------------------------- |
| `packages/app`                                           | Vueアプリ、保存、FSRS、メディア表示、インポート画面 |
| `packages/gift-parser`                                   | アプリから独立したGIFTパーサー                      |
| [`packages/anki-import`](packages/anki-import/README.md) | APKG解析、テンプレート変換、HTML／CSS・メディア検証 |

Vue 3・Vue Router・Vite・TypeScript、IndexedDB（idb）・ts-fsrs、DOMPurify・Marked・KaTeXを使用しています。検証にはVitestとPlaywrightを利用します。

## ドキュメント

- [アーキテクチャ](docs/architecture.md)
- [ストレージ構成](docs/storage-schema.md)
- [FSRSの評価・日時の扱い](docs/fsrs-mapping.md)
- [プライバシー](docs/privacy.md)
- [公開APKGの互換性検証](docs/compatibility/apkg-public-corpus.md)
- [Kaishiの性能測定](docs/compatibility/kaishi-performance.md)
