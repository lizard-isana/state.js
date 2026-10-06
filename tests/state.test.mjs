import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

function captureErrors(callback) {
  const original = console.error
  const errors = []
  console.error = (...args) => errors.push(args)

  try {
    callback(errors)
  } finally {
    console.error = original
  }
}

const invalidValues = [
  ['undefined', () => undefined],
  ['NaN', () => NaN],
  ['Infinity', () => Infinity],
  ['negative Infinity', () => -Infinity],
  ['BigInt', () => 1n],
  ['Symbol', () => Symbol('value')],
  ['function', () => () => {}],
  ['Date', () => new Date(0)],
  ['Map', () => new Map()],
  ['Set', () => new Set()],
  ['class instance', () => new (class Value {})()],
  ['null prototype', () => Object.create(null)],
  ['circular reference', () => {
    const value = {}
    value.self = value
    return value
  }],
  ['sparse array', () => [, 1]],
  ['array subclass', () => new (class Values extends Array {})(1)],
  ['array with extra property', () => Object.assign([1], { extra: 2 })],
  ['object with Symbol property', () => ({ [Symbol('key')]: 1 })],
  ['array with Symbol property', () => Object.assign([1], { [Symbol('key')]: 2 })],
  ['non-enumerable object property', () => Object.defineProperty({}, 'hidden', { value: 1 })],
  ['non-enumerable array index', () => Object.defineProperty([1], '0', { enumerable: false })],
  ['object getter', () => Object.defineProperty({}, 'value', {
    enumerable: true,
    get() { throw new Error('getter must not run') }
  })],
  ['object setter', () => Object.defineProperty({}, 'value', {
    enumerable: true,
    set(_) {}
  })],
  ['array getter', () => Object.defineProperty([1], '0', {
    enumerable: true,
    get() { throw new Error('getter must not run') }
  })]
]

