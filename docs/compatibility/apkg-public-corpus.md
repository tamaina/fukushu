# 公開APKGの実データ互換性検証 — 2026-09-05

12パッケージ・6,559カードを検証し、初回に8パッケージで見つかった互換性問題を修正した。修正後は全12パッケージで解析・ブラウザ保存の検査に合格した。SQLite上のカード件数と変換後の件数、2回の独立した展開・変換の結果ハッシュも一致した。**全カードの表示互換性を保証するものではない。** 表裏の照合は152サンプルを対象としている。

修正前の結果は[baseline](apkg-public-baseline.json)、修正後は[機械可読結果](apkg-public-results.json)に保存している。下表は修正前に見つかった問題の記録であり、現在の未解決一覧ではない。

## 対象と結果

AnkiWebから取得した3件は、取得時の実際の賛成／反対評価を記録した。匿名ダウンロードの上限に達した後、追加取得は「Please log in to download more decks.」で拒否されたため停止した。残り9件はGitHub公開版で補完した。GitHubのstar数はリポジトリの人気であり、個々のデッキのAnkiWeb評価ではない。

| 配布物                                                                                         | 評価・選定根拠            | カード | 結果                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------- | -----: | -------------------------------------------------------------------------------- |
| [Japanese Core 2000 Step 01](https://ankiweb.net/shared/info/114060567)                        | AnkiWeb 515／16           |  1,000 | 検査範囲内OK。画像・音声・保存を確認                                             |
| [Ultimate Geography v5.3](https://ankiweb.net/shared/info/2109889812)                          | AnkiWeb 408／10           |    978 | SVG画像227点が除外され、国旗問題の画像が欠落。PNG地図は表示できる                |
| [Japanese Basic Hiragana](https://ankiweb.net/shared/info/2183294427)                          | AnkiWeb 419／17           |     46 | type-answerの正答が裏面に出ない。元のHTMLにも不正なタグがある                    |
| [Comprehensive astrophysics](https://github.com/MilesCranmer/anki_science)                     | 収集元リポジトリ254 stars |    321 | 検査範囲内OK。本文・保存を確認                                                   |
| [Bayesian Statistics](https://github.com/MilesCranmer/anki_science)                            | 同上                      |     48 | 旧`[$$]…[/$$]`記法を誤解釈。数式の周囲に`]`・`[/`等が表示される                  |
| [Coding Flashcards v1.2.0](https://github.com/ad-si/Coding-Flashcards/releases/tag/v1.2.0)     | 作者リポジトリ756 stars   |  1,027 | 同一GUID＋ordinalが2件あり、保存を拒否。Anki 25.9本体は1,027件をインポートできる |
| [ETH Machine Learning](https://github.com/taivop/anki-decks)                                   | 作者リポジトリ256 stars   |     50 | `[$]…[/$]`等の旧LaTeX記法がそのまま表示される                                    |
| [How to Formulate Knowledge](https://github.com/taivop/anki-decks)                             | 同上                      |    141 | 検査範囲内OK。本文・保存を確認                                                   |
| [Goethe Institute A1 Wordlist](https://github.com/patsytau/anki_german_a1_vocab)               | 作者リポジトリ231 stars   |    926 | 検査範囲内OK。条件付きフィールド・音声・保存を確認                               |
| [Kaishi 1.5k v2.4.2](https://github.com/donkuri/kaishi/releases/tag/v2.4.2)                    | 作者リポジトリ1,489 stars |  1,501 | 容量以外にも`furigana`未対応によるエラーあり。ブラウザ取込は100MiB上限で対象外   |
| [Physics GRE](https://github.com/MilesCranmer/anki_science)                                    | 収集元リポジトリ254 stars |    108 | `[latex]…[/latex]`がそのまま表示される                                           |
| [Probability Theory and Mathematical Statistics](https://github.com/MilesCranmer/anki_science) | 同上                      |    413 | `Subdeck`を未定義フィールドとして扱い保存不可。重複カードキーも2件検出           |

各GitHubファイルの正確なcommit/tag・URL・SHA-256・取得日時は[manifest](apkg-public-manifest.json)に固定している。集計・診断数・サンプル照合・保存件数・実装ファイルのハッシュは[機械可読結果](apkg-public-results.json)に記録している。

## 検証方法と限界

- ソースは実際の配布ファイルを使用。ファイル名変更や一部ノート抽出を成功例の代用にしていない。形式はanki2／anki21／21bを含む。
- Python SQLiteと公式Anki **25.9**で独立にカード件数・ノート型・テンプレート・表裏HTMLを取得。元の画像・音声をAnkiの一時mediaディレクトリへ復元してから参照HTMLを生成した。Anki本体のJavaScriptや第三者テンプレートのスクリプトは実行しない。
- テンプレートordinal、数式、画像、音声、コード等を基準に選び、固定ハッシュによる追加サンプルを加えた**152カード**の表裏を照合。Ankiの再生・入力マーカー、および意図的に変更しているClozeラベルは比較時に考慮する。
- ライブラリでは全カードを2回展開・変換し、メディアを含む結果の署名一致、カード数、重複キー、エラー診断、内部メディア参照を検査。
- ブラウザでは表示、読み込める画像、音声要素、未解釈の数式、typed answer、保存可否・保存件数を確認。SVG・入力問題・旧LaTeXの重要例はスクリーンショットも確認した。音声の波形内容の全件聴取や全カードの目視照合は行っていない。
- 初回のKaishi検証だけは解析側の容量上限を一時拡張していた。修正後はアプリ・解析共通の製品上限を**256MiB**に変更し、例外設定なしでKaishiの1,501カードをブラウザから保存した。累積展開500MiB、SQLite250MiB、メディア単体50MiB、zstd window64MiBの上限は維持している。
- 成功して保存まで進んだケースでは外部通信を検出していない。アドオン依存機能、Image Occlusion、動画など、このコーパスで十分に含まれない形式の互換性は未確認。

## 実施した修正と再検証

1. **重複GUID＋ordinal**は元note/card IDで区別する。Codingの1,027件・Probabilityの413件を保存でき、再取込時のローカルID一致も実ブラウザで確認した。重複の追加・削除・復帰時に既存の学習状態を維持するunitテストも追加した。
2. **`furigana`・`kana`・`kanji`と標準特殊フィールド**を実装。Kaishiのルビ、Probabilityの`Subdeck`を解決し、未知フィールドの誤診断も削減した。
3. **SVG画像**は静的画像としてサニタイズし、内部メディアからBlob URLに解決する。Ultimate GeographyのSVG227点を含むメディア546点を保存・サンプル表示できた。スクリプト・外部画像・foreignObject等を含むSVGでも、実ブラウザで外部通信やスクリプト実行が起きないことを検査した。
4. **旧LaTeX記法**はAnkiのハッシュ規則に従って同梱済み画像を参照する。単純な数式は画像欠落時にKaTeXへフォールバックし、任意TeXのコンパイルは行わない。カード内マクロとClozeを含む数式も共通レンダラーで処理する。Bayesian・ETH・Physics GRE・Probabilityのサンプルで未解釈の記法が残らないことを確認した。
5. **FrontSideに含まれるtype-answer**を裏面コンテキストで展開し、Hiraganaの正答表示を修正した。

回帰検証は通常unit 84件、通常Playwright 20件、公開コーパスunit 13件（対象確認1件＋12パッケージ）、公開コーパスPlaywright 12件が合格した。format・lint・typecheck・production buildも確認した。公開コーパスでの照合範囲を超えたJavaScript・TTS・動画・アドオン機能の再現は保証しない。

## 再実行

リポジトリのルートで実行する。第三者のAPKG本体・参照HTML・スクリーンショットは`.cache/anki-corpus`または`test-results`に置き、Git管理しない。

```sh
node packages/anki-import/scripts/replay-corpus.mjs docs/compatibility/apkg-public-manifest.json .cache/anki-corpus
python packages/anki-import/scripts/corpus-oracle.py .cache/anki-corpus
ANKI_CORPUS_DIR=../../.cache/anki-corpus pnpm --filter @fukushu/anki-import exec vitest run tests/corpus.test.ts
ANKI_CORPUS_DIR=../../.cache/anki-corpus pnpm --filter app exec playwright test e2e/corpus.spec.ts --workers=1
node packages/anki-import/scripts/summarize-corpus.mjs .cache/anki-corpus docs/compatibility
```

Pythonには`anki==25.9`と`zstandard==0.25.0`が必要。既存cacheはハッシュ照合のみで再利用する。取得元が更新されてSHA-256が変わった場合は別スナップショットとして停止し、無言で検証対象を差し替えない。AnkiWeb分を再取得できない場合はログイン済みブラウザから取得し、同じファイル名で配置してハッシュを確認する。ログイン情報をスクリプトへ渡す必要はない。

通常のunit/E2Eは実デッキを自動ダウンロードせず、環境変数で指定した場合だけコーパス検証を実行する。通常テストとコーパス検証の件数は分けて記録する。
