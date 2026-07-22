# GIFT support

対応: コメント、`$CATEGORY`、問題名、plain/html/markdown、単一・複数選択、部分点・負点、True/False、短答、Matching、数値 exact/tolerance/range、Essay、Description、feedback、基本エスケープ、BOM/CRLF/日本語。

Matching、Essay、Descriptionは読み込み・保存しますが出題しません。HTMLとMarkdownはDOMPurifyでsanitizeし、画像・SVG・フォーム・埋め込み要素を禁止します。1ファイル10MB、1デッキ20,000問、問題文100KB、解答候補100件を上限とします。
