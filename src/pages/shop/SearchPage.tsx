import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Chip, IconButton, InputBase, Stack, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { searchProducts } from '@/lib/search'
import { ProductCard } from '@/components/ProductCard'
import { PRODUCT_PARAM } from '@/components/shop/ProductSheet'
import { categoryIcon } from '@/constants/categoryIcons'
import { useCatalogue } from '@/hooks/useCatalogue'
import { clearRecentSearches, loadRecentSearches, rememberSearch } from '@/lib/recentSearches'
import { useCart } from '@/store/cartContext'

/**
 * Search over the cached catalogue: instant, offline, English or Kannada.
 * The query lives in the URL (?q=) so back/forward and refresh keep it.
 */
export default function SearchPage() {
  const { catalogue, availability, loading } = useCatalogue()
  const cart = useCart()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches())
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])

  const results = useMemo(() => (catalogue ? searchProducts(catalogue.products, q) : []), [catalogue, q])
  const active = q.trim().length > 0

  function setQuery(v: string) {
    const next = new URLSearchParams(params)
    if (v) next.set('q', v); else next.delete('q')
    setParams(next, { replace: true })
  }

  // Remember a query once it has produced results and the user paused typing.
  useEffect(() => {
    if (!active || results.length === 0) return
    const t = setTimeout(() => setRecent(rememberSearch(q)), 1200)
    return () => clearTimeout(t)
  }, [q, active, results.length])

  function openProduct(id: string) {
    const next = new URLSearchParams(params)
    next.set(PRODUCT_PARAM, id)
    setParams(next)
  }

  return (
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', minHeight: '100dvh' }}>
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10, bgcolor: '#fff', px: 1, py: 1,
        pt: 'calc(8px + env(safe-area-inset-top))',
        borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.5,
      }}>
        <IconButton aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, bgcolor: '#F1F4F6', borderRadius: 2.5, px: 1.5, py: 0.75 }}>
          <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
          <InputBase
            inputRef={input}
            value={q}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for rice, dal, tea… / ಅಕ್ಕಿ, ಬೇಳೆ"
            inputProps={{ 'aria-label': 'Search products', enterKeyHint: 'search', autoCorrect: 'off' }}
            sx={{ flex: 1, fontSize: 15 }}
          />
          {q && (
            <IconButton size="small" aria-label="Clear" onClick={() => { setQuery(''); input.current?.focus() }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>

      <Box sx={{ px: 2, pt: 2 }}>
        {!active && (
          <>
            {recent.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Recent searches</Typography>
                  <Typography component="button" variant="caption" color="text.secondary"
                    onClick={() => { clearRecentSearches(); setRecent([]) }}
                    sx={{ background: 'none', border: 0, cursor: 'pointer' }}>
                    Clear
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {recent.map((r) => <Chip key={r} label={r} onClick={() => setQuery(r)} />)}
                </Stack>
              </Box>
            )}
            <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Browse by category</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {(catalogue?.categories ?? []).map((c) => (
                <Chip key={c.id} label={`${categoryIcon(c.name)} ${c.name}`} variant="outlined"
                  onClick={() => navigate(`/category/${c.id}`)} />
              ))}
            </Stack>
          </>
        )}

        {active && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
              {loading ? 'Loading…' : `${results.length} ${results.length === 1 ? 'result' : 'results'} for “${q.trim()}”`}
            </Typography>
            {!loading && results.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 34, mb: 0.5 }}>🔍</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Nothing matches “{q.trim()}”. Try a shorter word, or the Kannada name.
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap justifyContent="center" sx={{ flexWrap: 'wrap' }}>
                  {(catalogue?.categories ?? []).slice(0, 6).map((c) => (
                    <Chip key={c.id} size="small" label={c.name} onClick={() => navigate(`/category/${c.id}`)} />
                  ))}
                </Stack>
              </Box>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 1.25 }}>
                {results.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    categoryName={catalogue?.categories.find((c) => c.id === p.category_id)?.name}
                    qty={cart.qtyOf(p.id)}
                    available={availability.get(p.id)}
                    onAdd={() => cart.add(p)}
                    onRemove={() => cart.remove(p.id)}
                    onOpen={() => openProduct(p.id)}
                  />
                ))}
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
