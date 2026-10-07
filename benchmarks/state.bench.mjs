import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const baselineIndex = process.argv.indexOf('--baseline')
const baselineDirectory = baselineIndex === -1 ? null : process.argv[baselineIndex + 1]
if (baselineIndex !== -1 && !baselineDirectory) {
  throw new Error('--baseline requires a directory containing state.js and state.min.js')
}

const small = { tick: 0, status: 'idle', settings: { theme: 'auto', enabled: true } }
const nearValues = { tick: 0, items: Array.from({ length: 4093 }, (_, i) => i) }
const nearLength = { tick: 0, text: 'x'.repeat(65536 - JSON.stringify({ tick: 0, text: '' }).length) }
let nested = 0
for (let i = 0; i < 15; i++) nested = { child: nested }
const nearDepth = { tick: 0, child: nested }

const cases = [
  { name: 'primitive update', iterations: 200000, setup(createState) {
    const state = createState(0)
    let tick = 0
    return () => state.update(tick ^= 1)
  } },
  ...[
    ['small draft update', small, 15000],
    ['4096-value draft update', nearValues, 120],
    ['65536-unit draft update', nearLength, 200],
    ['16-level draft update', nearDepth, 3000]
  ].map(([name, initial, iterations]) => ({ name, iterations, setup(createState) {
    const state = createState(initial)
    return () => state.update(draft => { draft.tick ^= 1 })
  } })),
  { name: 'small no-op update', iterations: 30000, setup(createState) {
    const state = createState(small)
    return () => state.update(small)
  } },
  { name: 'small create', iterations: 15000, setup(createState) {
    return () => createState(small)
  } },
  { name: '65536-unit storage load', iterations: 400, setup(createState) {
    const json = JSON.stringify(nearLength)
    const options = { key: 'bench', storage: { getItem: () => json } }
    return () => createState({ tick: 0 }, options)
  } }
]

function measure(run, iterations) {
  const started = performance.now()
  for (let i = 0; i < iterations; i++) run()
  return (performance.now() - started) * 1000 / iterations
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const report = {
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
  method: '9 rounds; median microseconds per operation; alternating order for paired comparisons; in-memory storage',
  results: []
}

for (const file of ['state.js', 'state.min.js']) {
  const versions = []
  for (const [label, path] of [
    ...(baselineDirectory ? [['before', resolve(baselineDirectory, file)]] : []),
    ['current', new URL(`../${file}`, import.meta.url)]
  ]) {
    const source = await readFile(path, 'utf8')
    const { createState } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
    versions.push({ label, createState, sha256: createHash('sha256').update(source).digest('hex') })
  }

  for (const scenario of cases) {
    const runs = versions.map(version => ({
      ...version, run: scenario.setup(version.createState), samples: []
    }))
    for (const version of runs) measure(version.run, scenario.iterations)
    for (let round = 0; round < 9; round++) {
      const order = round % 2 ? [...runs].reverse() : runs
      for (const version of order) version.samples.push(measure(version.run, scenario.iterations))
    }
    const timings = Object.fromEntries(runs.map(version => [version.label, {
      sha256: version.sha256,
      medianUs: median(version.samples),
      minUs: Math.min(...version.samples),
      maxUs: Math.max(...version.samples)
    }]))
    report.results.push({
      file, case: scenario.name, iterations: scenario.iterations, ...timings,
      ...(baselineDirectory ? { changePercent: (timings.current.medianUs / timings.before.medianUs - 1) * 100 } : {})
    })
  }
}

console.log(JSON.stringify(report, null, 2))
