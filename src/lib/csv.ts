/**
 * A small CSV parser.
 *
 * No dependency: papaparse is ~45KB, and this runs on an admin screen that is
 * already lazy-loaded. It handles the cases a spreadsheet export actually
 * produces -- quoted fields, embedded commas, escaped quotes ("" inside a
 * quoted field), CRLF line endings, and a trailing newline.
 */

export type Row = Record<string, string>

export function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const records = splitRecords(text.replace(/^\uFEFF/, ''))  // strip BOM from Excel
  if (records.length === 0) return { headers: [], rows: [] }

  const headers = (records[0] ?? []).map((h) => h.trim().toLowerCase())
  const rows: Row[] = []

  for (let i = 1; i < records.length; i++) {
    const cells = records[i] ?? []
    if (cells.every((c) => c.trim() === '')) continue   // skip blank lines
    const row: Row = {}
    headers.forEach((h, j) => { row[h] = (cells[j] ?? '').trim() })
    rows.push(row)
  }
  return { headers, rows }
}

function splitRecords(text: string): string[][] {
  const records: string[][] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }   // escaped quote
        else inQuotes = false
      } else cell += ch
      continue
    }

    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { cells.push(cell); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { cells.push(cell); records.push(cells); cells = []; cell = ''; continue }
    cell += ch
  }

  if (cell !== '' || cells.length > 0) { cells.push(cell); records.push(cells) }
  return records
}

/** Accepts "350", "₹350", "350.50", "1,250" — all forms a spreadsheet emits. */
export function rupeesToPaise(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

export function toInt(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}
