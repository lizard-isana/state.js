import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

function nested(levels) {
  let value = null
  for (let i = 0; i < levels; i++) value = i % 2 ? [value] : { child: value }
  return value
}

for (const file of ['state.js', 'state.min.js']) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  const { createState } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  )

  describe(`${file} limits`, () => {
    it('accepts 16 container levels and rejects the seventeenth', () => {
      const boundary = nested(16)
      assert.deepEqual(JSON.parse(JSON.stringify(createState(boundary).value)), boundary)
      assert.throws(() => createState(nested(17)), {
        name: 'RangeError', message: /16 object\/array levels/
      })
    })

    it('rejects deeply nested JSON before exhausting the JavaScript stack', () => {
      const deep = JSON.parse('{"x":'.repeat(5000) + '0' + '}'.repeat(5000))
      assert.throws(() => createState(deep), {
        name: 'RangeError', message: /16 object\/array levels/
      })
    })

    it('counts the root array and each primitive toward 4096 values', () => {
      const boundary = Array(4095).fill(null)
      assert.equal(createState(boundary).value.length, 4095)
      assert.throws(() => createState([...boundary, null]), {
        name: 'RangeError', message: /4096 values/
      })
    })

    it('counts object property values but not property names as values', () => {
      const boundary = Object.fromEntries(Array.from({ length: 4095 }, (_, i) => [String(i), null]))
      assert.equal(Object.keys(createState(boundary).value).length, 4095)
      assert.throws(() => createState({ ...boundary, extra: null }), /4096 values/)
    })

    it('counts shared references each time they occur', () => {
      const child = { count: 0 }
      const boundary = [...Array(2047).fill(child), null]
      assert.equal(createState(boundary).value.length, 2048)
      assert.throws(() => createState([...boundary, child]), /4096 values/)
    })

    it('rejects expansion of a small shared graph', () => {
      let graph = 0
      for (let i = 0; i < 11; i++) graph = [graph, graph]
      assert.doesNotThrow(() => createState(graph))
      assert.throws(() => createState([graph, graph]), /4096 values/)
    })

    it('includes JSON quotes in the 65536-unit string limit', () => {
      assert.equal(createState('x'.repeat(65534)).value.length, 65534)
      assert.throws(() => createState('x'.repeat(65535)), {
        name: 'RangeError', message: /65536 UTF-16 code units/
      })
    })

    it('includes escaped characters in the serialized length', () => {
      assert.equal(createState('\u0000'.repeat(10922)).value.length, 10922)
      assert.throws(() => createState('\u0000'.repeat(10923)), /65536 UTF-16 code units/)
      assert.equal(createState('"'.repeat(32767)).value.length, 32767)
      assert.throws(() => createState('"'.repeat(32768)), /65536 UTF-16 code units/)
    })

    it('measures UTF-16 code units rather than UTF-8 bytes or Unicode code points', () => {
      assert.equal(createState('あ'.repeat(65534)).value.length, 65534)
      assert.equal(createState('😀'.repeat(32767)).value.length, 65534)
      assert.throws(() => createState('😀'.repeat(32768)), /65536 UTF-16 code units/)
    })

    it('includes property names and JSON punctuation in the length limit', () => {
      const key = 'k'.repeat(65527)
      const boundary = { [key]: null }
      assert.equal(JSON.stringify(boundary).length, 65536)
      assert.equal(Object.keys(createState(boundary).value)[0], key)
      assert.throws(() => createState({ [key + 'k']: null }), /65536 UTF-16 code units/)
    })

    it('rejects excessive cumulative key and string length before serialization', () => {
      const inputs = [
        { text: 'x'.repeat(65537) },
        { ['k'.repeat(65537)]: 0 },
        { a: 'x'.repeat(32769), b: 'x'.repeat(32769) },
        { ['a'.repeat(32769)]: 0, ['b'.repeat(32769)]: 0 }
      ]
      for (const input of inputs) {
        let serializationReads = 0
        const proxy = new Proxy(input, {
          get(target, property, receiver) {
            if (property === 'toJSON') serializationReads++
            return Reflect.get(target, property, receiver)
          }
        })
        assert.throws(() => createState(proxy), /65536 UTF-16 code units/)
        assert.equal(serializationReads, 0)
      }
    })

    it('validates initial limits even when storage contains a valid replacement', () => {
      let reads = 0
      const options = { key: 'data', storage: { getItem() { reads++; return '0' } } }
      for (const input of [nested(17), Array(4096).fill(0), '\u0000'.repeat(10923)]) {
        assert.throws(() => createState(input, options), RangeError)
      }
      assert.equal(reads, 0)
    })

    it('rejects oversized direct updates without committing, saving, or notifying, then releases the lock', () => {
      for (const input of [nested(17), Array(4096).fill(0), 'x'.repeat(65535)]) {
        const writes = []
        const state = createState({ count: 0 }, {
          key: 'data', storage: { getItem: () => null, setItem: (...args) => writes.push(args) }
        })
        const previous = state.value
        let calls = 0
        state.subscribe(() => { calls++ })
        assert.throws(() => state.update(input), RangeError)
        assert.equal(state.value, previous)
        assert.deepEqual(writes, [])
        assert.equal(calls, 0)
        state.update({ count: 1 })
        assert.equal(state.value.count, 1)
        assert.equal(writes.length, 1)
        assert.equal(calls, 1)
      }
    })

    it('rolls back oversized mutator drafts and releases the lock', () => {
      const mutations = [
        draft => { draft.child = nested(16) },
        draft => { draft.items = Array(4095).fill(null) },
        draft => { draft.text = 'x'.repeat(65535) }
      ]
      for (const mutation of mutations) {
        const writes = []
        const state = createState({ count: 0 }, {
          key: 'data', storage: { getItem: () => null, setItem: (...args) => writes.push(args) }
        })
        const previous = state.value
        let calls = 0
        state.subscribe(() => { calls++ })
        assert.throws(() => state.update(mutation), RangeError)
        assert.equal(state.value, previous)
        assert.deepEqual(writes, [])
        assert.equal(calls, 0)
        state.update(draft => { draft.count = 1 })
        assert.equal(state.value.count, 1)
        assert.equal(writes.length, 1)
        assert.equal(calls, 1)
      }
    })

    it('accepts exact-limit replacements and subsequent no-op updates', () => {
      for (const input of [nested(16), Array(4095).fill(null), 'x'.repeat(65534)]) {
        const state = createState(null)
        let calls = 0
        state.subscribe(() => { calls++ })
        state.update(input)
        assert.equal(calls, 1)
        const previous = state.value
        state.update(input)
        assert.equal(state.value, previous)
        assert.equal(calls, 1)
      }
    })

    it('rejects oversized storage text before parsing and leaves storage untouched', () => {
      const saved = ' '.repeat(65533) + 'null'
      const originalParse = JSON.parse
      let parsedSaved = false
      let writes = 0
      let state
      JSON.parse = (text, ...args) => {
        if (text === saved) parsedSaved = true
        return originalParse(text, ...args)
      }
      try {
        state = createState({ fallback: true }, {
          key: 'data', storage: { getItem: () => saved, setItem() { writes++ } }
        })
      } finally {
        JSON.parse = originalParse
      }
      assert.equal(parsedSaved, false)
      assert.equal(state.value.fallback, true)
      assert.equal(writes, 0)
    })

    it('accepts storage text exactly at the length limit including whitespace', () => {
      const state = createState(0, {
        key: 'data', storage: { getItem: () => ' '.repeat(65532) + 'null' }
      })
      assert.equal(state.value, null)
    })

    it('falls back for excessive stored depth or value count and keeps an independent initial copy', () => {
      for (const input of [nested(17), Array(4096).fill(null)]) {
        const initial = { count: 0 }
        const state = createState(initial, {
          key: 'data', storage: { getItem: () => JSON.stringify(input) }
        })
        initial.count = 9
        assert.equal(state.value.count, 0)
      }
    })

    it('falls back when numeric normalization expands stored JSON beyond the length limit', () => {
      const saved = '[' + Array(3500).fill('1.2345678901e-6').join(',') + ']'
      assert.ok(saved.length <= 65536)
      assert.ok(JSON.stringify(JSON.parse(saved)).length > 65536)
      const state = createState({ fallback: true }, {
        key: 'data', storage: { getItem: () => saved }
      })
      assert.equal(state.value.fallback, true)
    })

    it('caches normalized storage JSON so equivalent updates remain no-ops', () => {
      const writes = []
      const state = createState(0, {
        key: 'data', storage: { getItem: () => ' 1.0 ', setItem: (...args) => writes.push(args) }
      })
      let calls = 0
      state.subscribe(() => { calls++ })
      state.update(1)
      assert.deepEqual(writes, [])
      assert.equal(calls, 0)
    })
  })
}
