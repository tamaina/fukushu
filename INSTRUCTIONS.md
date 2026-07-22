# GIFT＋FSRS学習アプリ 実装指示書

## 1. 目的

GIFT形式で人間またはLLMが作成した問題集をブラウザへ読み込み、問題ごとの学習履歴を端末内に保存し、FSRSによって復習時期を決定する学習用SPAを実装する。

このアプリ自身には、問題を生成する機能を実装しない。

問題作成は、以下の外部手段に任せる。

- 人間がテキストエディタでGIFTを記述する
- LLMにGIFTを生成させる
- MoodleなどからGIFTを書き出す
- 将来的な外部エディタからGIFTを受け取る

アプリの責務は以下に限定する。

1. GIFTファイルを読み込む
2. GIFTを解析・検証する
3. 問題集として端末内へ保存する
4. 問題を出題・採点する
5. 解答結果をFSRS評価へ変換する
6. FSRSに基づいて次回出題日時を決定する
7. 学習履歴を端末内へ保存する
8. データをエクスポート・復元できるようにする

## 2. 重要な前提

### 2.1 SPAのみで完結させる

すべての実処理をブラウザ内で行うこと。

以下は使用しない。

- Worker API
- D1
- KV
- R2
- Durable Objects
- Queues
- Workflows
- サーバー側セッション
- ユーザーアカウント
- サーバーへの問題集アップロード
- サーバーへの学習履歴送信

保存先はIndexedDBとする。

Cloudflare WorkersはStatic Assetsの配信先としてのみ使う。

CloudflareのStatic Assetsは、`not_found_handling: "single-page-application"`によって、実ファイルに一致しないナビゲーションを`index.html`へフォールバックできる。citeturn828355search1turn828355search2

### 2.2 Workerスクリプトは原則作らない

「Workerは何も処理しない」という要件は、空のWorkerハンドラーを設置するのではなく、**Workerスクリプト自体を持たないStatic Assets専用構成**として実現すること。

Cloudflare Vite Plugin利用時は、`assets.directory`はViteのクライアント出力へ自動設定できる。Workerスクリプトが不要なら、`main`、`assets.binding`、`run_worker_first`も不要である。citeturn828355search2turn828355search4

`wrangler.jsonc`は`packages/app/`内に置き、アプリと同一リポジトリで管理する。

