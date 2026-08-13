# Architecture

2 packageのpnpm workspaceです。`gift-parser` はGIFT sourceからSemantic ASTまでを担当します。`app` はGIFT ASTまたはAnki CSV／TSVを固有Quizモデルへ変換し、application層を介してIndexedDB repositoryとFSRS adapterを利用します。VueコンポーネントはIndexedDBやts-fsrsを直接操作しません。

Ankiテキストの解析とカード生成はapplication層に置きます。ZIPメディアはインポート時に安全なdata URLへ変換されるため、生成後の問題はGIFT由来と同じ表示・バックアップ経路を利用できます。

すべての実処理はブラウザ内で完結します。Worker API、アカウント、クラウド同期、解析SDKはありません。
