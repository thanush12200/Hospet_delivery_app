import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, InputAdornment, List, ListItemButton, ListItemText, Paper, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { endPlacesSession, resolvePlace, searchPlaces, type Place, type PlaceSuggestion } from '@/lib/places'
import { PlaceOutsideArea } from '@/lib/placesGoogle'
import type { LatLng } from '@/lib/geo'
import { BRAND } from '@/theme/brand'

const DEBOUNCE_MS = 350

/**
 * "Search a place or landmark": type, pick, and the pin jumps there. The
 * customer then puts the pin on their door if needed. Results come from
 * Google Places when a key is set, otherwise OpenStreetMap via Photon; both
 * restricted to the Hospet area. A Google hit costs one lookup on pick,
 * so onPick only ever receives a place with coordinates.
 */
export function PlaceSearch({ near, onPick, inline = false }: {
  near: LatLng; onPick: (p: Place) => void
  /** Results in the flow of the page (inside a sheet) instead of a floating dropdown. */
  inline?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSuggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // A search box left without a pick must not leak its billing session into the next one.
  useEffect(() => () => endPlacesSession(), [])

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
        setNote(r.length === 0 ? 'Nothing found nearby. Try a landmark, a temple, a school, a road name, or put the pin on the map.' : null)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setResults([]); setNote('Search is not available right now. Pin your door on the map instead.')
      } finally { if (!ctl.signal.aborted) setBusy(false) }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, near])

  async function pick(s: PlaceSuggestion) {
    if (resolving) return
    setQuery(s.name); setOpen(false); setNote(null); setResolving(s.id)
    try {
      const place = await resolvePlace(s, near)
      setResults([])
      onPick(place)
    } catch (e) {
      setResults([])
      setNote(e instanceof PlaceOutsideArea
        ? `${s.name} is outside the delivery city. Try a place inside ${BRAND.city}.`
        : 'Could not open that place. Search again, or pin your door on the map.')
    } finally { setResolving(null) }
  }

  const fromGoogle = results[0]?.source === 'google'

  return (
    <Box sx={{ position: 'relative', mb: 1 }}>
      <TextField
        size="small" fullWidth value={query} placeholder="Search a place or landmark"
        inputProps={{ 'aria-label': 'Search a place or landmark', autoComplete: 'off', enterKeyHint: 'search' }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        onBlur={() => { if (!inline) setTimeout(() => setOpen(false), 150) }}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); void pick(results[0]) } if (e.key === 'Escape') setOpen(false) }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          endAdornment: busy || resolving ? <InputAdornment position="end"><CircularProgress size={16} /></InputAdornment> : undefined,
        }}
      />
      {open && results.length > 0 && (
        <Paper elevation={inline ? 0 : 6} variant={inline ? 'outlined' : 'elevation'} sx={inline ? { mt: 1, borderRadius: 2 } : { position: 'absolute', left: 0, right: 0, top: '100%', mt: 0.5, zIndex: 1200, maxHeight: 280, overflowY: 'auto', borderRadius: 2 }}>
          <List dense disablePadding>
            {results.map((p) => (
              <ListItemButton key={p.id} disabled={resolving !== null} onMouseDown={(e) => e.preventDefault()} onClick={() => void pick(p)}>
                <PlaceOutlinedIcon fontSize="small" sx={{ mr: 1.25, color: 'text.secondary' }} />
                <ListItemText primary={p.name} secondary={p.detail || undefined}
                  primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }} secondaryTypographyProps={{ fontSize: 12 }} />
              </ListItemButton>
            ))}
          </List>
          {fromGoogle ? (
            // Google's policy: place data shown away from a Google map carries the Google Maps logo.
            <Box sx={{ px: 2, py: 0.75, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
              <img src="/brand/google-maps-logo.svg" alt="Google Maps" height={14} width={76} />
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
              Places from OpenStreetMap
            </Typography>
          )}
        </Paper>
      )}
      {note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{note}</Typography>}
    </Box>
  )
}
