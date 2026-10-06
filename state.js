/*! state.js | MIT License | Copyright (c) 2026 Isana Kashiwai */

function isJSONValue(value, stack = new WeakSet()) {
  if (value === null) return true

  switch (typeof value) {
    case 'string':
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

  stack.add(value)

  try {
    if (Array.isArray(value)) {
      // 通常の Array のみ許可
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return false
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
          !isJSONValue(descriptor.value, stack)
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
    const keys = Object.keys(value)

    // non-enumerable property を拒否
    if (names.length !== keys.length) {
      return false
    }

    for (const key of keys) {
      const descriptor =
        Object.getOwnPropertyDescriptor(value, key)

      // getter / setter を拒否
      if (
        !descriptor ||
        !('value' in descriptor) ||
        !isJSONValue(descriptor.value, stack)
      ) {
        return false
      }
    }

    return true
  } finally {
    stack.delete(value)
  }
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value))
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

  function load() {
    if (!storage) {
      return cloneJSON(initialValue)
    }

    try {
      const saved = storage.getItem(key)

      if (saved === null) {
        return cloneJSON(initialValue)
      }

      const parsed = JSON.parse(saved)

      return isJSONValue(parsed)
        ? parsed
        : cloneJSON(initialValue)
    } catch {
      return cloneJSON(initialValue)
    }
  }

  let currentValue = load()
  let currentJson = JSON.stringify(currentValue)
  let readonlyCache = new WeakMap()
  let locked = false

  const listeners = new Set()

  function commit(next) {
    if (!isJSONValue(next)) {
      throw new TypeError(
        'state.update() accepts JSON-compatible values only'
      )
    }

    const nextJson = JSON.stringify(next)

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