for (const file of ['state.js', 'state.min.js']) {
  // Load the browser ES module without requiring package.json or build tools.
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  const { createState } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  )

  describe(file, () => {
    it('exposes only the four documented operations', () => {
      const state = createState(0)
      assert.deepEqual(Object.keys(state), ['value', 'update', 'subscribe', 'unsubscribe'])
    })

    it('accepts JSON primitives and nested data', () => {
      for (const value of [null, true, false, '', '日本語', 0, -2, 1.5, [], {}, { a: [null, { b: true }] }]) {
        assert.deepEqual(JSON.parse(JSON.stringify(createState(value).value)), value)
      }
    })

    for (const [name, makeValue] of invalidValues) {
      it(`rejects ${name} during creation and update`, () => {
        const value = makeValue()
        assert.throws(() => createState(value), {
          name: 'TypeError', message: /JSON-compatible values only/
        })

        const state = createState({ count: 0 })
        const previous = state.value
        let calls = 0
        state.subscribe(() => { calls++ })
        // Nest functions so update() treats them as data rather than mutators.
        assert.throws(() => state.update({ payload: value }), {
          name: 'TypeError', message: /JSON-compatible values only/
        })
        assert.equal(state.value, previous)
        assert.equal(calls, 0)
        state.update({ count: 1 })
        assert.equal(state.value.count, 1)
        assert.equal(calls, 1)
      })
    }

    it('accepts frozen data and repeated references without treating them as cycles', () => {
      const child = Object.freeze({ count: 1 })
      const state = createState(Object.freeze({ a: child, b: child }))
      state.update(draft => { draft.a.count = 2 })
      assert.deepEqual(JSON.parse(JSON.stringify(state.value)), {
        a: { count: 2 }, b: { count: 1 }
      })
      assert.deepEqual(createState(Object.freeze([1, 2])).value, [1, 2])
    })

    it('treats prototype-related property names as ordinary data', () => {
      const input = JSON.parse('{"__proto__":{"flag":true},"constructor":{"id":1},"toJSON":"data"}')
      const state = createState(input)
      assert.deepEqual(JSON.parse(JSON.stringify(state.value)), input)
      assert.equal(Object.prototype.flag, undefined)
      assert.throws(() => { state.value.__proto__.flag = false }, TypeError)
    })

    it('isolates the initial input, direct replacements, and retained drafts', () => {
      const input = { child: { count: 0 } }
      const state = createState(input)
      input.child.count = 9
      assert.equal(state.value.child.count, 0)

      const replacement = { child: { count: 1 } }
      state.update(replacement)
      replacement.child.count = 9
      assert.equal(state.value.child.count, 1)

      let retained
      state.update(draft => { retained = draft; draft.child.count = 2 })
      retained.child.count = 9
      assert.equal(state.value.child.count, 2)
    })

    it('blocks direct mutations, reflection, and mutations through shallow copies', () => {
      const state = createState({ child: { count: 1 }, items: [{ id: 2 }] })
      const operations = [
        () => { state.value = {} },
        () => { state.value.child.count = 9 },
        () => { delete state.value.child.count },
        () => Object.defineProperty(state.value.child, 'count', { value: 9 }),
        () => Object.setPrototypeOf(state.value.child, null),
        () => Object.preventExtensions(state.value.child),
        () => state.value.items.push({ id: 3 }),
        () => state.value.items.splice(0, 1),
        () => { Object.getOwnPropertyDescriptor(state.value, 'child').value.count = 9 },
        () => { Object.getOwnPropertyDescriptors(state.value.items)['0'].value.id = 9 },
        () => { ({ ...state.value }).child.count = 9 },
        () => { [...state.value.items][0].id = 9 }
      ]
      for (const operation of operations) {
        assert.throws(operation, { name: 'TypeError', message: /read-only/ })
      }
      assert.deepEqual(JSON.parse(JSON.stringify(state.value)), { child: { count: 1 }, items: [{ id: 2 }] })
    })

    it('allows independent JSON copies but rejects structured cloning of readonly views', () => {
      const state = createState({ child: { count: 1 } })
      const copy = JSON.parse(JSON.stringify(state.value))
      copy.child.count = 9
      assert.equal(state.value.child.count, 1)
      assert.throws(() => structuredClone(state.value), { name: 'DataCloneError' })
    })

    it('preserves view identity within a generation, including previous listener values', () => {
      const state = createState({ child: { count: 1 } })
      const previous = state.value
      const previousChild = previous.child
      assert.equal(state.value, previous)
      assert.equal(Object.getOwnPropertyDescriptor(previous, 'child').value, previousChild)
      const received = []
      state.subscribe((current, old) => {
        received.push([current, old])
      })
      state.update(draft => { draft.child.count = 2 })
      assert.equal(received.length, 1)
      const [current, old] = received[0]
      assert.equal(current, state.value)
      assert.equal(old, previous)
      assert.equal(old.child, previousChild)
      assert.equal(old.child.count, 1)
      assert.equal(current.child.count, 2)
      assert.throws(() => { old.child.count = 3 }, TypeError)
      assert.notEqual(state.value, previous)
      assert.equal(previousChild.count, 1)
    })

    it('suppresses commits, storage writes, and notifications for the same JSON representation', () => {
      const writes = []
      const state = createState({ count: 1 }, {
        key: 'count', storage: { getItem: () => null, setItem: (...args) => writes.push(args) }
      })
      const previous = state.value
      let calls = 0
      state.subscribe(() => { calls++ })
      state.update({ count: 1 })
      state.update(() => {})
      assert.equal(state.value, previous)
      assert.equal(calls, 0)
      assert.deepEqual(writes, [])
      state.update({ count: 2 })
      assert.equal(calls, 1)
      assert.deepEqual(writes, [['count', '{"count":2}']])
    })

    it('compares JSON representations rather than unordered object contents', () => {
      const state = createState({ a: 1, b: 2 })
      let calls = 0
      state.subscribe(() => { calls++ })
      state.update({ b: 2, a: 1 })
      assert.equal(calls, 1)
      assert.equal(JSON.stringify(state.value), '{"b":2,"a":1}')
    })

    it('commits all object and array draft edits in one update', () => {
      const writes = []
      const state = createState({ count: 0, items: [] }, {
        key: 'data', storage: { getItem: () => null, setItem: (...args) => writes.push(args) }
      })
      let calls = 0
      state.subscribe(() => { calls++ })
      state.update(draft => { draft.count = 1; draft.items.push({ id: 1 }, { id: 2 }) })
      assert.equal(calls, 1)
      assert.equal(writes.length, 1)
      assert.deepEqual(JSON.parse(writes[0][1]), { count: 1, items: [{ id: 1 }, { id: 2 }] })
      const array = createState([1])
      array.update(draft => { draft.push(2) })
      assert.deepEqual(array.value, [1, 2])
    })

    it('rolls back failed mutators and releases the update lock', () => {
      const writes = []
      const state = createState({ count: 0 }, {
        key: 'data', storage: { getItem: () => null, setItem: (...args) => writes.push(args) }
      })
      const previous = state.value
      let calls = 0
      state.subscribe(() => { calls++ })
      const failure = new Error('mutator failure')
      const failures = [
        draft => { draft.count = 1; throw failure },
        draft => draft.count = 1,
        draft => { draft.count = undefined },
        draft => { draft.count = 1; return Promise.resolve() }
      ]
      for (const mutator of failures) {
        assert.throws(() => state.update(mutator))
        assert.equal(state.value, previous)
        assert.equal(calls, 0)
        assert.deepEqual(writes, [])
      }
      state.update(draft => { draft.count = 1 })
      assert.equal(state.value.count, 1)
      assert.equal(calls, 1)
      assert.equal(writes.length, 1)
    })

    it('rejects mutators for primitive state and implicit array method returns', () => {
      for (const initial of [null, 0, '', false]) {
        const state = createState(initial)
        let invoked = false
        assert.throws(() => state.update(() => { invoked = true }), {
          name: 'TypeError', message: /requires an object or array state/
        })
        assert.equal(invoked, false)
        state.update(1)
        assert.equal(state.value, 1)
      }
      const state = createState([])
      assert.throws(() => state.update(draft => draft.push(1)), {
        name: 'TypeError', message: /must not return a value/
      })
      assert.deepEqual(state.value, [])
    })

    it('deduplicates subscriptions and supports repeated unsubscribe', () => {
      const state = createState(0)
      const received = []
      const listener = (...args) => received.push(args)
      state.subscribe(listener)
      state.subscribe(listener)
      assert.deepEqual(received, [])
      state.update(1)
      assert.deepEqual(received, [[1, 0]])
      state.unsubscribe(listener)
      state.unsubscribe(listener)
      state.update(2)
      assert.deepEqual(received, [[1, 0]])
      for (const value of [null, undefined, 1, {}, 'listener']) {
        assert.throws(() => state.subscribe(value), TypeError)
        assert.throws(() => state.unsubscribe(value), TypeError)
      }
    })

    it('takes a listener snapshot so subscription edits affect the next notification', () => {
      const state = createState(0)
      const calls = []
      const second = () => calls.push('second')
      const third = () => calls.push('third')
      state.subscribe(() => {
        calls.push('first')
        state.unsubscribe(second)
        state.subscribe(third)
      })
      state.subscribe(second)
      state.update(1)
      assert.deepEqual(calls, ['first', 'second'])
      state.update(2)
      assert.deepEqual(calls, ['first', 'second', 'first', 'third'])
    })

    it('logs synchronous listener failures and continues notifications', () => {
      captureErrors(errors => {
        const state = createState(0)
        const failure = new Error('listener failure')
        let calls = 0
        state.subscribe(() => { throw failure })
        state.subscribe(() => { calls++ })
        state.update(1)
        assert.equal(state.value, 1)
        assert.equal(calls, 1)
        assert.equal(errors.length, 1)
        assert.equal(errors[0][1], failure)
        state.update(2)
        assert.equal(state.value, 2)
        assert.equal(calls, 2)
      })
    })

    it('does not await listener promises; asynchronous failures are handled by the application', async () => {
      const state = createState(0)
      const failure = new Error('async listener failure')
      let task
      let calls = 0
      state.subscribe(() => {
        task = (async () => { throw failure })()
        return task
      })
      state.subscribe(() => { calls++ })
      assert.equal(state.update(1), undefined)
      assert.equal(state.value, 1)
      assert.equal(calls, 1)
      await assert.rejects(task, error => error === failure)
    })

    it('rejects reentry from a mutator and recovers after the rejected update', () => {
      const state = createState({ count: 0 })
      assert.throws(() => state.update(draft => {
        draft.count = 1
        state.update({ count: 2 })
      }), { name: 'TypeError', message: /same state is updating/ })
      assert.equal(state.value.count, 0)
      state.update({ count: 3 })
      assert.equal(state.value.count, 3)
    })

    it('locks the state while validating input and writing storage', () => {
      let state
      let storageCalls = 0
      let storageError
      const storage = {
        getItem: () => null,
        setItem() {
          storageCalls++
          try {
            state.update({ count: 9 })
          } catch (error) {
            storageError = error
          }
        }
      }
      state = createState({ count: 0 }, { storage, key: 'data' })
      let validationCalls = 0
      const input = new Proxy({ count: 1 }, {
        getOwnPropertyDescriptor(target, property) {
          validationCalls++
          assert.throws(() => state.update({ count: 9 }), /same state is updating/)
          return Reflect.getOwnPropertyDescriptor(target, property)
        }
      })
      state.update(input)
      assert.ok(validationCalls > 0)
      assert.equal(storageCalls, 1)
      assert.ok(storageError instanceof TypeError)
      assert.match(storageError.message, /same state is updating/)
      assert.equal(state.value.count, 1)
    })

    it('logs listener reentry errors, continues notification, and releases the lock', () => {
      captureErrors(errors => {
        const state = createState(0)
        let calls = 0
        state.subscribe(() => state.update(9))
        state.subscribe(() => { calls++ })
        state.update(1)
        assert.equal(state.value, 1)
        assert.equal(calls, 1)
        assert.match(errors[0][1].message, /same state is updating/)
        state.update(2)
        assert.equal(state.value, 2)
        assert.equal(calls, 2)
      })
    })

    it('allows updates to other states but rejects cycles back to a locked state', () => {
      captureErrors(errors => {
        const a = createState(0)
        const b = createState(0)
        a.subscribe(value => b.update(value))
        a.update(1)
        assert.equal(b.value, 1)
        assert.equal(errors.length, 0)
        b.subscribe(() => a.update(9))
        a.update(2)
        assert.equal(a.value, 2)
        assert.equal(b.value, 2)
        assert.equal(errors.length, 1)
        assert.match(errors[0][1].message, /same state is updating/)
        a.update(3)
        assert.equal(a.value, 3)
        assert.equal(b.value, 3)
      })
    })

    it('loads any valid JSON value without enforcing the initial schema', () => {
      for (const value of [null, true, false, 0, '', 'text', [], [1, 2], {}, { restored: true }]) {
        const reads = []
        const writes = []
        const state = createState({ initial: true }, {
          key: 'settings',
          storage: {
            getItem(key) { reads.push(key); return JSON.stringify(value) },
            setItem(...args) { writes.push(args) }
          }
        })
        assert.deepEqual(JSON.parse(JSON.stringify(state.value)), value)
        assert.deepEqual(reads, ['settings'])
        assert.deepEqual(writes, [])
      }
    })

    it('falls back to an independent initial copy for missing, malformed, or non-finite stored data', () => {
      for (const saved of [null, '', '{broken', 'undefined', '1e400', '{"count":1e400}']) {
        const initial = { child: { count: 1 } }
        const state = createState(initial, {
          key: 'settings', storage: { getItem: () => saved, setItem() {} }
        })
        initial.child.count = 9
        assert.equal(state.value.child.count, 1)
        state.update(draft => { draft.child.count = 2 })
        assert.equal(initial.child.count, 9)
      }
    })

    it('falls back when storage reads throw and continues updates when storage writes fail', () => {
      captureErrors(errors => {
        const failure = new Error('storage unavailable')
        const initial = { child: { count: 1 } }
        const state = createState(initial, {
          key: 'settings',
          storage: {
            getItem() { throw failure },
            setItem() { throw failure }
          }
        })
        initial.child.count = 9
        assert.equal(state.value.child.count, 1)
        let calls = 0
        state.subscribe(() => { calls++ })
        state.update({ child: { count: 2 } })
        assert.equal(state.value.child.count, 2)
        assert.equal(calls, 1)
        assert.equal(errors.length, 1)
        assert.equal(errors[0][1], failure)
        state.update({ child: { count: 3 } })
        assert.equal(state.value.child.count, 3)
        assert.equal(calls, 2)
      })
    })

    it('requires a non-empty string key only when storage is supplied', () => {
      for (const key of [undefined, null, '', 0, {}]) {
        assert.throws(() => createState(0, { storage: {}, key }), {
          name: 'TypeError', message: /non-empty key/
        })
      }
      assert.equal(createState(0).value, 0)
      assert.equal(createState(0, { key: '' }).value, 0)
    })
  })
}
