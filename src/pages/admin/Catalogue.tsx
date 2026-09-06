import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, MenuItem, Paper, Stack, Switch,
  TextField, Typography,
} from '@mui/material'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { uploadProductImage } from '@/api/storage'
import { getAvailability } from '@/api/inventory'
import { paiseToRupees } from '@/lib/money'
import { categoryIcon } from '@/constants/categoryIcons'
import type { Category, Product } from '@/types/db'

interface Draft {
  id: string | null
  category_id: string
  name: string
  name_kn: string
  brand: string
  unit_label: string
  rupees: string
  image_url: string | null
  is_active: boolean
  on_hand: string
  description: string
}

const EMPTY: Draft = {
  id: null, category_id: '', name: '', name_kn: '', brand: '',
  unit_label: '', rupees: '', image_url: null, is_active: true, on_hand: '', description: '',
}

export default function Catalogue() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [avail, setAvail] = useState<Map<string, number>>(new Map())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        supabase.from('categories').select('*').order('sort_order'),
        supabase.from('products').select('*').order('name'),
      ])
      if (c.error) throw c.error
      if (p.error) throw p.error
      setCategories(c.data as Category[])
      setProducts(p.data as Product[])
      setAvail(await getAvailability((p.data as Product[]).map((x) => x.id)))
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function save() {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      const paise = Math.round(Number(draft.rupees) * 100)
      const { data, error } = await supabase.rpc('admin_upsert_product', {
        p_id: draft.id,
        p_category_id: draft.category_id,
        p_name: draft.name.trim(),
        p_unit_label: draft.unit_label.trim(),
        p_mrp_paise: paise,
        p_name_kn: draft.name_kn.trim() || null,
        p_brand: draft.brand.trim() || null,
        p_image_url: draft.image_url,
        p_is_active: draft.is_active,
        p_on_hand: draft.on_hand === '' ? null : Number(draft.on_hand),
        p_description: draft.description.trim() || null,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) { setError(r.error ?? 'Save failed'); return }
      setDraft(null)
      await refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function onPickImage(file: File | undefined) {
    if (!file || !draft) return
    setUploading(true); setError(null)
    try {
      // A product needs an id before its image can be filed under it, so a new
      // product is saved first and the image attached on the second pass.
      let id = draft.id
      if (!id) {
        const paise = Math.round(Number(draft.rupees) * 100)
        if (!draft.name.trim() || !draft.category_id || !paise) {
          setError('Add a name, category and price before the photo.')
          return
        }
        const { data, error } = await supabase.rpc('admin_upsert_product', {
          p_id: null, p_category_id: draft.category_id, p_name: draft.name.trim(),
          p_unit_label: draft.unit_label.trim() || '1 pc', p_mrp_paise: paise,
          p_name_kn: draft.name_kn.trim() || null, p_brand: draft.brand.trim() || null,
          p_image_url: null, p_is_active: draft.is_active,
          p_on_hand: draft.on_hand === '' ? null : Number(draft.on_hand),
          p_description: draft.description.trim() || null,
        })
        if (error) throw error
        id = (data as { id: string }).id
      }
      const url = await uploadProductImage(file, id)
      setDraft((d) => (d ? { ...d, id, image_url: url } : d))
    } catch (e) { setError((e as Error).message) } finally { setUploading(false) }
  }

  if (loading) return <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h6">Catalogue</Typography>
        <Chip size="small" label={`${products.length} products`} />
        <Button
          variant="contained" size="small"
          onClick={() => setDraft({ ...EMPTY, category_id: categories[0]?.id ?? '' })}
        >
          Add product
        </Button>
        <Button size="small" variant="outlined" component={Link} to="/admin/import">
          Import CSV
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Stack divider={<Divider />}>
          {products.map((p) => {
            const a = avail.get(p.id)
            return (
              <Stack key={p.id} direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.5 }}>
                <Box sx={{
                  width: 48, height: 48, borderRadius: 1.5, bgcolor: '#F4F6F8',
                  display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0,
                }}>
                  {p.image_url
                    ? <img src={p.image_url} alt="" width={48} height={48} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                    : <Typography sx={{ fontSize: 22 }}>{categoryIcon(categories.find((c) => c.id === p.category_id)?.name ?? '')}</Typography>}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {p.name} {!p.is_active && <Chip size="small" label="hidden" sx={{ ml: 0.5, height: 16, fontSize: 9 }} />}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.unit_label} · {paiseToRupees(p.mrp_paise)}
                    {p.name_kn ? ` · ${p.name_kn}` : ''}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={a === undefined ? '—' : `${a} left`}
                  color={a === undefined ? 'default' : a === 0 ? 'error' : a < 5 ? 'warning' : 'success'}
                />
                <Button size="small" onClick={() => setDraft({
                  id: p.id, category_id: p.category_id, name: p.name,
                  name_kn: p.name_kn ?? '', brand: p.brand ?? '', unit_label: p.unit_label,
                  rupees: (p.mrp_paise / 100).toString(), image_url: p.image_url,
                  is_active: p.is_active, on_hand: '', description: p.description ?? '',
                })}>Edit</Button>
              </Stack>
            )
          })}
          {products.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              No products yet.
            </Typography>
          )}
        </Stack>
      </Paper>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft?.id ? 'Edit product' : 'Add product'}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box sx={{
                  width: 88, height: 88, borderRadius: 2, bgcolor: '#F4F6F8',
                  display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0,
                }}>
                  {uploading ? <CircularProgress size={22} />
                    : draft.image_url
                      ? <img src={draft.image_url} alt="" width={88} height={88} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                      : <Typography sx={{ fontSize: 30 }}>📷</Typography>}
                </Box>
                <Box>
                  <input
                    ref={fileRef} type="file" accept="image/*" capture="environment"
                    hidden onChange={(e) => void onPickImage(e.target.files?.[0])}
                  />
                  <Button
                    startIcon={<PhotoCameraIcon />} variant="outlined" size="small"
                    disabled={uploading} onClick={() => fileRef.current?.click()}
                  >
                    {draft.image_url ? 'Replace photo' : 'Take / choose photo'}
                  </Button>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    Resized to 480px WebP before upload, so the shop stays fast on 4G.
                  </Typography>
                </Box>
              </Stack>

              <TextField select size="small" label="Category" value={draft.category_id}
                onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Name" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField size="small" label="Kannada name" value={draft.name_kn}
                onChange={(e) => setDraft({ ...draft, name_kn: e.target.value })}
                helperText="Shown under the English name and matched by search" />
              <Stack direction="row" spacing={2}>
                <TextField size="small" label="Brand" value={draft.brand} sx={{ flex: 1 }}
                  onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
                <TextField size="small" label="Pack size" placeholder="1 kg" value={draft.unit_label} sx={{ flex: 1 }}
                  onChange={(e) => setDraft({ ...draft, unit_label: e.target.value })} />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField size="small" label="MRP (₹)" type="number" value={draft.rupees} sx={{ flex: 1 }}
                  onChange={(e) => setDraft({ ...draft, rupees: e.target.value })} />
                <TextField size="small" label="Stock on hand" type="number" value={draft.on_hand} sx={{ flex: 1 }}
                  onChange={(e) => setDraft({ ...draft, on_hand: e.target.value })}
                  helperText={draft.id ? 'Leave blank to keep' : ''} />
              </Stack>
              <TextField size="small" label="Description" value={draft.description} multiline minRows={2}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                inputProps={{ maxLength: 400 }}
                helperText="Shown on the product sheet. A sentence or two: origin, use, what's in the pack." />
              <Stack direction="row" alignItems="center" spacing={1}>
                <Switch checked={draft.is_active}
                  onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                <Typography variant="body2">Visible in the shop</Typography>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void save()}
            disabled={busy || uploading || !draft?.name.trim() || !draft?.rupees}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
