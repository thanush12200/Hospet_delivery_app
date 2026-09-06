import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, InputAdornment, List, ListItemButton, ListItemText, Paper, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { searchPlaces, type Place } from '@/lib/places'
import type { LatLng } from '@/lib/geo'

const DEBOUNCE_MS = 350

/**
 * "Search a place or landmark": type, pick, and the pin jumps there. The
 * customer then drags it to their door if needed. Results come from
 * OpenStreetMap via Photon, restricted to the Hospet area.
 */
export function PlaceSearch({ near, onPick }: { near: LatLng; onPick: (p: Place) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setNote(null); setBusy(false); return }
    setBusy(true)
    const t = setTimeout(async () => {
      abort.current?.abort()
      const ctl = new AbortController()
      abort.current = ctl
      try {
        const r = await searchPlaces(q, near, ctl.signal)
        if (ctl.signal.aborted) return
        setResults(r); setOpen(true)
        setNote(r.length === 0 ? 'Nothing found nearby. Try a landmark, a temple, a school, a road name — or drop the pin on the map.' : null)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setResults([]); setNote('Search is not available right now. Pin your door on the map instead.')
      } finally { if (!ctl.signal.aborted) setBusy(false) }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, near])

  function pick(p: Place) {
    setQuery(p.name); setOpen(false); setResults([]); setNote(null)
    onPick(p)
  }

  return (
    <Box sx={{ position: 'relative', mb: 1 }}>
      <TextField
        size="small" fullWidth value={query} placeholder="Search a place or landmark"
        inputProps={{ 'aria-label': 'Search a place or landmark', autoComplete: 'off', enterKeyHint: 'search' }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); pick(results[0]) } if (e.key === 'Escape') setOpen(false) }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          endAdornment: busy ? <InputAdornment position="end"><CircularProgress size={16} /></InputAdornment> : undefined,
        }}
      />
      {open && results.length > 0 && (
        <Paper elevation={6} sx={{ position: 'absolute', left: 0, right: 0, top: '100%', mt: 0.5, zIndex: 1200, maxHeight: 280, overflowY: 'auto', borderRadius: 2 }}>
          <List dense disablePadding>
            {results.map((p) => (
              <ListItemButton key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                <PlaceOutlinedIcon fontSize="small" sx={{ mr: 1.25, color: 'text.secondary' }} />
                <ListItemText primary={p.name} secondary={p.detail || undefined}
                  primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }} secondaryTypographyProps={{ fontSize: 12 }} />
              </ListItemButton>
            ))}
          </List>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            Places from OpenStreetMap
          </Typography>
        </Paper>
      )}
      {note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{note}</Typography>}
    </Box>
  )
}
