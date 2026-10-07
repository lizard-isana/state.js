/*! state.js | MIT License | Copyright (c) 2026 Isana Kashiwai */

const MAX_DEPTH = 16
const MAX_VALUES = 4096
const MAX_JSON_LENGTH = 65536

function checkJSONLength(length) {
  if (length > MAX_JSON_LENGTH) {
    throw new RangeError(
      `State JSON must not exceed ${MAX_JSON_LENGTH} UTF-16 code units`
    )
  }
}

function isJSONValue(
  value,
  stack = new WeakSet(),
  budget = { values: 0, length: 0 },
  depth = 0
) {
  // 共有参照も出現するたびに数え、JSON 展開後の処理量を制限する
  if (++budget.values > MAX_VALUES) {
    throw new RangeError(`State must not exceed ${MAX_VALUES} values`)
  }

  if (value === null) return true

  switch (typeof value) {
    case 'string':
      budget.length += value.length
      checkJSONLength(budget.length)
      return true

    case 'boolean':
      return true

    case 'number':
      return Number.isFinite(value)

    case 'object':
      break

    default:
      return false
  }

  if (stack.has(value)) {
    return false
  }

  // オブジェクト・配列だけを階層として数える。ルートは1階層。
  if (depth >= MAX_DEPTH) {
    throw new RangeError(`State must not exceed ${MAX_DEPTH} object/array levels`)
  }

  stack.add(value)

  try {
    if (Array.isArray(value)) {
      // 通常の Array のみ許可
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return false
      }

      if (value.length > MAX_VALUES - budget.values) {
        throw new RangeError(`State must not exceed ${MAX_VALUES} values`)
      }

      if (Object.getOwnPropertySymbols(value).length > 0) {
        return false
      }

      const names = Object.getOwnPropertyNames(value)

      // indices + "length" 以外の property を拒否
      if (names.length !== value.length + 1) {
        return false
      }

      for (let i = 0; i < value.length; i++) {
        const descriptor =
          Object.getOwnPropertyDescriptor(value, String(i))

        if (
          !descriptor ||
          !descriptor.enumerable ||
          !('value' in descriptor) ||
          !isJSONValue(descriptor.value, stack, budget, depth + 1)
        ) {
          return false
        }
      }

      return true
    }

    // plain object のみ
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return false
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      return false
    }

    const names = Object.getOwnPropertyNames(value)

    if (names.length > MAX_VALUES - budget.values) {
      throw new RangeError(`State must not exceed ${MAX_VALUES} values`)
    }

    for (const key of names) {
      budget.length += key.length
      checkJSONLength(budget.length)

      const descriptor =
        Object.getOwnPropertyDescriptor(value, key)

      // non-enumerable property / getter / setter を拒否
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        !isJSONValue(descriptor.value, stack, budget, depth + 1)
      ) {
        return false
      }
    }

    return true
  } finally {
    stack.delete(value)
  }
}

function stringifyJSON(value) {
  const json = JSON.stringify(value)
  checkJSONLength(json.length)
  return json
}

function cloneJSON(value) {
  return JSON.parse(stringifyJSON(value))
}

function failMutation() {
  throw new TypeError(
    'Reactive state is read-only. Use state.update() to modify it.'
  )
}

function createReadonly(value, cache) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value
  }

  if (cache.has(value)) {
    return cache.get(value)
  }

  const proxy = new Proxy(value, {
    get(target, property, receiver) {
      return createReadonly(
        Reflect.get(target, property, receiver),
        cache
      )
    },

    // Object.getOwnPropertyDescriptor() 経由でも
    // 内部オブジェクトへの生の参照を返さない
    getOwnPropertyDescriptor(target, property) {
      const descriptor =
        Reflect.getOwnPropertyDescriptor(target, property)

      if (
        descriptor &&
        'value' in descriptor
      ) {
        return {
          ...descriptor,
          value: createReadonly(
            descriptor.value,
            cache
          )
        }
      }

      return descriptor
    },

    set: failMutation,
    deleteProperty: failMutation,
    defineProperty: failMutation,
    setPrototypeOf: failMutation,
    preventExtensions: failMutation
  })

  cache.set(value, proxy)

  return proxy
}

