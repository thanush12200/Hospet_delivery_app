#!/usr/bin/env node
// bundle-budget.mjs — gzipped JS a customer downloads to render "/".
//
// Follows the static import graph from the entry chunk plus the lazily
// loaded home route, so it measures what actually ships on first paint
// rather than the whole dist. Fails (exit 1) above the budget in README.md.
//
// Usage: node scripts/bundle-budget.mjs [route-chunks=ShopLayout,ShopHome] [budgetKB=200]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const ROUTES = (process.argv[2] ?? 'ShopLayout,ShopHome').split(',')
const BUDGET_KB = Number(process.argv[3] ?? 200)
const dir = path.resolve('dist/assets')

if (!statSync(dir, { throwIfNoEntry: false })) {
  console.error('dist/assets not found. Run `npm run build` first.')
  process.exit(2)
}

const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
const html = readFileSync(path.resolve('dist/index.html'), 'utf8')
const entry = [...html.matchAll(/assets\/(index-[^"']+\.js)/g)].map((m) => m[1])
const route = files.filter((f) => ROUTES.some((r) => f.startsWith(`${r}-`)))

const seen = new Set()
const queue = [...entry, ...route]
while (queue.length) {
  const f = queue.shift()
  if (!f || seen.has(f) || !files.includes(f)) continue
  seen.add(f)
  const src = readFileSync(path.join(dir, f), 'utf8')
  // Static imports only: `import"./x.js"`, `from"./x.js"`, `import{..}from"./x.js"`.
  for (const m of src.matchAll(/(?:import|from)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(m[1])
  // Vite's preload helper lists lazy deps as __vite__mapDeps([...]); those are
  // dynamic and deliberately excluded.
}

let total = 0
const rows = [...seen].map((f) => {
  const gz = gzipSync(readFileSync(path.join(dir, f))).length
  total += gz
  return [f, gz]
}).sort((a, b) => b[1] - a[1])

for (const [f, gz] of rows) console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${f}`)
const kb = total / 1024
console.log(`\n${kb.toFixed(1)} KB gzipped for "/" (${rows.length} chunks); budget ${BUDGET_KB} KB`)
if (kb > BUDGET_KB) { console.error(`OVER BUDGET by ${(kb - BUDGET_KB).toFixed(1)} KB`); process.exit(1) }
