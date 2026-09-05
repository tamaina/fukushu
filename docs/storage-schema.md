# Storage schema

IndexedDB `gift-fsrs-learning` schema version 7には `importSources`、`decks`、`questions`、`studyStates`、`reviewLogs`、`settings`、`imports`、`media` を置きます。`importSources` と `decks` は1対多です。APKG sourceは元Blob、世代、進捗取込設定、revisionを保持します。カードはsource内のGUID＋ordinal、deckはAnki deck IDで対応させ、移動・改名でも既存IDを維持します。メディアは展開後SHA-256で共有し、カード本文には内部IDのみ保存します。

APKG更新は差分とFSRS再生結果を準備してから全storeを一括保存します。準備時のsnapshotと保存時の状態が違えば再確認を要求します。削除カードはsourceRemovedで停止し、履歴・FSRSを保持します。manualSuspendedで手動停止を区別します。進捗オフでは既存履歴とFSRSを維持し、オンでは取込対象カードだけ履歴を置換します。Anki由来のログにはsourceId、cardId、revlogIdを保存します。

旧APKGデータは起動時に元Blobから表示情報を再構築し、履歴を維持します。元Blobがない、または再解析できない場合はneedsReimportを表示します。FSRSライブラリ型はadapterでISO文字列を用いる保存型へ変換します。

JSONバックアップversion 3は設定、問題集、問題、学習状態、レビュー履歴、元APKG、テンプレートメタデータ、メディアを含みます。version 1・2も復元できます。復元時はValibot、メディアのサイズ・SHA-256、内部参照、HTML/CSSの検査を行います。
