# Architecture

3 packageのpnpm workspaceです。`gift-parser` はGIFT sourceからSemantic ASTまでを担当します。`anki-import` はAPKGのアーカイブ・SQLite解析、Ankiテンプレート解釈、HTML/CSS・メディア検証を担当し、アプリ非依存のAnki型を返します。`app` はそれぞれの結果を固有Quizモデルへ変換し、application層を介してIndexedDB repositoryとFSRS adapterを利用します。

Ankiテキストの解析とカード生成はapplication層に置きます。ZIPメディアはインポート時に安全なdata URLへ変換されるため、生成後の問題はGIFT由来と同じ表示・バックアップ経路を利用できます。

APKGは`anki-import/archive`をブラウザのWeb Workerから利用し、DOM環境で`convertArchive`を実行します。workerの起動・終了、WASM URL、PWAキャッシュはappが管理します。パッケージにはVue、IndexedDB、FSRS、GIFTへの依存を持たせません。APKGメディアは内部IDで参照し、appがBlob URLへ解決します。独自テンプレートはappの隔離iframeで描画します。パッケージ単体のテスト・公式fixtureと、appの保存・学習統合テストを分けています。

すべての実処理はブラウザ内で完結します。サーバー側API、アカウント、クラウド同期、解析SDKはありません。
