# Architecture

2 packageのpnpm workspaceです。`gift-parser` はGIFT sourceからSemantic ASTまでを担当します。`app` はASTを固有Quizモデルへ変換し、application層を介してIndexedDB repositoryとFSRS adapterを利用します。VueコンポーネントはIndexedDBやts-fsrsを直接操作しません。

すべての実処理はブラウザ内で完結します。Worker API、アカウント、クラウド同期、解析SDKはありません。
