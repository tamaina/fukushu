# Fukushu

GIFT形式の問題集をブラウザへ読み込み、FSRSで復習時期を決定するローカルファースト学習SPAです。問題集・学習履歴はIndexedDBへ保存し、サーバーへ送信しません。

## 開発

Node.js 22以上とpnpm 11を使用します。

```sh
pnpm install
pnpm dev
pnpm check
pnpm test:e2e
```

`packages/app/wrangler.jsonc` はStatic Assets専用で、Workerスクリプトを持ちません。`pnpm deploy` でデプロイします。

## 採用技術

- Vue 3 / Vue Router / Vite / TypeScript
- IndexedDB (`idb`) / `ts-fsrs`
- DOMPurify / Marked / Valibot
- Vitest / Playwright
- Cloudflare Vite Plugin・Wrangler（Static Assets配信）

GIFTパーサーはDOMやアプリから独立した `packages/gift-parser` にあります。エスケープを認識する手書きスキャナーを採用し、不正入力を例外ではなく診断値として返します。

## 対応範囲

単一・複数選択、True/False、短答、数値（完全一致・許容誤差・範囲）を出題できます。Matching、Essay、Descriptionは失わず保存しますが、初版では出題対象外です。
