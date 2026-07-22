<script setup lang="ts">
import { ExternalLink } from '@lucide/vue'
</script>
<template>
  <div class="page prose">
    <h1>{{ $locale.sfc.aboutTitle }}</h1>
    <p>{{ $locale.sfc.aboutIntro }}</p>
    <h2>{{ $locale.sfc.privacy }}</h2>
    <p>{{ $locale.sfc.privacyBody }}</p>
    <h2>{{ $locale.sfc.giftFsrs }}</h2>
    <p>{{ $locale.sfc.giftFsrsBody }}</p>
    <h2>{{ $locale.sfc.openSource }}</h2>
    <p>{{ $locale.sfc.openSourceBody }}</p>
    <section>
      <h2>{{ $locale.sfc.production }}</h2>
      <dl class="about-credits">
        <div>
          <dt>{{ $locale.sfc.author }}</dt>
          <dd>aqz/tamaina</dd>
        </div>
        <div>
          <dt>{{ $locale.sfc.sourceCode }}</dt>
          <dd>
            <a href="https://github.com/tamaina/fukushu" target="_blank" rel="noopener noreferrer">
              tamaina/fukushu
              <ExternalLink :size="15" aria-hidden="true" />
            </a>
          </dd>
        </div>
        <div>
          <dt>{{ $locale.sfc.supportMe }}</dt>
          <dd>
            <a href="https://github.com/sponsors/tamaina" target="_blank" rel="noopener noreferrer">
              sponsors/tamaina
              <ExternalLink :size="15" aria-hidden="true" />
            </a>
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
aboutTitle: Fukushuについて
aboutIntro: Fukushuは、GIFT形式の問題集を読み込み、FSRSによって復習時期を決める学習用SPAです。問題を生成する機能はありません。
privacy: プライバシー
privacyBody: 問題集と学習履歴はIndexedDBを使ってこの端末内だけに保存され、サーバーへアップロードされません。ブラウザデータを削除すると失われる可能性があるため、設定画面から定期的にJSONバックアップを保存してください。
giftFsrs: GIFTとFSRS
giftFsrsBody: GIFTはMoodleなどで利用される問題交換形式です。FSRSは回答結果から次に復習する日時を計算する間隔反復アルゴリズムです。
openSource: オープンソース
openSourceBody: Vue、Vue Router、ts-fsrs、idb、DOMPurify、Marked、Lucide、Valibotなどを利用しています。各ライブラリはそれぞれのライセンスに従います。
production: 制作
author: 作者
sourceCode: ソースコード
supportMe: Support me
</locale>
<locale locale="en-US" lang="yaml">
aboutTitle: About Fukushu
aboutIntro: Fukushu imports GIFT decks and schedules reviews with FSRS. It does not generate questions.
privacy: Privacy
privacyBody: Decks and study history stay on this device in IndexedDB and are never uploaded. Browser data can be lost, so regularly save a JSON backup from Settings.
giftFsrs: GIFT and FSRS
giftFsrsBody: GIFT is a question exchange format used by Moodle and other tools. FSRS schedules the next review from your answers.
openSource: Open source
openSourceBody: Built with Vue, Vue Router, ts-fsrs, idb, DOMPurify, Marked, Lucide, Valibot, and other libraries under their respective licenses.
production: Production
author: Author
sourceCode: Source code
supportMe: Support me
</locale>
