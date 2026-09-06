import { useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, Divider, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DownloadIcon from '@mui/icons-material/Download'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { parseCsv, rupeesToPaise, toInt } from '@/lib/csv'
import { paiseToRupees } from '@/lib/money'

interface Parsed {
  row: number
  name: string
  name_kn: string
  brand: string
  unit: string
  mrp_paise: number | null
  stock: number | null
  category: string
  category_kn: string
  description: string
  image_url: string
  error: string | null
}

const TEMPLATE = `name,name_kn,brand,unit,mrp,stock,category
Sona Masoori Rice,ಸೋನಾ ಮಸೂರಿ ಅಕ್ಕಿ,Local,5 kg,350,20,Staples
Toor Dal,ತೊಗರಿ ಬೇಳೆ,Local,1 kg,165,30,Staples
Tea Powder,ಚಹಾ ಪುಡಿ,Red Label,250 g,140,15,Beverages
Sunflower Oil,ಸೂರ್ಯಕಾಂತಿ ಎಣ್ಣೆ,Fortune,1 L,145,25,Oil & Masala
`

/**
 * Bulk catalogue import.
 *
 * A distributor already has this data in a spreadsheet or in Tally. Retyping
 * 50 products through a dialog is a couple of hours; pasting a CSV is a
 * minute. Photos still go in one at a time, because those need the camera.
 */
export default function ImportCsv() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ created: number; updated: number; errors: number } | null>(null)
  const [failed, setFailed] = useState<{ row: number; message: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Parsing and validation are local, so the preview updates as you paste --
  // mistakes surface before anything touches the database.
  const parsed = useMemo<Parsed[]>(() => {
    if (!text.trim()) return []
    const { rows } = parseCsv(text)
    return rows.map((r, i) => {
      const name = r.name ?? ''
      const rawMrp = (r.mrp ?? '').trim()
      const mrp = rupeesToPaise(rawMrp)
      let err: string | null = null
      if (!name.trim()) err = 'Name is required'
      // A blank price is the expected state of the starter file, not a
      // mistake. Say so, rather than flagging 84 rows as broken.
      else if (rawMrp === '') err = 'Add a price'
      else if (mrp === null) err = `"${rawMrp}" is not a valid price`
      const image = (r.image_url ?? r.image ?? '').trim()
      if (!err && image && !/^https?:\/\//.test(image)) err = 'image_url must be a full http(s) link'
      return {
        row: i + 1,
        name,
        name_kn: r.name_kn ?? r.kannada ?? '',
        brand: r.brand ?? '',
        unit: r.unit ?? r.pack ?? r.unit_label ?? '',
        mrp_paise: mrp,
        stock: toInt(r.stock ?? r.qty ?? ''),
        category: r.category ?? '',
        category_kn: r.category_kn ?? '',
        description: (r.description ?? '').trim(),
        image_url: image,
        error: err,
      }
    })
  }, [text])

  const valid = parsed.filter((p) => !p.error)
  const invalid = parsed.filter((p) => p.error)
  const allMissingPrices = parsed.length > 0 && parsed.every((p) => p.error === 'Add a price')

  function onFile(f: File | undefined) {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(f)
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'wink-catalogue-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function run() {
    setBusy(true); setError(null); setResult(null); setFailed([])
    try {
      const { data, error } = await supabase.rpc('admin_bulk_upsert_products', {
        p_rows: valid.map((p) => ({
          name: p.name, name_kn: p.name_kn, brand: p.brand, unit: p.unit,
          mrp_paise: p.mrp_paise, stock: p.stock, category: p.category,
          category_kn: p.category_kn, description: p.description, image_url: p.image_url,
        })),
      })
      if (error) throw error
      const d = data as {
        ok: boolean; created: number; updated: number; errors: number
        results: { row: number; status: string; message?: string }[]
      }
      setResult({ created: d.created, updated: d.updated, errors: d.errors })
      // The server numbers the rows it was sent (the valid ones); translate
      // back to the spreadsheet's row numbers so staff fix the right line.
      setFailed(d.results.filter((x) => x.status === 'error')
        .map((x) => ({ row: valid[x.row - 1]?.row ?? x.row, message: x.message ?? 'Failed' })))
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Box sx={{ maxWidth: 980 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h6">Import catalogue</Typography>
        <Button size="small" onClick={() => navigate('/admin/catalogue')}>← Catalogue</Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          Columns: <code>name</code>, <code>name_kn</code>, <code>brand</code>,{' '}
          <code>unit</code>, <code>mrp</code>, <code>stock</code>, <code>category</code>,{' '}
          <code>category_kn</code>, <code>description</code>, <code>image_url</code>.
          Only <strong>name</strong> and <strong>mrp</strong> are required; a blank description or
          image never overwrites an existing one.
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          A product already in the catalogue with the same name <em>and</em> pack size is
          updated rather than duplicated. Missing categories are created. Stock is only
          changed when the column has a value, so a price-only reimport never wipes counts.
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
            onChange={(e) => onFile(e.target.files?.[0])} />
          <Button startIcon={<UploadFileIcon />} variant="outlined" size="small"
            onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
          <Button startIcon={<DownloadIcon />} size="small" onClick={downloadTemplate}>
            Download template
          </Button>
          <Button
            startIcon={<DownloadIcon />} size="small"
            href="https://raw.githubusercontent.com/thanush12200/Hospet_delivery_app/main/catalogue/wink-starter-catalogue.csv"
            target="_blank" rel="noreferrer"
          >
            Download 84-product starter list
          </Button>
        </Stack>

        <TextField
          multiline minRows={6} maxRows={14} fullWidth
          placeholder="…or paste your CSV here"
          value={text} onChange={(e) => setText(e.target.value)}
          sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 12.5 } }}
        />
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {result && (
        <Alert severity={result.errors > 0 ? 'warning' : 'success'} sx={{ mb: 2 }}>
          <strong>{result.created}</strong> created · <strong>{result.updated}</strong> updated
          {result.errors > 0 && <> · <strong>{result.errors}</strong> failed</>}
          {failed.map((f) => <div key={f.row}>Row {f.row}: {f.message}</div>)}
          <Box sx={{ mt: 1 }}>
            <Button size="small" variant="outlined" onClick={() => navigate('/admin/catalogue')}>
              View catalogue
            </Button>
          </Box>
        </Alert>
      )}

      {allMissingPrices && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This looks like the starter file — every row still needs a price. Fill the{' '}
          <code>mrp</code> column in your spreadsheet, then paste it back. Nothing is wrong.
        </Alert>
      )}

      {parsed.length > 0 && (
        <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5 }}>
            <Typography variant="subtitle2">Preview</Typography>
            <Chip size="small" color="success" label={`${valid.length} ready`} />
            {invalid.length > 0 && (
              <Chip
                size="small"
                color={allMissingPrices ? 'default' : 'error'}
                label={allMissingPrices ? `${invalid.length} need prices` : `${invalid.length} with problems`}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" size="small" disabled={busy || valid.length === 0}
              onClick={() => void run()}>
              {busy ? 'Importing…' : `Import ${valid.length} product${valid.length === 1 ? '' : 's'}`}
            </Button>
          </Stack>
          <Divider />
          <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Kannada</TableCell>
                  <TableCell>Pack</TableCell>
                  <TableCell align="right">MRP</TableCell>
                  <TableCell align="right">Stock</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Photo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {parsed.map((p) => (
                  <TableRow key={p.row} sx={
                    p.error === 'Add a price' ? { bgcolor: '#FFF8E1' }
                    : p.error ? { bgcolor: '#FDEDEA' } : undefined
                  }>
                    <TableCell>{p.row}</TableCell>
                    <TableCell>
                      {p.name || <em>(blank)</em>}
                      {p.error && (
                        <Typography
                          variant="caption"
                          color={p.error === 'Add a price' ? 'text.secondary' : 'error'}
                          display="block"
                        >
                          {p.error}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{p.name_kn}</TableCell>
                    <TableCell>{p.unit || '1 pc'}</TableCell>
                    <TableCell align="right">
                      {p.mrp_paise === null ? '—' : paiseToRupees(p.mrp_paise)}
                    </TableCell>
                    <TableCell align="right">{p.stock ?? '—'}</TableCell>
                    <TableCell>{p.category || 'General'}</TableCell>
                    <TableCell>
                      {p.image_url
                        ? <img src={p.image_url} alt="" width={32} height={32} loading="lazy" style={{ objectFit: 'cover', borderRadius: 4 }} />
                        : p.description ? '📝' : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
    </Box>
  )
}
