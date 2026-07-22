# Storage schema

IndexedDB `gift-fsrs-learning` schema version 1には `decks`、`questions`、`studyStates`、`reviewLogs`、`settings`、`imports` を置きます。レビュー履歴は追記専用です。FSRSライブラリ型はadapterでISO文字列を用いる保存型へ変換します。

JSONバックアップversion 1は設定、問題集、問題、学習状態、レビュー履歴を含みます。復元時はValibotで外部入力を検証します。
