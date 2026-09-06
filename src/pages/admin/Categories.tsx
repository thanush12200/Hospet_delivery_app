import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { supabase } from '@/lib/supabase'
import { categoryIcon } from '@/constants/categoryIcons'
import type { Category } from '@/types/db'

interface Draft { id: string | null; name: string; name_kn: string }

/**
 * Categories: the shelves of the shop, in the order a customer walks them.
 *
 * Reordering rewrites sort_order as 10, 20, 30… for every row whose slot
 * changed, so ties (every imported category used to land on 100) resolve the
 * first time anyone touches the list. Hiding a category hides its products
 * from the shop as well; nothing is ever deleted, because products and old
 * orders point at it.
 */
export default function Categories() {
  const [cats, setCats] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, { active: number; total: number }>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        supabase.from('categories').select('*').order('sort_order').order('name'),
        supabase.from('products').select('category_id, is_active'),
      ])
      if (c.error) throw c.error
      if (p.error) throw p.error
      setCats(c.data as Category[])
      const next: Record<string, { active: number; total: number }> = {}
      for (const row of p.data as { category_id: string; is_active: boolean }[]) {
        const n = (next[row.category_id] ??= { active: 0, total: 0 })
        n.total += 1
        if (row.is_active) n.active += 1
      }
      setCounts(next)
    } catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await work(); await refresh() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  /** Write the given order back as 10, 20, 30…, touching only rows that moved. */
  async function persistOrder(ordered: Category[]) {
    const writes = ordered
      .map((c, i) => ({ id: c.id, sort_order: (i + 1) * 10, was: c.sort_order }))
      .filter((w) => w.sort_order !== w.was)
      .map(async (w) => {
        const { error: err } = await supabase.from('categories').update({ sort_order: w.sort_order }).eq('id', w.id)
        if (err) throw err
      })
    await Promise.all(writes)
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= cats.length) return
    const ordered = cats.slice()
    const a = ordered[index], b = ordered[target]
    if (!a || !b) return
    ordered[index] = b; ordered[target] = a
    void run(() => persistOrder(ordered))
  }

  function toggle(c: Category) {
    void run(async () => {
      const { error: err } = await supabase.from('categories').update({ is_active: !c.is_active }).eq('id', c.id)
      if (err) throw err
    })
  }

  function save() {
    if (!draft) return
    const name = draft.name.trim()
    const name_kn = draft.name_kn.trim() || null
    if (!name) { setError('Give the category a name.'); return }
    void run(async () => {
      if (draft.id) {
        const { error: err } = await supabase.from('categories').update({ name, name_kn }).eq('id', draft.id)
        if (err) throw err
      } else {
        const sort_order = (cats.reduce((m, c) => Math.max(m, c.sort_order), 0)) + 10
        const { error: err } = await supabase.from('categories').insert({ name, name_kn, sort_order, is_active: true })
        if (err) throw err
      }
      setDraft(null)
    })
  }

  return (
    <Box sx={{ maxWidth: 820 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6">Categories</Typography>
          <Typography variant="body2" color="text.secondary">
            The order here is the order on the shop. Fresh first, staples next, then snacks and non-food is what customers expect.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setDraft({ id: null, name: '', name_kn: '' })}>Add category</Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        A category with no products on sale is hidden from the shop automatically. Turning one off hides its products too.
        The CSV import creates a missing category at the end of this list.
      </Alert>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        {cats.map((c, i) => {
          const n = counts[c.id] ?? { active: 0, total: 0 }
          const empty = n.active === 0
          return (
            <Box key={c.id}>
              {i > 0 && <Divider />}
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.5, opacity: c.is_active ? 1 : 0.55 }}>
                <Typography sx={{ fontSize: 24, width: 32, textAlign: 'center' }} aria-hidden="true">{categoryIcon(c.name)}</Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={700}>
                    {c.name}
                    {c.name_kn && <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>{c.name_kn}</Typography>}
                  </Typography>
                  <Typography variant="caption" color={empty ? 'warning.main' : 'text.secondary'}>
                    {n.active} on sale{n.total !== n.active ? ` · ${n.total - n.active} delisted` : ''}
                    {empty && ' · not shown in the shop'}
                    {!c.is_active && ' · hidden'}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label={`Move ${c.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`Move ${c.name} down`} disabled={busy || i === cats.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`Edit ${c.name}`} disabled={busy}
                  onClick={() => setDraft({ id: c.id, name: c.name, name_kn: c.name_kn ?? '' })}><EditOutlinedIcon fontSize="small" /></IconButton>
                <Switch size="small" checked={c.is_active} disabled={busy} onChange={() => toggle(c)}
                  inputProps={{ 'aria-label': `${c.name} shown in the shop` }} />
              </Stack>
            </Box>
          )
        })}
        {cats.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>No categories yet.</Typography>
        )}
      </Paper>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>{draft?.id ? 'Edit category' : 'New category'}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField label="Name" value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField label="Kannada name" value={draft.name_kn} onChange={(e) => setDraft({ ...draft, name_kn: e.target.value })}
                helperText="Shown under the English name on the shop." />
              <Typography variant="caption" color="text.secondary">Glyph: {categoryIcon(draft.name)} (picked from the name)</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