想定設定:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "<APP_NAME>",
  "compatibility_date": "2026-07-23",
  "assets": {
    "not_found_handling": "single-page-application"
  }
}
```

Cloudflare Vite Pluginがこの構成で`assets.directory`を正しく補完できない場合のみ、ビルド結果に合わせて明示すること。

```jsonc
"assets": {
  "directory": "./dist/client",
  "not_found_handling": "single-page-application"
}
```

空の`fetch()`ハンドラーを用意して全アクセスをWorker課金対象にしないこと。Static AssetsへのリクエストはWorkerスクリプト呼び出しとは別に扱われる。citeturn828355search10

## 3. 参照する既存リポジトリ

### 3.1 UI・デザイン: JiChiTai

`github.com/tamaina/JiChiTai`をUIデザインの基準にする。

JiChiTaiは以下の構成を採用している。

- Vue 3
- Vue Router
- Vite
- TypeScript
- `@cloudflare/vite-plugin`
- `@lucide/vue`
- CSS Variablesによるデザイントークン
- 単一の共通CSS
- OS設定に追従するライト／ダークテーマ

JiChiTaiでは、アプリシェルを中央寄せの最大幅コンテナとし、上部にシンプルなヘッダーを配置している。

デザイン上、以下を踏襲すること。

- 装飾を抑えた実用的なUI
- 緑系アクセント
- 明確な境界線
- 過度なシャドウを使わない
- 8px前後の角丸
- システムフォント
- 最大コンテンツ幅800px前後
- 十分な余白
- `prefers-color-scheme`によるダークモード
- `focus-visible`の明確なアウトライン
- 44px以上の操作領域
- 色だけに依存しない状態表示

JiChiTaiの主要トークンをベースにする。

```css
:root {
  color-scheme: light dark;

  --color-bg: #f7f7f5;
  --color-surface: #ffffff;
  --color-text: #1d211f;
  --color-muted: #626965;
  --color-border: #d5d9d6;

  --color-accent: #176b4d;
  --color-accent-hover: #10573e;
  --color-focus: #31826a;

  --color-success: #176b4d;
  --color-danger: #a13b32;
  --color-warning: #8a6515;

  --radius: 8px;
  --content-width: 800px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

JiChiTaiの実際のトークンもこの方針になっている。

ダークモードもJiChiTai相当の配色を用いる。

問題の選択肢表示は、JiChiTaiの`.choice-card`相当のカードUIを再利用する。JiChiTaiでは、選択カードに境界線、選択時のアクセント背景、`focus-visible`、無効状態を備えている。

ただし、コードの単純コピーではなく、このアプリの責務に合わせてコンポーネント化すること。

### 3.2 リポジトリ構成: cfw-fileup

`github.com/tamaina/cfw-fileup`のpnpm workspace構成を基準にする。

cfw-fileupではルートの`pnpm-workspace.yaml`が`packages/*`をworkspaceとして認識し、ルートコマンドから`app` packageを操作している。 

今回もmonorepoにし、GIFTパーサーを独立packageとする。

## 4. 想定リポジトリ構造

以下を基本構造とする。

```text
/
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ eslint.config.js
├─ prettier.config.js
├─ README.md
├─ LICENSE
│
├─ packages/
│  ├─ app/
│  │  ├─ package.json
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  ├─ wrangler.jsonc
│  │  ├─ tsconfig.json
│  │  ├─ tsconfig.app.json
│  │  ├─ public/
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ App.vue
│  │  │  ├─ router/
│  │  │  ├─ views/
│  │  │  ├─ components/
│  │  │  ├─ composables/
│  │  │  ├─ domain/
│  │  │  ├─ application/
│  │  │  ├─ infrastructure/
│  │  │  ├─ styles/
│  │  │  └─ utils/
│  │  ├─ tests/
│  │  └─ e2e/
│  │
│  └─ gift-parser/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ lexer/
│     │  ├─ parser/
│     │  ├─ ast/
│     │  ├─ diagnostics/
│     │  ├─ normalize/
│     │  └─ stringify/
│     ├─ tests/
│     │  ├─ fixtures/
│     │  ├─ parser/
│     │  └─ roundtrip/
│     └─ README.md
│
└─ docs/
   ├─ architecture.md
   ├─ gift-support.md
   ├─ fsrs-mapping.md
   ├─ storage-schema.md
   └─ privacy.md
```

初版では`packages/app`と`packages/gift-parser`の2 packageに限定する。

用途が明確になるまでは、以下のpackageを増やさない。

- shared
- ui
- core
- fsrs-adapter
- database

アプリ内部のモジュールで十分な段階ではpackage化しないこと。

## 5. ルートpackage.json

ルートはworkspace操作専用とする。

```json
{
  "name": "<REPOSITORY_NAME>",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@<CURRENT_VERSION>",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "pnpm --filter app dev",
    "build": "pnpm -r build",
    "deploy": "pnpm --filter app deploy",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter app test:e2e",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  }
}
```

パッケージ名`app`はcfw-fileupに合わせてよい。cfw-fileupでもルートスクリプトが`--filter app`を使用している。

## 6. 技術スタック

### 必須

- TypeScript
- Vue 3
- Vue Router
- Vite
- pnpm workspace
- Cloudflare Vite Plugin
- Wrangler
- Vitest
- Playwright
- `@lucide/vue`
- IndexedDB
- `ts-fsrs`
- vvi https://github.com/tamaina/vite-vue-internationalization - SPAは、初期に英語と日本語へ対応させる。prefer icu, locale block, virtual strategy

`ts-fsrs`はTypeScriptでFSRSを利用する公式系ツールキットで、ブラウザ向けのスケジューリング処理に利用できる。基本APIとして`createEmptyCard()`、`fsrs()`、`next()`などが提供されている。citeturn828355search0

### 推奨

IndexedDBラッパーとして`idb`を利用してよい。

ただし、以下の理由からDexieは必須にしない。

- データモデルが比較的小さい
- クエリ要件が限定的
- `idb`で十分に型安全な薄いrepositoryを作れる
- 依存関係を増やしすぎない

状態管理は、初版ではPiniaを導入せず、VueのComposition APIとrepository層で実装する。

Piniaが必要になるのは、複数画面にまたがる一時状態が著しく複雑になった場合のみとする。

## 7. GIFTパーサーpackageの要件

package名は、公開予定がなければ次のようなworkspace内限定名でよい。

```json
{
  "name": "@<scope>/gift-parser",
  "private": true
}
```

将来的にnpm公開する可能性があるなら、最初から以下を守る。

- DOMへ依存しない
- Vueへ依存しない
- Node.js固有APIへ依存しない
- FSRSへ依存しない
- IndexedDBへ依存しない
- Web Workerで実行可能
- ESMを第一対象とする
- packageの公開APIを`src/index.ts`へ集約する
- AST型を安定した公開APIとして扱う
- 内部パーサー実装を外部へ露出しない

### 7.1 パーサー実装方式

第一候補はChevrotainとする。

理由:

- LexerとParserを明確に分離できる
- CST生成を標準的に扱える
- エラー回復と診断を実装しやすい
- トークン位置情報を取得しやすい
- エディタ対応へ発展させやすい
- TypeScriptとの相性がよい

ただし、以下の条件を満たせるならPeggyでもよい。

- 全ノードにSourceRangeを付与できる
- 複数エラーの収集方針を用意できる
- パーサー内部ASTと公開ASTを分離する
- 不完全入力に対して意味のある診断を返せる
- 将来の構文拡張で保守不能にならない

採用技術は実装開始時にREADMEへ記録する。

### 7.2 パース処理の層

以下の3層に分ける。

```text
GIFT source
  ↓
CSTまたは内部構文表現
  ↓
GIFT Semantic AST
  ↓
アプリ固有Quizモデル
```

GIFTパーサーpackageが返すのはSemantic ASTまでとする。

アプリ固有のQuizモデルへの変換は`packages/app`側に置く。

### 7.3 公開API

最低限、以下を公開する。

```ts
export function parseGift(
  source: string,
  options?: ParseGiftOptions,
): ParseGiftResult

export function validateGift(
  document: GiftDocument,
  options?: ValidateGiftOptions,
): GiftDiagnostic[]

export function stringifyGift(
  document: GiftDocument,
  options?: StringifyGiftOptions,
): string
```

結果は例外中心ではなく、診断を値として返す。

```ts
export interface ParseGiftResult {
  document: GiftDocument
  diagnostics: GiftDiagnostic[]
}
```

致命的な内部障害を除き、ユーザー入力の構文エラーをthrowしない。

### 7.4 SourceRange

すべての主要ノードへ位置情報を持たせる。

```ts
export interface SourcePosition {
  offset: number
  line: number
  column: number
}

export interface SourceRange {
  start: SourcePosition
  end: SourcePosition
}
```

行・列はUI表示上1始まりとするか、内部で0始まりとするかを統一し、READMEへ明記する。

推奨は以下。

- `offset`: 0始まり
- `line`: 1始まり
- `column`: 1始まり

### 7.5 Document AST

```ts
export interface GiftDocument {
  type: 'document'
  version: 1
  children: GiftBlock[]
  range: SourceRange
}

export type GiftBlock =
  | GiftCategoryDirective
  | GiftQuestion
  | GiftComment
```

### 7.6 共通問題型

```ts
export interface GiftQuestionBase {
  type: 'question'
  kind: GiftQuestionKind
  name?: string
  prompt: GiftContent
  format: GiftTextFormat
  range: SourceRange
}

export type GiftQuestionKind =
  | 'multiple-choice'
  | 'true-false'
  | 'short-answer'
  | 'matching'
  | 'numerical'
  | 'essay'
  | 'description'
```

`type`はノードの大分類、`kind`は問題形式として使う。

### 7.7 コンテンツ型

初版では、過度に複雑なリッチテキストASTを作らない。

```ts
export interface GiftContent {
  type: 'content'
  format: GiftTextFormat
  value: string
  range: SourceRange
}

export type GiftTextFormat =
  | 'plain'
  | 'html'
  | 'markdown'
  | 'moodle'
  | 'auto'
```

GIFTのエスケープは解除した値を`value`へ入れる。

元表記を厳密に保持する必要がある場合はCST側で保持し、Semantic ASTへ`raw`を無秩序に追加しない。

### 7.8 選択式問題

```ts
export interface GiftMultipleChoiceQuestion
  extends GiftQuestionBase {
  kind: 'multiple-choice'
  mode: 'single' | 'multiple'
  answers: GiftChoiceAnswer[]
}

export interface GiftChoiceAnswer {
  type: 'choice-answer'
  content: GiftContent
  weight: number
  feedback?: GiftContent
  range: SourceRange
}
```

`correct: boolean`を正本にしない。

GIFTは部分点や減点を表現できるため、正本は`weight: number`とする。

正解判定はアプリ層で配点合計から行う。

### 7.9 True/False

```ts
export interface GiftTrueFalseQuestion
  extends GiftQuestionBase {
  kind: 'true-false'
  correctAnswer: boolean
  trueFeedback?: GiftContent
  falseFeedback?: GiftContent
}
```

`T`、`TRUE`、`F`、`FALSE`などの表記差はASTで正規化する。

### 7.10 Short Answer

```ts
export interface GiftShortAnswerQuestion
  extends GiftQuestionBase {
  kind: 'short-answer'
  answers: GiftShortAnswer[]
}

export interface GiftShortAnswer {
  type: 'short-answer-option'
  value: string
  weight: number
  feedback?: GiftContent
  range: SourceRange
}
```

初版では大文字小文字の扱いをGIFT仕様に従う。アプリ独自の曖昧一致は導入しない。

### 7.11 Matching

```ts
export interface GiftMatchingQuestion
  extends GiftQuestionBase {
  kind: 'matching'
  pairs: GiftMatchingPair[]
}

export interface GiftMatchingPair {
  type: 'matching-pair'
  left: GiftContent
  right: GiftContent
  range: SourceRange
}
```

`left -> right`という生文字列のまま保持しない。

### 7.12 Numerical

```ts
export interface GiftNumericalQuestion
  extends GiftQuestionBase {
  kind: 'numerical'
  answers: GiftNumericalAnswer[]
}

export type GiftNumericalAnswer =
  | GiftExactNumericalAnswer
  | GiftToleranceNumericalAnswer
  | GiftRangeNumericalAnswer

export interface GiftExactNumericalAnswer {
  type: 'numerical-exact'
  value: number
  weight: number
  feedback?: GiftContent
  range: SourceRange
}

export interface GiftToleranceNumericalAnswer {
  type: 'numerical-tolerance'
  value: number
  tolerance: number
  weight: number
  feedback?: GiftContent
  range: SourceRange
}

export interface GiftRangeNumericalAnswer {
  type: 'numerical-range'
  min: number
  max: number
  weight: number
  feedback?: GiftContent
  range: SourceRange
}
```

浮動小数点比較では、JavaScriptの単純な`===`に依存しない。

### 7.13 Category

```ts
export interface GiftCategoryDirective {
  type: 'category'
  path: string[]
  range: SourceRange
}
```

Semantic ASTではdirectiveを残す。

アプリのインポート処理で、現在のカテゴリを後続問題へ解決する。

### 7.14 コメント

```ts
export interface GiftComment {
  type: 'comment'
  value: string
  range: SourceRange
}
```

実行時には無視してよいが、stringifyと将来のエディタ利用のため保持する。

### 7.15 診断

```ts
export interface GiftDiagnostic {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  range: SourceRange
}
```

コード例:

```text
GIFT_UNEXPECTED_TOKEN
GIFT_UNTERMINATED_ANSWER_BLOCK
GIFT_INVALID_WEIGHT
GIFT_MULTIPLE_CHOICE_NO_POSITIVE_ANSWER
GIFT_MULTIPLE_CHOICE_MULTIPLE_FULL_SCORES
GIFT_NUMERICAL_INVALID_RANGE
GIFT_MATCHING_MISSING_RIGHT_SIDE
GIFT_UNSUPPORTED_FORMAT
```

UIは診断コードではなく、日本語メッセージを表示する。

package側の診断文は、初版では日本語固定でもよいが、将来の国際化を考えるならコードとパラメータを返し、アプリ側で翻訳する設計を検討する。

## 8. 初版のGIFT対応範囲

### 必須対応

- コメント
- `$CATEGORY`
- 問題名`::name::`
- plain text
- `[html]`
- `[markdown]`
- 単一選択
- 複数選択
- True/False
- Short Answer
- Matching
- Numerical exact
- Numerical tolerance
- Numerical range
- Essay
- フィードバック
- `%n%`配点
- 基本的なGIFTエスケープ

### 初版で出題対象にするもの

- 単一選択
- 複数選択
- True/False
- Short Answer
- Numerical

### 読み込み可能だが初版では出題対象外でもよいもの

- Matching
- Essay
- Description

出題対象外の問題はインポート時に破棄しない。

問題集へ保存し、UIで「このバージョンでは未対応」と明示する。

### 非対応を明示するもの

Moodle実装固有の挙動で仕様が曖昧な項目は、推測実装せず診断を返す。

## 9. アプリ内部のQuizモデル

GIFT ASTをUIやFSRSへ直接渡さない。

`packages/app/src/domain/quiz/`にアプリ固有モデルを作る。

```ts
export interface QuizDeck {
  id: string
  name: string
  description?: string
  sourceType: 'gift'
  sourceFileName?: string
  importedAt: Date
  updatedAt: Date
  questionCount: number
}

export type QuizQuestion =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | ShortAnswerQuestion
  | NumericalQuestion
  | UnsupportedQuestion
```

共通部分:

```ts
export interface QuizQuestionBase {
  id: string
  deckId: string
  sourceKey: string
  name?: string
  prompt: QuizContent
  categoryPath: string[]
  explanation?: QuizContent
  sourceRange?: SourceRange
}
```

### 9.1 安定した問題ID

問題IDは配列indexから作らない。

GIFTには必ず一意IDがあるとは限らないため、次の順で`sourceKey`を作る。

1. 明示的な問題名があり、デッキ内で一意なら問題名
2. 問題名とカテゴリパスの組み合わせ
3. 問題の正規化内容からSHA-256を計算

ハッシュ対象には以下を含める。

- 問題形式
- 正規化した問題文
- 正規化した選択肢
- 正答・配点
- カテゴリ

学習履歴と問題の対応が壊れるため、選択肢の表示順はハッシュへ含めても、実行時のシャッフル結果は含めない。

インポート時に同一`sourceKey`が衝突した場合は、エラーまたは明確な警告にする。

## 10. FSRS統合

### 10.1 FSRSの役割

FSRSは問題表示や採点を担当しない。

FSRSの責務は以下に限定する。

- 問題ごとの記憶状態を保持する
- 評価結果から次回出題日時を計算する
- 復習ログを生成する

アプリ側が担当するもの:

- 今日出題すべき問題の抽出
- 新規問題の上限
- 出題順
- 問題の採点
- 正誤からRatingへの変換
- セッションUI
- 学習履歴表示

### 10.2 保存するFSRSデータ

`ts-fsrs`が提供するCardとReviewLogを可能な限り忠実に保存する。

ただし、ライブラリ型をDB schemaへ直接固定しない。

adapterを用意する。

```ts
export interface StoredFsrsCard {
  due: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: number
  lastReview?: string
}
```

実際の`ts-fsrs`バージョンの型を確認し、型名・フィールド名は導入バージョンに合わせること。

日付はIndexedDBへ`Date`として保存してもよいが、export形式ではISO 8601文字列に正規化する。

### 10.3 Rating変換

初版では次の規則にする。

```text
不正解                         → Again
正解だが「難しかった」を選択   → Hard
正解                           → Good
正解かつ「簡単だった」を選択   → Easy
```

選択式問題で正解しただけで自動的にEasyにしない。

回答時間だけでHard／Good／Easyを自動決定しない。

理由:

- 選択肢がヒントになる
- たまたま推測で正解する可能性がある
- 長文問題は読む時間が必要
- 端末やアクセシビリティによって回答時間が変わる

初版UIでは採点後に以下を表示する。

```text
[もう一度] [難しかった] [正解] [簡単]
```

ただし不正解時は`Again`を自動選択してよい。

正解時は既定を`Good`とし、ユーザーが`Hard`または`Easy`へ変更できる。

### 10.4 Desired Retention

設定画面で目標保持率を変更可能にする。

初期値は0.90。

許容範囲はFSRSライブラリの有効範囲に合わせるが、UIでは過度に広くしない。

推奨UI範囲:

```text
80% ～ 97%
```

説明文:

> 高くすると忘れにくくなりますが、毎日の復習量が増えます。

### 10.5 初期パラメータ

初版では`ts-fsrs`の既定パラメータを使用する。

個人履歴からのパラメータ最適化は初版に入れない。

理由:

- 十分な履歴が必要
- WASM／bindingの追加が必要になる可能性がある
- UI説明が複雑になる
- 初期MVPの価値に直結しない

ただしDB schemaとexport形式は、将来カスタムパラメータを保存できるようにする。

## 11. IndexedDB設計

DB名例:

```text
gift-fsrs-learning
```

schema versionは整数で管理する。

最低限のobject store:

```text
decks
questions
studyStates
reviewLogs
settings
imports
```

### 11.1 decks

```ts
interface DeckRecord {
  id: string
  name: string
  description?: string
  sourceType: 'gift'
  sourceFileName?: string
  sourceHash: string
  importedAt: string
  updatedAt: string
  questionCount: number
  enabledQuestionCount: number
}
```

### 11.2 questions

```ts
interface QuestionRecord {
  id: string
  deckId: string
  sourceKey: string
  kind: QuizQuestion['kind']
  payload: QuizQuestion
  enabled: boolean
  createdAt: string
  updatedAt: string
}
```

index:

- `by-deck`
- `[deckId, sourceKey]`
- `[deckId, enabled]`

### 11.3 studyStates

```ts
interface StudyStateRecord {
  questionId: string
  deckId: string
  card: StoredFsrsCard
  suspended: boolean
  buriedUntil?: string
  updatedAt: string
}
```

index:

- `by-due`
- `by-deck-due`
- `by-deck-suspended`

### 11.4 reviewLogs

```ts
interface ReviewLogRecord {
  id: string
  questionId: string
  deckId: string
  reviewedAt: string
  rating: 'again' | 'hard' | 'good' | 'easy'
  correct: boolean
  selectedAnswerIds?: string[]
  responseText?: string
  durationMs?: number
  fsrsLog: StoredFsrsReviewLog
}
```

index:

- `by-question`
- `by-deck-reviewed-at`
- `by-reviewed-at`

ログは追記専用とする。

通常操作で過去ログを書き換えない。

### 11.5 settings

```ts
interface SettingsRecord {
  id: 'global'
  desiredRetention: number
  newQuestionsPerDay: number
  maxReviewsPerDay: number | null
  shuffleChoices: boolean
  showImmediateFeedback: boolean
  locale: 'ja'
  theme: 'system' | 'light' | 'dark'
}
```

## 12. GIFTインポートフロー

### 12.1 入力方法

初版では以下を用意する。

- ファイル選択
- ドラッグ＆ドロップ
- テキスト貼り付け

受け入れる拡張子:

- `.gift`
- `.txt`

文字コードはUTF-8を基本とする。

BOM付きUTF-8にも対応する。

Shift_JISなどを自動推測しない。

UTF-8として読めない場合は、明示的なエラーを表示する。

### 12.2 インポート手順

```text
ファイル読込
  ↓
SHA-256計算
  ↓
GIFT parse
  ↓
diagnostics表示
  ↓
Semantic AST → QuizQuestion変換
  ↓
問題件数・形式別件数をプレビュー
  ↓
ユーザー確認
  ↓
IndexedDBへtransaction保存
```

### 12.3 構文エラー表示

エラー一覧には以下を表示する。

- severity
- 行
- 列
- メッセージ
- 周辺ソース
- 該当箇所の強調

1件のエラーで全結果を破棄しない。

安全に解析できた問題はプレビュー可能にするが、エラーを含む状態で保存する際は確認を求める。

初版では、`error`が1件以上ある場合はインポートを禁止してもよい。

`warning`のみならインポート可能とする。

### 12.4 再インポート

同じデッキへ更新インポートできるようにする。

差分分類:

- 追加された問題
- 内容が変更された問題
- 削除された問題
- 変更されていない問題
- ID衝突問題

既存問題の学習履歴を維持する条件:

- `sourceKey`が同じ
- 問題形式が互換
- 正答構造が大きく変わっていない

以下の場合は学習状態をリセットするか確認を求める。

- 正解が変更された
- 単一選択から複数選択へ変わった
- 問題種別が変わった
- 問題本文が大幅に変わった
- 数値許容範囲が大幅に変わった

削除された問題は即座に履歴ごと消さず、`enabled: false`として退避する。

## 13. 学習セッション

### 13.1 出題対象

セッション開始時に次を抽出する。

1. `due <= now`の復習問題
2. 当日の新規問題上限までの未学習問題

基本順序:

```text
期限超過の復習
→ 本日期限の復習
→ 新規問題
```

同一カテゴリが連続しすぎないように軽いシャッフルを入れてよい。

FSRSのdue自体を恣意的に書き換えない。

### 13.2 問題画面

表示要素:

- デッキ名
- 現在位置
- 残り件数
- カテゴリ
- 問題文
- 選択肢または入力欄
- 回答ボタン
- 中断ボタン

問題回答前は正解をDOM上へ描画しない。

ただしクライアントアプリなので、開発者ツールによる閲覧を防ぐことは目的にしない。

### 13.3 選択肢

単一選択:

- radio相当
- カード全体をクリック可能
- キーボード操作可能
- 上下キーまたはTabで移動可能

複数選択:

- checkbox相当
- 選択状態を視覚とテキストで示す
- 「すべて選んだら回答」方式

選択肢は設定によりシャッフルする。

以下はシャッフルしない。

- 「上記すべて」
- 「該当なし」
- 順序自体が意味を持つ設問

GIFTだけでは判定できないため、初版では原則シャッフルし、問題名または将来のmetadataで無効化できる設計にする。

### 13.4 採点

単一選択:

- 選択肢のweightを採点結果に反映
- 最高点を100として正規化

複数選択:

- 選択した項目のweightを合計
- 下限0、上限100へクランプするか、GIFT仕様に沿ったルールを明文化する
- 完全正解条件と部分点を分離する

FSRSへ渡す`correct`は、初版では満点のみtrueとする。

部分点をHardへ自動変換しない。

部分点は不正解扱いとしてAgainにするか、設定可能にせず仕様を固定する。

推奨:

```text
100点 → correct
100点未満 → incorrect
```

### 13.5 フィードバック画面

表示内容:

- 正解／不正解
- 得点
- 正しい選択肢
- ユーザーが選んだ選択肢
- 選択肢ごとのGIFTフィードバック
- 問題全体の解説
- FSRS評価ボタン
- 次回予定のプレビュー

正答を色だけで区別しない。

例:

- チェックアイコン＋「正解」
- バツアイコン＋「不正解」
- 選択済みラベル
- 正答ラベル

## 14. 主要画面

### `/`

ホーム。

表示内容:

- 今日の復習件数
- 新規問題件数
- 学習開始ボタン
- デッキ一覧
- GIFTを読み込むボタン
- 最近の学習状況

JiChiTaiのモード選択画面を参考に、カードを並べすぎず、情報を区切り線と余白で整理する。

### `/import`

GIFTインポート。

- ファイル選択
- ドロップ領域
- テキスト貼付
- 診断一覧
- 問題形式別件数
- インポート確認

### `/decks`

デッキ一覧。

- デッキ名
- 総問題数
- 学習済み
- 本日期限
- 次回期限
- 最終学習日時

### `/decks/:deckId`

デッキ詳細。

- 学習開始
- 問題一覧
- カテゴリ絞り込み
- 問題の停止／再開
- GIFT更新インポート
- デッキ削除
- 履歴リセット

### `/study`

学習セッション。

リロード時にセッションを復元する。

### `/history`

学習履歴。

- 日別復習数
- 正答率
- Rating内訳
- 問題別履歴

複雑な分析ダッシュボードは初版に入れない。

### `/settings`

- 目標保持率
- 新規問題数
- 1日の最大復習数
- 選択肢シャッフル
- テーマ
- データエクスポート
- データインポート
- 全データ削除

### `/about`

- アプリの目的
- GIFTについて
- FSRSについて
- データが端末内だけに保存されること
- 使用ライブラリとライセンス
- GitHubリンク

## 15. App.vueと共通レイアウト

JiChiTaiと同様、アプリ全体をシンプルなシェルで包む。

```vue
<template>
  <div class="site-shell">
    <header class="site-header">
      <RouterLink class="site-title" to="/">
        <AppName />
      </RouterLink>

      <nav aria-label="メインナビゲーション">
        <RouterLink to="/decks">問題集</RouterLink>
        <RouterLink to="/history">履歴</RouterLink>
        <RouterLink to="/settings">設定</RouterLink>
      </nav>
    </header>

    <main id="main-content">
      <RouterView />
    </main>
  </div>
</template>
```

JiChiTaiも同様に`site-shell`、`site-header`、`RouterView`による構成を採用している。

モバイルではナビゲーションを折り返すか、簡潔なメニューにする。

ハンバーガーメニューは必要になるまで導入しない。

## 16. CSS方針

CSS ModulesやCSS-in-JSは使わず、JiChiTai同様のCSS Variables＋通常CSSを基本とする。

```text
src/styles/
├─ tokens.css
├─ base.css
├─ components.css
└─ utilities.css
```

ただし初版で分割が過剰なら、

```text
tokens.css
base.css
```

の2ファイルでもよい。

JiChiTaiは`main.ts`から`tokens.css`と`base.css`を読み込んでいる。

コンポーネント固有のスタイルはVue SFCの`scoped`へ置いてよいが、以下は共通CSSへ置く。

- ボタン
- 入力欄
- 選択カード
- ページコンテナ
- 診断表示
- バッジ
- ダイアログ
- 空状態
- focus ring

## 17. アクセシビリティ

必須要件:

- すべてキーボード操作可能
- `focus-visible`を消さない
- 選択肢はネイティブinputを基礎にする
- カードUIだけにクリック処理を付けない
- 見出し順序を守る
- エラーを`aria-live`で通知する
- 採点結果を`aria-live="polite"`で通知する
- ダイアログのフォーカストラップ
- 色だけで正誤を表現しない
- `prefers-reduced-motion`対応
- 200%ズームで操作可能
- 最小幅320pxで横スクロールしない
- タップ領域44px以上

JiChiTaiではリンク、ボタン、inputの`focus-visible`に3pxのアウトラインを設定しているため、同等以上を維持する。

## 18. セキュリティ

サーバー処理はないが、GIFT内のHTMLを表示するためXSS対策が必要。

### 18.1 HTML問題文

`[html]`コンテンツを`v-html`へ直接渡さない。

DOMPurifyなどで必ずsanitizeする。

禁止対象:

- script
- iframe
- object
- embed
- form
- event handler属性
- `javascript:` URL
- 危険なSVG
- 外部自動読込要素

画像については初版方針を明示する。

推奨:

- `data:`画像は禁止
- 外部画像は既定でブロック
- ユーザー操作で表示可能にするか、完全非対応とする

### 18.2 Markdown

MarkdownをHTMLへ変換した後、同じくsanitizeする。

### 18.3 ファイルサイズ制限

誤操作やメモリ枯渇を防ぐため、初版では以下を目安に制限する。

- 1ファイル: 10MB
- 1デッキ: 20,000問
- 問題文: 100KB
- 選択肢数: 100
- 入れ子構造: GIFT仕様上必要な範囲

制限値は定数へまとめ、診断を表示する。

## 19. PWA

SPAとしてオフライン利用できる価値が高いため、PWA対応を行う。

ただし初版の必須機能が完成してから追加する。

- app shellをキャッシュ
- hashed assetsをキャッシュ
- 新バージョン通知
- 強制的な即時更新は避ける
- IndexedDBの学習データはService Workerから変更しない

cfw-fileupでは`vite-plugin-pwa`を利用しているが、今回の単純なSPAでは`generateSW`でもよい。cfw-fileupのような複雑な`injectManifest`構成を無条件にコピーしない。cfw-fileupではPWA設定をVite config内に持っている。

## 20. エクスポート／バックアップ

### 20.1 アプリ全体バックアップ

JSONでエクスポートする。

```ts
interface AppBackup {
  format: 'gift-fsrs-learning-backup'
  version: 1
  exportedAt: string
  appVersion: string
  settings: SettingsRecord
  decks: DeckRecord[]
  questions: QuestionRecord[]
  studyStates: StudyStateRecord[]
  reviewLogs: ReviewLogRecord[]
}
```

インポート時にValibotなどで検証する。

バックアップは信用せず、schema validationを通す。

### 20.2 GIFT再出力

元GIFTをそのまま保存できる場合は、デッキごとに原文を保持してよい。

ただし学習状態はGIFTへ埋め込まない。

GIFTは問題内容の交換形式、JSONバックアップはアプリ状態の交換形式として分ける。

## 21. テスト

### 21.1 gift-parser unit tests

必須fixture:

- 単一選択
- 複数選択
- 部分点
- 負の配点
- True/Falseの表記差
- Short Answer複数正解
- Matching
- Numerical exact
- Numerical tolerance
- Numerical range
- feedback
- category
- comments
- question name
- escaped delimiters
- HTML
- Markdown
- CRLF
- BOM
- 日本語
- 空白
- 複数問題
- 壊れた入力
- 閉じていない`{}`
- 不正なweight
- 不正なnumerical range

### 21.2 round-trip tests

次を検証する。

```text
parse → stringify → parse
```

完全な文字列一致ではなく、Semantic ASTの意味的一致を確認する。

### 21.3 FSRS adapter tests

固定時刻を使う。

- 新規カード作成
- Again
- Hard
- Good
- Easy
- 期限抽出
- タイムゾーン境界
- 日付シリアライズ
- ライブラリ更新時の互換性

テストでは`new Date()`を直接乱用せず、Clockを注入する。

```ts
export interface Clock {
  now(): Date
}
```

### 21.4 IndexedDB tests

- 初回schema作成
- migration
- transaction rollback
- デッキ削除
- 再インポート
- export/import
- 大量問題

### 21.5 Component tests

- 選択肢のキーボード操作
- 複数選択
- 回答前に正解非表示
- 回答後のフィードバック
- Rating選択
- 診断一覧
- ファイルドロップ

### 21.6 Playwright E2E

最低限のシナリオ:

1. アプリを開く
2. GIFTを貼り付ける
3. インポートする
4. 学習を開始する
5. 問題へ回答する
6. Ratingを確定する
7. リロードする
8. 履歴と次回予定が保持されていることを確認する
9. JSONバックアップを出力する
10. データ削除後に復元する

## 22. 日付とタイムゾーン

FSRS内部では絶対時刻を利用し、表示は端末のローカルタイムゾーンとする。

「今日」の境界は端末ローカルの午前4時を推奨する。

理由:

- 深夜学習で日付が途中切替しにくい
- Anki利用者に比較的馴染みがある
- 0時境界より実用的

ただし初版では0時境界でもよい。採用方針を`docs/fsrs-mapping.md`に明記する。

日時計算を各コンポーネントへ散在させない。

```ts
getStudyDayKey(date: Date, rolloverHour: number): string
```

のような共通関数にまとめる。

## 23. プライバシー

アプリ画面とAboutへ以下を明記する。

- 問題集は端末内に保存される
- 学習履歴は端末内に保存される
- サーバーへアップロードしない
- ブラウザデータを削除すると失われる可能性がある
- 定期的なバックアップを推奨する

解析サービスや広告SDKは初版に導入しない。

## 24. 実装フェーズ

### Phase 1: 基盤

- pnpm workspace
- app package
- gift-parser package
- Vue Router
- JiChiTaiベースのtokens.css／base.css
- Static Assets用Wrangler設定
- CI相当の`pnpm check`

### Phase 2: GIFTパーサー

- Lexer／Parser
- Semantic AST
- diagnostics
- 必須形式
- unit tests
- stringify
- README

### Phase 3: インポートと保存

- IndexedDB schema
- file／paste import
- diagnostics UI
- AST→Quiz変換
- デッキ保存
- デッキ一覧

### Phase 4: 学習

- FSRS adapter
- due抽出
- 単一選択
- 複数選択
- True/False
- Short Answer
- Numerical
- feedback
- Rating
- review log

### Phase 5: 管理

- デッキ詳細
- 再インポート
- 問題停止
- 履歴
- 設定
- export/import

### Phase 6: 品質

- Playwright
- アクセシビリティ確認
- PWA
- 大容量GIFT性能検証
- ドキュメント

## 25. 初版で実装しないもの

スコープを守るため、以下は実装しない。

- 問題生成AI
- LLM API連携
- GIFTのGUIエディタ
- ログイン
- クラウド同期
- 複数端末同期
- 公開問題集マーケット
- 共同編集
- Moodle API連携
- QTI
- APKG
- Anki同期
- FSRSパラメータ学習
- SNS機能
- ランキング
- サーバー側採点
- 外部画像の自動取得
- Worker API

## 26. コーディング規約

- TypeScriptのstrict modeを有効にする
- `any`を原則禁止する
- 外部入力は必ずruntime validationする
- domain層でVue型を使わない
- parser packageでDOM型を使わない
- 日付取得をClockへ集約する
- UUIDまたはnanoid生成を関数へ集約する
- コンポーネント内でIndexedDBを直接操作しない
- repository interfaceを経由する
- FSRSライブラリ型をUIへ直接漏らさない
- GIFT ASTをUIへ直接漏らさない
- 1ファイルが過度に巨大にならないよう責務分離する
- 過剰な抽象化や汎用フレームワーク化を避ける
- 実装していない機能のプレースホルダーを大量に置かない
- 未対応機能は明示的な診断またはUI表示にする
- 黙ってデータを捨てない

## 27. 完了条件

以下をすべて満たした時点でMVP完成とする。

- `.gift`ファイルを読み込める
- GIFT構文エラーを行・列付きで表示できる
- 単一選択問題を出題できる
- 複数選択問題を出題できる
- 正誤を採点できる
- GIFTのfeedbackを表示できる
- FSRSで次回日時を計算できる
- 学習状態がIndexedDBへ保存される
- リロード後も状態が維持される
- 期限になった問題だけを抽出できる
- デッキ単位で学習できる
- JSONバックアップと復元ができる
- 主要操作がキーボードで可能
- ライト／ダークモードで読める
- 320px幅で操作できる
- `pnpm check`が成功する
- Playwrightの基本E2Eが成功する
- `wrangler deploy`でStatic Assetsとして公開できる
- 通常アクセスでWorker API処理が走らない

## 28. 実装開始時に最初に行うこと

1. JiChiTaiの最新`main`を読み、UI構造とCSSを確認する
2. cfw-fileupの最新`develop`を読み、workspaceとpackage scriptsを確認する
3. 現行のCloudflare Vite PluginとWranglerの公式ドキュメントを確認する
4. 現行の`ts-fsrs` APIを確認する
5. GIFT仕様とMoodle実装を確認する
6. 採用依存関係とバージョンをREADMEへ記録する
7. リポジトリ骨格を作る
8. 小さなGIFT fixtureでparserの垂直スライスを作る
9. 1問をインポートしてFSRS状態を保存する最小経路を先に完成させる
10. その後に対応問題形式とUIを広げる

「パーサーを全部完成させてからアプリへ統合する」のではなく、以下の垂直スライスを最初に通すこと。

```text
1問のGIFT
→ parse
→ QuizQuestion
→ IndexedDB
→ 出題
→ 採点
→ FSRS
→ 次回日時保存
→ 再読込
```

この経路が完成した後に、問題形式、診断、再インポート、履歴画面を拡張すること。
