# state.js - observable state container

「プロジェクト全体を通して、どこからでも読み取れる共通の値を保持し、その値が変更されたときに通知する」ためのミニマムな状態管理コンテナです。

**state.js の3つの特徴「小さい・少ない・間違えにくい」**

- **小さい:** ビルドツール不要のシングルファイル構成
- **少ない:** 値の保持と変更通知に徹したシンプル設計
- **間違えにくい:** 誤った操作をその場で止める安全指向

より高度な状態管理が必要な場合は、Nano Stores などの専用ライブラリの利用をおすすめします。

ref. [nanostores/nanostores](https://github.com/nanostores/nanostores)

## インストール

`state.js` をダウンロードして、通常の ES Modules としてそのまま利用します。ビルドツールは不要です。

```html
<script type="module">
  import { createState } from './state.js'

  const count = createState(0)

  function render(value) {
    document.querySelector('#count').textContent = value
  }

  // 変更されたら render を実行
  count.subscribe(render)

  document.querySelector('#button').onclick = () => {
    count.update(count.value + 1)
  }

  // subscribe() は登録時には実行されないので、
  // 初期状態は state.value から取得する
  render(count.value)
</script>
```

## 基本的な使い方

値を保持します。

```js
import { createState } from './state.js'

const count = createState(0)
```

現在の値は `.value` から読み取ります。

```js
console.log(count.value)
```

値を変更します。

```js
count.update(1)
```

変更を監視します。

```js
function render(value, previous) {
  console.log(previous, '->', value)
}

count.subscribe(render)
```

監視を解除します。

```js
count.unsubscribe(render)
```

## API

`createState()` が返す state オブジェクトの公開 API は次の4つだけです。

```js
const state = createState(initialValue, options?)

state.value
state.update(...)
state.subscribe(listener)
state.unsubscribe(listener)
```

すべての操作を明示的に行うため、ソースコード上で state の読み取り・変更・監視を追いやすい設計です。

### 値を読む — `state.value`

現在値は `state.value` から取得します。

```js
const theme = createState('auto')

console.log(theme.value)
```

オブジェクトも同じように参照できます。

```js
const parameters = createState({
  ra: 0,
  dec: 0,
  radius: 30
})

console.log(parameters.value.ra)
```

`state.value` から取得した値は読み取り専用です。

### 値を変更する — `state.update()`

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

`state.value` に直接代入することはできません。

```js
theme.value = 'dark'
```

この操作はエラーになります。

これは、state の変更が必ず `update()` を通るようにするための意図的な制限です。

### オブジェクト・配列を変更する — `state.update(callback)`

オブジェクトや配列を変更するときは、`update()` に関数を渡します。

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

callback 形式の `update()` はオブジェクトと配列にだけ使用できます。プリミティブ値は新しい値を直接渡してください。

また、`update()` の処理中に同じ state に対して再度 `update()` を呼び出すことはできません。

```js
state.update(draft => {
  state.update(...) // エラー
  draft.value = 1
})
```

一回の更新が完了するまで、同じ state に次の更新を重ねないための制限です。

### 変更を監視する — `state.subscribe()`

`subscribe()` に listener を登録します。

```js
function render(value, previous) {
  console.log('new:', value)
  console.log('old:', previous)
}

parameters.subscribe(render)
```

listener には、更新後の値と更新前の値が渡されます。

```js
listener(currentValue, previousValue)
```

`subscribe()` を呼んだ時点では listener は実行されません。現在値が必要な場合は `state.value` から取得します。

```js
render(parameters.value)
parameters.subscribe(render)
```

`update()` の結果が現在の state と同じ JSON 表現になる場合、state の更新と listener への通知は行われません。

listener の実行も、その state の一回の `update()` の一部として扱われます。そのため、listener から同じ state を再度更新することはできません。

```js
stateA.subscribe(() => {
  stateA.update(...) // エラー
})
```

listener から別の state を更新することはできます。

```js
stateA.subscribe(value => {
  stateB.update(...)
})
```

ただし、更新が循環して、まだ処理中の state に戻ることはできません。

```text
stateA update
  ↓
stateA listener
  ↓
stateB update
  ↓
stateB listener
  ↓
stateA update  ← エラー
```

listener の呼び出し時に同期的に投げられた例外は、state.js が捕捉して console に出力し、他の listener の通知は継続します。そのため、同期的に実行される listener 内で禁止された `update()` を呼び出した場合も、その `TypeError` は元の `update()` の呼び出し元には伝播しません。

ただし、`async` 関数や Promise による非同期処理のエラーは捕捉しません。非同期処理を行う場合は、listener 内の `try / catch` や Promise の `.catch()` を使って、アプリケーション側でエラーを処理してください。

### 監視を解除する — `state.unsubscribe()`

登録した listener を解除します。

```js
parameters.unsubscribe(render)
```

`subscribe()` に渡したものと同じ関数を指定します。

```js
function render(value) {
  // ...
}

parameters.subscribe(render)

// later
parameters.unsubscribe(render)
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

実行中の正本はメモリ上の state です。

storage への保存に失敗しても、runtime state 自体は更新されます。

Web Storage は永続化のためだけに使用します。Web Storage そのものの変更は監視しません。

そのため、別のタブやウィンドウで同じ storage key が変更されても state.js には通知されません。

```text
Web Storage
    ↓ load

 State
    ↓ save

Web Storage
```

### schema について

state.js は Web Storage から読み込んだ値について、JSON として扱えることだけを確認します。

アプリケーション固有のデータ構造、必須項目、バージョンの検証や migration は行いません。

保存形式を変更する場合は、

```js
key: 'settings:v2'
```

のように storage key をバージョン化するなど、アプリケーション側で管理してください。

## 制約

state.js では、state であることをコード上で明示し、意図しない直接代入や破壊的変更を防ぐため、値の扱いにいくつかの制約を設けています。

### update の callback は値を返せない

`update()` に関数を渡す場合、その関数は仮引数として渡された変更用のコピーを書き換えるためだけに使用します。

値を `return` することはできません。

正しい例:

```js
parameters.update(draft => {
  draft.ra = 120
})
```

アロー関数の省略記法によって意図せず値を返した場合もエラーになります。

```js
parameters.update(
  draft => draft.ra = 120
)
```

配列メソッドにも注意してください。

```js
items.update(
  draft => draft.push(item)
)
```

`push()` は値を返すため、このコードもエラーになります。

波括弧を使用してください。

```js
items.update(draft => {
  draft.push(item)
})
```

### state.value は読み取り専用

`state.value` から取得できる値は読み取り専用です。

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

```text
TypeError:
Reactive state is read-only.
Use state.update() to modify it.
```

state の変更は必ず `update()` を使用します。

```js
parameters.update(draft => {
  draft.ra = 120
})

items.update(draft => {
  draft.push(item)
})
```

`state.value` のオブジェクトや配列は読み取り専用の Proxy です。そのため、`structuredClone()`、`postMessage()`、IndexedDB など、structured clone を使用する API にそのまま渡すことはできません。

通常の JSON 値として独立したコピーが必要な場合は、JSON としてコピーできます。

```js
const copy = JSON.parse(
  JSON.stringify(state.value)
)
```

`{ ...state.value }` や `[...state.value]` は浅いコピーなので、ネストしたオブジェクトや配列は読み取り専用のままです。

### 保持できるのは JSON 値のみ

state は、JSON として安全に保存・復元できるデータだけを扱います。

ここでいう JSON 値とは、

- `null`
- 文字列
- 有限の数値
- 真偽値
- それらからなる通常の配列
- それらからなるプレーンオブジェクト

を指します。

JSON 値だけに限定することで、実行可能なコードや特殊なオブジェクトを state に持ち込む余地を減らします。

ただし、入力データのサニタイズや XSS 対策を行うものではありません。

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

循環参照、sparse array、Symbol property、getter / setter、non-enumerable property なども利用できません。

配列は通常の `Array` のみ利用できます。`Array` を継承した独自クラスは利用できません。

## state.js がやらないこと

state.js は、小規模なWebページやUIで共有する状態を、単純かつ安全に扱うためのライブラリです。機能をしぼり、あえて制約を設けることで、コードが複雑化することを防ぎ、メンテナンス性を維持することを意図しています。より多くの機能が必要になった場合は、その用途に適した状態管理ライブラリやフレームワークへ移行することを検討してください。

### computed state / dependency tracking

複数の state から値を自動的に計算する computed state や、state 間の依存関係を自動的に追跡する機能はありません。

必要な処理は `subscribe()` などを使って明示的に記述します。

### 大規模・高頻度な state

state.js は更新時に state 全体をコピー・検証・シリアライズします。

そのため、大量のデータを保持したり、アニメーションのように高頻度で更新したりする用途には向いていません。

変更部分だけを共有する構造的共有や、参照比較を利用した差分更新も行いません。

### async / data fetching の抽象化

fetch、キャッシュ、ローディング状態、エラー状態などを特別に扱う機能はありません。

必要な場合は、それらを通常の state として表現します。

```js
const data = createState({
  status: 'idle',
  value: null,
  error: null
})
```

### DOM / framework 機能

ルーティング、DOM更新、フォームバインディング、ライフサイクル管理などは行いません。

state.js が行うのは、

- 値を保持する
- 値を安全に変更する
- 変更を通知する
- 必要なら Web Storage に保存する

ことだけです。


## Sample

### フォームの内容が変更されたら、UIに即座に反映させる

フォームの更新とUIの間に state を挟むことで、入力と出力を疎結合にできます。

```js
const parameters = createState({
  mass: 10,
  velocity: 20,
  angle: 45
})

// フォーム要素は state を更新するだけ
massInput.addEventListener('input', event => {
  parameters.update(draft => {
    draft.mass = Number(event.target.value)
  })
})

velocityInput.addEventListener('input', event => {
  parameters.update(draft => {
    draft.velocity = Number(event.target.value)
  })
})

angleInput.addEventListener('input', event => {
  parameters.update(draft => {
    draft.angle = Number(event.target.value)
  })
})

// 計算や表示は state の変更を監視する
parameters.subscribe(value => {
  const result = calculate(value)
  renderResult(result)
})

// 後から表示処理を追加しても、入力側を変更する必要はない
parameters.subscribe(value => {
  updateChart(value)
})
```

入力側は計算や表示の内容を知る必要がありません。

出力側も、どのフォーム要素が変更されたかを知る必要はありません。

### アンケートやメールフォームの入力チェック・分岐を制御する

ユーザーの入力値によってフォームの内容を変化させたい場合も、フォーム要素のイベントとUI制御を切り離せます。

```js
const answers = createState({
  age: null,
  hasCar: null,
  carType: null,
  email: ''
})

// 入力側は state を更新するだけ
ageInput.addEventListener('input', event => {
  answers.update(draft => {
    draft.age =
      event.target.value === ''
        ? null
        : Number(event.target.value)
  })
})

hasCarInput.addEventListener('change', event => {
  answers.update(draft => {
    draft.hasCar = event.target.value === 'yes'
  })
})

// 入力内容によってUIを切り替える
answers.subscribe(value => {
  carSection.hidden = value.hasCar !== true
})

// 現在の state だけを見て入力完了を判定する
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

### コンポーネント間で値を共有する

同じページ・同じ JavaScript 実行環境内で、共有モジュールから export した state を import することで、複数のコンポーネントから同じ state を参照できます。

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

appState.update(draft => {
  draft.status = 'ready'
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

function render(value) {
  // ...
}

// subscribe() は登録時には呼ばれないので初期値を先に描画する
render(appState.value)

appState.subscribe(render)
```

共有されるのは同じ JavaScript 実行環境内の state です。

別タブ、iframe、Web Worker などの異なる実行環境との状態同期は state.js の役割には含みません。


### state を直接公開せず、操作APIを作る

state.js の state は、そのまま外部に公開する必要はありません。

`createState()` で作った state をモジュール内部に保持し、普通の JavaScript 関数から `update()` することで、アプリケーション固有の操作APIを作ることもできます。

以下は、温度を摂氏・華氏・絶対温度で保持し、どの単位から変更しても3つの値が同時に更新されるAPIの例です。

```js
import { createState } from './state.js'

function createTemperatureControl() {
  const state = createState({
    celsius: 20,
    fahrenheit: 68,
    kelvin: 293.15
  })

  return {
    setCelsius(celsius) {
      state.update(draft => {
        draft.celsius = celsius
        draft.fahrenheit = celsius * 9 / 5 + 32
        draft.kelvin = celsius + 273.15
      })
    },

    setFahrenheit(fahrenheit) {
      state.update(draft => {
        draft.fahrenheit = fahrenheit
        draft.celsius = (fahrenheit - 32) * 5 / 9
        draft.kelvin = draft.celsius + 273.15
      })
    },

    get value() {
      return state.value
    },

    subscribe(listener) {
      state.subscribe(listener)
    },

    unsubscribe(listener) {
      state.unsubscribe(listener)
    }
  }
}

const temperature = createTemperatureControl()

temperature.setCelsius(25)

console.log(temperature.value)
// {
//   celsius: 25,
//   fahrenheit: 77,
//   kelvin: 298.15
// }
```

外部から見ると、使っているのは普通の関数です。

```js
temperature.setCelsius(25)
temperature.setFahrenheit(86)
```

しかし内部では、複数の値がひとつの `update()` の中でまとめて変更され、整合した state として一度だけ確定・通知されます。

このように、state.js 自体に action や reducer などの仕組みはありませんが、必要であれば普通の JavaScript の関数やクロージャを使って、state の上にアプリケーション固有のAPIを構築できます。

## 開発・テスト

Node.js の標準テストランナーで回帰テストを実行できます。追加パッケージのインストールは不要です。

```sh
node --test tests/state.test.mjs
```

通常版の `state.js` と min 版の `state.min.js` の両方について、JSON 値の制約、読み取り専用保護、更新・通知、再入制限、Storage の復元と失敗処理を検証します。
