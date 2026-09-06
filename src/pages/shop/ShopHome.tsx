import { useMemo, useState } from 'react'
import {
  AppBar, Box, Chip, Container, InputAdornment,
  Skeleton, Stack, TextField, Toolbar, Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import { ProductCard } from '@/components/ProductCard'
import { StickyCartBar } from '@/components/StickyCartBar'
import { useCatalogue } from '@/hooks/useCatalogue'
import { searchProducts } from '@/api/catalogue'
import { useCart } from '@/store/cartContext'

export default function ShopHome() {
  const { catalogue, availability, loading, error } = useCatalogue()
  const cart = useCart()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  // All filtering is local against the cached catalogue — no network, no delay.
  const visible = useMemo(() => {
    if (!catalogue) return []
    const byCategory = categoryId
      ? catalogue.products.filter((p) => p.category_id === categoryId)
      : catalogue.products
    return searchProducts(byCategory, query)
  }, [catalogue, categoryId, query])

  if (error) {
    return (
      <Container sx={{ py: 6, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>Could not load the catalogue</Typography>
        <Typography variant="body2" color="text.secondary">
          Check your connection and pull to refresh.
        </Typography>
      </Container>
    )
  }

  return (
    <Box sx={{ pb: 12 }}>
      <AppBar position="sticky" color="inherit" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, py: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <AccessTimeIcon fontSize="small" color="primary" />
            <Box>
              <Typography variant="h6" lineHeight={1.1}>Delivery in 45 minutes</Typography>
              <Typography variant="caption" color="text.secondary">Hospet · 583201</Typography>
            </Box>
          </Stack>
          <TextField
            size="small" fullWidth placeholder="Search for rice, dal, tea…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ),
            }}
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 1, overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
        <Chip
          label="All" color={categoryId === null ? 'primary' : 'default'}
          onClick={() => setCategoryId(null)}
          variant={categoryId === null ? 'filled' : 'outlined'}
        />
        {catalogue?.categories.map((c) => (
          <Chip
            key={c.id} label={c.name}
            color={categoryId === c.id ? 'primary' : 'default'}
            variant={categoryId === c.id ? 'filled' : 'outlined'}
            onClick={() => setCategoryId(c.id)}
          />
        ))}
      </Box>

      <Container sx={{ px: 2 }}>
        {loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={230} />
            ))}
          </Box>
        ) : visible.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Nothing matches “{query}”.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5 }}>
            {visible.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                qty={cart.qtyOf(p.id)}
                available={availability.get(p.id)}
                onAdd={() => cart.add(p)}
                onRemove={() => cart.remove(p.id)}
              />
            ))}
          </Box>
        )}
      </Container>

      <StickyCartBar />
    </Box>
  )
}
