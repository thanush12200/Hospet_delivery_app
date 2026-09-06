import { useMemo, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { ProductCard } from '@/components/ProductCard'
import { StickyCartBar } from '@/components/StickyCartBar'
import { BottomNav } from '@/components/BottomNav'
import { ShopHeader } from '@/components/shop/ShopHeader'
import { CategoryIconRail } from '@/components/shop/CategoryIconRail'
import { PromoBanner } from '@/components/shop/PromoBanner'
import { CategoryTiles } from '@/components/shop/CategoryTiles'
import { useCatalogue } from '@/hooks/useCatalogue'
import { searchProducts } from '@/api/catalogue'
import { useCart } from '@/store/cartContext'

export default function ShopHome() {
  const { catalogue, availability, loading, error } = useCatalogue()
  const cart = useCart()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  // All filtering runs against the IndexedDB-cached catalogue. No network,
  // no debounce, no spinner -- results update as the user types.
  const visible = useMemo(() => {
    if (!catalogue) return []
    const inCategory = categoryId
      ? catalogue.products.filter((p) => p.category_id === categoryId)
      : catalogue.products
    return searchProducts(inCategory, query)
  }, [catalogue, categoryId, query])

  const browsing = !query && !categoryId
  const activeCategory = catalogue?.categories.find((c) => c.id === categoryId)

  if (error) {
    return (
      <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 40, mb: 1 }}>📡</Typography>
        <Typography variant="h6" gutterBottom>Can&apos;t reach the shop</Typography>
        <Typography variant="body2" color="text.secondary">
          Check your connection and pull down to refresh.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', bgcolor: '#fff', minHeight: '100dvh' }}>
      <ShopHeader
        query={query}
        onQueryChange={setQuery}
        address="Chittawadgi, Hospet · 583201"
      />

      <CategoryIconRail
        categories={catalogue?.categories ?? []}
        selected={categoryId}
        onSelect={(id) => { setCategoryId(id); setQuery('') }}
      />

      {browsing && <PromoBanner />}
      {browsing && catalogue && (
        <CategoryTiles
          categories={catalogue.categories}
          products={catalogue.products}
          onSelect={setCategoryId}
        />
      )}

      <Box sx={{ px: 2, pt: 2.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 16, mb: 1.25 }}>
          {query ? `Results for “${query}”` : activeCategory ? activeCategory.name : 'All products'}
        </Typography>

        {loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 1.25 }}>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="rounded" height={228} />)}
          </Box>
        ) : visible.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 34, mb: 0.5 }}>🔍</Typography>
            <Typography variant="body2" color="text.secondary">
              Nothing matches {query ? `“${query}”` : 'this category'} yet.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 1.25 }}>
            {visible.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                categoryName={catalogue?.categories.find((c) => c.id === p.category_id)?.name}
                qty={cart.qtyOf(p.id)}
                available={availability.get(p.id)}
                onAdd={() => cart.add(p)}
                onRemove={() => cart.remove(p.id)}
              />
            ))}
          </Box>
        )}
      </Box>

      <StickyCartBar />
      <BottomNav />
    </Box>
  )
}
