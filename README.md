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
theme = 'dark';
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
viewport.update(draft => {
  draft.ra = 120
})
```

この制約により、アロー関数の省略記法による意図しない戻り値もエラーになります。

```js
viewport.update(
  draft => draft.ra = 120
)
```

### state.value は読み取り専用

`state.value` を直接変更することはできません。

```js
viewport.value = {
  ra: 120,
  dec: 30,
  radius: 15
}
```

このコードはエラーになります。

```text
TypeError:
Reactive state is read-only.
Use state.update() to modify it.
```

オブジェクトの内部も直接変更できません。

```js
viewport.value.ra = 120
```

これもエラーになります。

配列操作も同様です。

```js
items.value.push(item)
```

変更するときは必ず `update()` を使用します。

```js
items.update(draft => {
  draft.push(item)
})
```


### 保持できるのは JSON 値のみ

state は、JSON として安全に保存・復元できるデータだけを扱います。J

SON 値だけを扱うことで、state に実行可能なコードや特殊なオブジェクトが混入することを防ぎ、扱うデータ構造とアタックサーフィスを小さく保ちます。ただし、入力データのサニタイズや XSS 対策は行いません。

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

循環参照、sparse array、Symbol property なども利用できません。


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

`subscribe()` を呼んだ時点では実行されません。


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

## Sample

### 共有 state

複数のモジュールから利用する値は、ひとつのモジュールにまとめられます。

```js
// app-state.js

import { createState } from './state.js'

export const State = {
  viewport: createState(
    {
      ra: 0,
      dec: 0,
      radius: 30
    },
    {
      storage: sessionStorage,
      key: 'viewport'
    }
  ),

  selectedObject: createState(null),

  theme: createState(
    'auto',
    {
      storage: localStorage,
      key: 'theme'
    }
  )
}
```

他のモジュールから:

```js
import { State } from './app-state.js'

console.log(State.viewport.value)
```

変更:

```js
State.viewport.update(draft => {
  draft.ra = 180
})
```

監視:

```js
State.viewport.subscribe(render)
```
