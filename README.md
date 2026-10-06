# state.js - observable state container

「プロジェクト全体を通して、どこからでも読み取れる共通の値を保持し、その値が変更されたときに通知する」ためのミニマムな状態管理コンテナです。

**state.js の3つの特徴「小さい・少ない・間違えにくい」**

- **小さい:** ビルドツール不要のシングルファイル構成
- **少ない:** 値の保持と変更通知に徹したシンプル設計
- **間違えにくい:** 誤った操作をその場で止める安全指向

より高度な状態管理が必要な場合は、Nano Stores などの専用ライブラリの利用をおすすめします。  
ref. [nanostores/nanostores: A tiny (340 bytes) state manager for React/RN/Preact/Vue/Svelte with many atomic tree-shakable stores](https://github.com/nanostores/nanostores)

## インストール

ダウンロードして、通常の ES Modules としてそのまま利用します。ビルドツールは不要です。

```html
<script type="module">
  // ライブラリをES Modulesで読み込んで
  import { createState } from './state.js'

  // createState で値を保持
  const count = createState(0)

  function render(value) {
    document.querySelector('#count').textContent = value
  }
　 // subscribe で値を監視（変更されたら render を実行）
  count.subscribe(render)

  document.querySelector('#button').onclick = () => {
    // ボタンを押したら値を変更（値が変わるとrenderが実行されて表示が変わる）
    count.update(count.value + 1)
  }
　 //初期表示用(subscribeしただけではrenderは動かないので最初に一回だけ実行する)
  render(count.value)
</script>
```

## 基本的な使い方

値を保持する:
```js
import { createState } from './state.js'

const count = createState(0)
```

現在の値を読む:

```js
console.log(count.value)
```

値を変更する:

```js
count.update(1)
```

変更を監視する:

```js
function render(value, previous) {
  console.log(previous, '->', value)
}

count.subscribe(render)
```

監視を解除する:

```js
count.unsubscribe(render)
```

## API

公開 API は次の4つだけです。

```js
const state = createState(initialValue, options?)

state.value
state.update(...)
state.subscribe(listener)
state.unsubscribe(listener)
```
いずれも操作は明示的に行われるので、ソースコード内での操作が見えやすい、という特徴があります。


### 値を読む

現在値は `state.value` から取得します。

```js
const theme = createState('auto')

console.log(theme.value)
```

オブジェクトもそのまま参照できます。

```js
const parameters = createState({
  ra: 0,
  dec: 0,
  radius: 30
})

console.log(parameters.value.ra)
```


### 値を変更する

変更は必ず `state.update()` を使用します。

プリミティブ値の場合は、新しい値を直接渡します。

```js
const count = createState(0)

count.update(count.value + 1)
```

```js
const theme = createState('auto')

theme.update('dark')
```

【注意】
createStateで生成された値は、直接変更しようとするとエラーになります。  
以下の操作はできません。値を変更する場合には、必ず `update` を使用します。
```
theme.value = 'dark'
```
これは、意図せずに監視対象の値を変更しないための意図な制限です。


### オブジェクトや配列を変更する

関数には、現在の state をコピーした変更可能な値が仮引数として渡されます。  
仮引数名は任意です。以下では `draft` という名前を使っています。

```js
const parameters = createState({
  ra: 0,
  dec: 0,
  radius: 30
})

parameters.update(draft => {
  draft.ra = 120
  draft.radius = 15
})
```

配列も通常の配列として操作できます。

```js
const items = createState([])

items.update(draft => {
  draft.push({
    id: 1,
    name: 'Mars'
  })
})
```

変更処理が終わると、仮引数として渡された値全体が新しい state として確定されます。

storage への保存と listener への通知は1回だけ行われます。


## 制約
state.js では、state であることをコード上で明示し、意図しない直接代入や破壊的変更を防ぐため、値の扱いにいくつかの制約を設けています。

### update の callback は値を返せない

`update()` に関数を渡す場合、その関数は仮引数として渡された変更用のコピーを書き換えるためだけに使用します。値を return することはできません。

正しい例:

```js
parameters.update(draft => {
  draft.ra = 120
})
```

この制約により、アロー関数の省略記法による意図しない戻り値もエラーになります。

```js
parameters.update(
  draft => draft.ra = 120
)
```

### state.value は読み取り専用

state.value から取得できる値は読み取り専用です。

プリミティブ値だけでなく、オブジェクトや配列、その内部にあるネストしたオブジェクトや配列も直接変更することはできません。

```js
parameters.value = {
  ra: 120,
  dec: 30
}

parameters.value.ra = 120

items.value.push(item)
```

これらの操作はすべてエラーになります。

```
TypeError:
Reactive state is read-only.
Use state.update() to modify it.
```

state の変更は必ず update() を使用します。

```js
viewport.update(draft => {
  draft.ra = 120
})
```

```js

items.update(draft => {
  draft.push(item)
})
```

### 保持できるのは JSON 値のみ

state は、JSON として安全に保存・復元できるデータだけを扱います。ここでいう JSON 値とは、null、文字列、有限の数値、真偽値、およびそれらからなる配列・プレーンオブジェクトを指します。JSON 値だけに限定することで、実行可能なコードや特殊なオブジェクトを state に持ち込む余地を減らします。ただし、入力データのサニタイズや XSS 対策は行いません。

利用可能な値:

```js
null
'hello'
42
true

[1, 2, 3]

{
  ra: 120,
  dec: 30
}
```

利用できない値:

```js
undefined
NaN
Infinity
10n

new Date()
new Map()
new Set()

() => {}
```

循環参照、sparse array、Symbol property なども利用できません。配列は通常の Array のみ利用できます。Array を継承した独自クラスは利用できません。


## 変更を監視する

`subscribe()` に listener を登録します。

```js
function render(value, previous) {
  console.log('new:', value)
  console.log('old:', previous)
}

viewport.subscribe(render)
```

listener は state が更新されたときに呼び出されます。

```js
listener(currentValue, previousValue)
```

`subscribe()` を呼んだ時点では実行されません。また、update() を呼んでも state の内容に変更がなければ listener は呼び出されません。

【注意】listener の実行中に、同じ state に対して update() を呼び出すことはできません。通知中の再更新は listener ごとの通知順序を不定にするため、エラーになります。必要な変更は元の update() にまとめるか、別の state を更新してください。

以下のような操作はできません。
```js
stateA.subscribe(value => {
  stateA.update(...)
})
``` 
以下のような操作は問題なく行えます。
```js
stateA.subscribe(value => {
  stateB.update(...)
})
``` 

## 監視を解除する

登録した listener を明示的に解除します。

```js
viewport.unsubscribe(render)
```

登録時に使ったものと同じ関数を渡します。

```js
function render(value) {
  // ...
}

viewport.subscribe(render)

// later

viewport.unsubscribe(render)
```

## Web Storage

state は任意で `sessionStorage` または `localStorage` に保存できます。

### sessionStorage

```js
const viewport = createState(
  {
    ra: 0,
    dec: 0,
    radius: 30
  },
  {
    storage: sessionStorage,
    key: 'viewport'
  }
)
```

通常、ページを再読み込みしても値は保持され、ブラウザのタブやセッションを閉じると破棄されます。

### localStorage

```js
const settings = createState(
  {
    theme: 'auto'
  },
  {
    storage: localStorage,
    key: 'settings'
  }
)
```

ブラウザを閉じても値が保持されます。

### runtime state と storage

実行中の正本はメモリ上の state です。storage への保存に失敗しても、runtime state 自体は更新されます。

Web Storage は永続化のためだけに使用しています。Web Storageそのものの変更を監視しているわけではないので、タブやウィンドウを跨いだ通知は行いません。

```text
Web Storage
    ↓ load

 State
    ↓ save

Web Storage
```

state.js は Web Storage から読み込んだ値について、JSONとして扱えることだけを確認します。アプリケーション固有のデータ構造やバージョンの検証、migration は行いません。保存形式を変更する場合は、settings:v2 のように storage key をバージョン化するなど、アプリケーション側で管理してください。


## state.js でできないこと／やらないこと

state.js は、小規模なWebページやUIで共有する状態を、できるだけ単純かつ安全に扱うためのライブラリです。

状態管理ライブラリ全般が持つ機能を網羅することは目的としていません。

### 派生 state や computed state は作りません

複数の state から自動的に値を計算したり、依存関係を追跡したりする機能はありません。

必要な処理は `subscribe()` の中で明示的に行います。

複雑な依存関係を持つリアクティブな状態管理が必要な場合は、Nano Stores などの専用ライブラリを利用してください。

### 大きな state や高頻度更新には向いていません

state.js は更新時に state 全体をコピー・検証・シリアライズします。

そのため、大量のデータを保持したり、アニメーションのように高頻度で state を更新したりする用途には向いていません。

変更箇所だけを共有する構造的共有や、参照比較を利用した差分更新も行いません。

### listener から同じ state を更新できません

listener の実行中に、同じ state に対して `update()` を呼び出すことはできません。

```js
state.subscribe(() => {
  state.update(...)
})
```

この操作はエラーになります。

通知中に同じ state を再度変更すると listener ごとの通知順序が不明確になるため、state.js では明示的に禁止しています。

必要な変更は元の `update()` にまとめるか、別の state を更新してください。

### Web Storage の同期は行いません

`localStorage` や `sessionStorage` は state の保存と復元にのみ使用します。

Web Storage 自体の変更は監視しないため、別のタブやウィンドウで同じ storage key が変更されても state.js には通知されません。

複数のブラウジングコンテキスト間で状態を同期する機能はありません。

### 保存データの schema 管理は行いません

Web Storage から読み込んだ値について、state.js が確認するのは JSON として扱えるデータであることだけです。

アプリケーション固有のデータ構造、必須項目、バージョンの検証や migration は行いません。

保存形式を変更する場合は、

```js
key: 'settings:v2'
```

のように storage key をバージョン化するなど、アプリケーション側で管理してください。

### 非同期処理やデータ取得は行いません

state.js は fetch、非同期処理、キャッシュ、ローディング状態、エラー状態などを特別には扱いません。

必要であれば、それらを通常の state として表現します。

```js
const data = createState({
  status: 'idle',
  value: null,
  error: null
})
```

### フレームワークではありません

ルーティング、DOM更新、フォームバインディング、ライフサイクル管理などは行いません。

state.js が行うのは、

- 値を保持する
- 値を安全に変更する
- 変更を通知する
- 必要なら Web Storage に保存する

ことだけです。

より多くの機能が必要になった場合は、state.js を拡張するより、その用途に適した状態管理ライブラリやフレームワークへ移行することを想定しています。

## Sample

### フォームの内容が変更されたら、UIに即座に反映させる
フォームの更新とUIの間にstateを挟むことで、入力と出力を疎結合にすることができます。

```js
// createState()でパラメータを初期化。
const parameters = createState({
  mass: 10,
  velocity: 20,
  angle: 45
})

// フォーム要素は、計算内容や表示には触らずにデータを更新するだけ
massInput.addEventListener('input', event => {
  parameters.update(value => {
    value.mass = Number(event.target.value)
  })
})

velocityInput.addEventListener('input', event => {
  parameters.update(value => {
    value.velocity = Number(event.target.value)
  })
})

angleInput.addEventListener('input', event => {
  parameters.update(value => {
    value.angle = Number(event.target.value)
  })
})


// subscribeでデータの更新を検知して、計算や表示を行う。
parameters.subscribe(value => {
  const result = calculate(value)
  renderResult(result)
})

//後からグラフを描きたくなっても、subscribeを追加するだけ。
parameters.subscribe(value => {
  updateChart(value)
})

```


### アンケートやメールフォームなどの空欄チェックや分岐を制御する
ユーザーの入力値によってフォームの内容そのものを変化させたい場合などでも、フォーム要素のイベントとUIの制御を切り離すことができます。

```js
// createState()でパラメータを初期化。
const answers = createState({
  age: null,
  hasCar: null,
  carType: null,
  email: ''
})

// フォーム要素は、計算内容や表示には触らずにデータを更新するだけ。
ageInput.addEventListener('input', e => {
  answers.update(value => {
    value.age = Number(e.target.value)
  })
})

hasCarInput.addEventListener('change', e => {
  answers.update(value => {
    value.hasCar = e.target.value === 'yes'
  })
})

// subscribeでデータ更新のタイミングで処理を走らせる
// 空欄をチェックする
answers.subscribe(value => {
  const complete =
    value.age !== null &&
    value.hasCar !== null &&
    value.email !== ''

  submitButton.disabled = !complete
})

//車を持っていなかったら、車のセクションを隠す
answers.subscribe(value => {
  carSection.hidden = value.hasCar !== true
})

//車を持っている人だけ、carTypeを必須にする
answers.subscribe(value => {
  const complete =
    value.age !== null &&
    value.hasCar !== null &&
    value.email !== '' &&
    (
      value.hasCar === false ||
      value.carType !== null
    )

  submitButton.disabled = !complete
})

```

### コンポーネント間で値を共有する。
同じページ・JavaScript実行環境内で、共有モジュールから export した state を import することで、複数のコンポーネントから同じ state を参照できます。

```js
// app-state.js
import { createState } from './state.js'

export const appState = createState({
  status: 'idle',
  data: null
})
```

Component A:
```js
import { appState } from './app-state.js'
appState.update(state => {
  state.status = 'ready'
})
```

Component B:
```js
import { appState } from './app-state.js'
console.log(appState.value.status)
```

Component C:
```js
import { appState } from './app-state.js'
render(appState.value); // subscribeしただけでは実行されないので、初期状態を表示するために最初に実行する必要があります。
appState.subscribe(render)
```
