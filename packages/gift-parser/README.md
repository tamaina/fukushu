# @fukushu/gift-parser

DOM、Vue、Node.js APIに依存しないGIFTパーサーです。公開APIは `parseGift`、`validateGift`、`stringifyGift` です。エラー回復と位置情報を扱いやすくするため、エスケープを認識する手書きスキャナーからSemantic ASTを構築します。

位置情報はoffsetが0始まり、line/columnが1始まりです。ユーザー入力の誤りは原則throwせずdiagnosticsとして返します。
