import { useEffect, useMemo } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AddressChooserSheet } from '@/components/shop/AddressChooserSheet'
import { BrandSheet } from '@/components/shop/BrandSheet'
import { ProductCard } from '@/components/ProductCard'
import { ShopHeader } from '@/components/shop/ShopHeader'
import { CategoryIconRail } from '@/components/shop/CategoryIconRail'
import { PromoBanner } from '@/components/shop/PromoBanner'
import { CategoryTiles } from '@/components/shop/CategoryTiles'
import { PRODUCT_PARAM } from '@/components/shop/ProductSheet'
import { useCatalogue } from '@/hooks/useCatalogue'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'
import { addressLabel, addressLine } from '@/lib/address'
import { useState } from 'react'

/**
 * Home ("/") and a category ("/category/:id") are the same screen: header,
 * category rail, then the grid. Category is in the URL so it survives a
 * refresh, deep-links and the back button. Search has its own screen.
 */
export default function ShopHome() {
  const { catalogue, availability, loading, error } = useCatalogue()
  const cart = useCart()
  const customer = useCustomer()
  const navigate = useNavigate()
  const { categoryId = null } = useParams()
  const [params, setParams] = useSearchParams()
  const [chooser, setChooser] = useState(false)
  const [brand, setBrand] = useState(false)

  const activeCategory = catalogue?.categories.find((c) => c.id === categoryId)

  // An unknown category id (stale link, deactivated category) goes home.
  useEffect(() => {
    if (categoryId && catalogue && !activeCategory) navigate('/', { replace: true })
  }, [categoryId, catalogue, activeCategory, navigate])

  const visible = useMemo(() => {
    if (!catalogue) return []
    return categoryId ? catalogue.products.filter((p) => p.category_id === categoryId) : catalogue.products
  }, [catalogue, categoryId])

  const browsing = !categoryId

  // What the header says under the delivery promise. A saved address wins;
  // otherwise the area picked on this device; otherwise ask.
  const addr = customer.defaultAddress
  const headerHint = addr ? `${addressLabel(addr)} ·` : customer.activeZone ? 'Deliver to' : undefined
  const headerAddress = addr ? addressLine(addr)
    : customer.activeZone ? `${customer.activeZone.name}, Hospet`
    : 'Select your delivery area'
  const initial = customer.profile
    ? (customer.profile.name?.trim()[0] ?? customer.profile.phone.slice(-2)).toUpperCase()
    : null

  function openProduct(id: string) {
    const next = new URLSearchParams(params)
    next.set(PRODUCT_PARAM, id)
    setParams(next)
  }

  return (
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', minHeight: '100dvh' }}>
      <ShopHeader
        query=""
        onQueryChange={() => {}}
        onSearchFocus={() => navigate('/search')}
        address={headerAddress}
        addressHint={headerHint}
        onAddressClick={() => setChooser(true)}
        onAccountClick={() => navigate(customer.status === 'anon' ? '/login?returnTo=/account' : '/account')}
        onBrandClick={() => setBrand(true)}
        accountInitial={initial}
        promiseMinutes={customer.activeZone?.sla_minutes ?? 45}
      />
      <AddressChooserSheet open={chooser} onClose={() => setChooser(false)} returnTo="/" />
      <BrandSheet open={brand} onClose={() => setBrand(false)} />

      <CategoryIconRail
        categories={catalogue?.categories ?? []}
        selected={categoryId}
        onSelect={(id) => navigate(id ? `/category/${id}` : '/')}
      />

      {browsing && (
        <PromoBanner
          freeAbovePaise={customer.activeZone?.free_delivery_above_paise ?? null}
          zoneName={customer.activeZone?.name}
        />
      )}
      {browsing && catalogue && (
        <CategoryTiles
          categories={catalogue.categories}
          products={catalogue.products}
          onSelect={(id) => navigate(`/category/${id}`)}
        />
      )}

      <Box sx={{ px: 2, pt: 2.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 16, mb: 1.25 }}>
          {activeCategory ? activeCategory.name : 'All products'}
          {activeCategory?.name_kn && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {activeCategory.name_kn}
            </Typography>
          )}
        </Typography>

        {error ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 40, mb: 1 }}>📡</Typography>
            <Typography variant="h6" gutterBottom>Can&apos;t reach the shop</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Check your connection and try again.
            </Typography>
            <Typography
              component="button" variant="body2" color="primary" onClick={() => window.location.reload()}
              sx={{ background: 'none', border: 0, fontWeight: 700, cursor: 'pointer' }}
            >
              Retry
            </Typography>
          </Box>
        ) : loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 1.25 }}>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="rounded" height={228} />)}
          </Box>
        ) : visible.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 34, mb: 0.5 }}>🛒</Typography>
            <Typography variant="body2" color="text.secondary">Nothing in this category yet.</Typography>
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
                onOpen={() => openProduct(p.id)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}