export function createState(initialValue, options = {}) {
  const { storage, key } = options

  if (!isJSONValue(initialValue)) {
    throw new TypeError(
      'createState() accepts JSON-compatible values only'
    )
  }

  if (
    storage &&
    (typeof key !== 'string' || key.length === 0)
  ) {
    throw new TypeError(
      'createState() requires a non-empty key when storage is provided'
    )
  }

  const initialJson = stringifyJSON(initialValue)

  function load() {
    if (storage) {
      try {
        const saved = storage.getItem(key)

        if (saved !== null) {
          // 解析前に入力長を制限し、解析後に構造と正規化した長さを検証する
          checkJSONLength(saved.length)
          const parsed = JSON.parse(saved)

          if (isJSONValue(parsed)) {
            return { value: parsed, json: stringifyJSON(parsed) }
          }
        }
      } catch {
        // 読み込みに失敗した場合は初期値に戻す
      }
    }

    return { value: JSON.parse(initialJson), json: initialJson }
  }

  let { value: currentValue, json: currentJson } = load()
  let readonlyCache = new WeakMap()
  let locked = false

  const listeners = new Set()

  function commit(next) {
    if (!isJSONValue(next)) {
      throw new TypeError(
        'state.update() accepts JSON-compatible values only'
      )
    }

    const nextJson = stringifyJSON(next)

    // JSONとして文字列化した結果が同一なら何もしない
    if (currentJson === nextJson) {
      return
    }

    const previous = currentValue
    const previousCache = readonlyCache

    // caller が保持している参照と内部 state を切り離す。
    // すでに stringify 済みなので再度 stringify しない。
    const committed = JSON.parse(nextJson)

    if (storage) {
      try {
        storage.setItem(key, nextJson)
      } catch (error) {
        console.error(
          `[state] Failed to save key "${key}":`,
          error
        )
      }
    }

    currentValue = committed
    currentJson = nextJson
    readonlyCache = new WeakMap()

    const currentView =
      createReadonly(currentValue, readonlyCache)

    // 更新前に取得済みの state.value と
    // 同じ世代の readonly Proxy を再利用する
    const previousView =
      createReadonly(previous, previousCache)

    for (const listener of [...listeners]) {
      try {
        listener(currentView, previousView)
      } catch (error) {
        console.error(
          '[state] Uncaught error in listener:',
          error
        )
      }
    }
  }

  return {
    get value() {
      return createReadonly(
        currentValue,
        readonlyCache
      )
    },

    set value(_) {
      failMutation()
    },

    update(updater) {
      // mutator の実行開始から listener の通知終了まで、
      // 同じ state への再入 update を禁止する
      if (locked) {
        throw new TypeError(
          'state.update() cannot be called while the same state is updating'
        )
      }

      locked = true

      try {
        if (typeof updater !== 'function') {
          commit(updater)
          return
        }

        if (
          currentValue === null ||
          typeof currentValue !== 'object'
        ) {
          throw new TypeError(
            'state.update(mutator) requires an object or array state; ' +
            'pass the next JSON value directly instead'
          )
        }

        const draft = cloneJSON(currentValue)
        const result = updater(draft)

        if (result !== undefined) {
          throw new TypeError(
            'state.update(mutator) must not return a value; ' +
            'mutate the draft instead'
          )
        }

        commit(draft)
      } finally {
        locked = false
      }
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError(
          'state.subscribe() requires a function'
        )
      }

      listeners.add(listener)
    },

    unsubscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError(
          'state.unsubscribe() requires a function'
        )
      }

      listeners.delete(listener)
    }
  }
}
