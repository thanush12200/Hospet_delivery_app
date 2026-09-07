import { useEffect, useMemo } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { ProductImage } from './ProductImage'
import { QtyStepper } from '@/components/QtyStepper'
import { categoryIcon } from '@/constants/categoryIcons'
import { useCatalogue } from '@/hooks/useCatalogue'
import { paiseToRupees } from '@/lib/money'
import { discountPct, onDeal, unitPrice } from '@/lib/price'
import { useCart } from '@/store/cartContext'
import type { Product } from '@/types/db'
import { BRAND } from '@/theme/brand'

export const PRODUCT_PARAM = 'product'

/**
 * Product detail as a bottom sheet over whatever page is showing, driven by
 * ?product=<id>. The page underneath never unmounts, the back button closes
 * the sheet, and a shared link opens it over the home page.
 */
export function ProductSheet() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { catalogue, availability, refreshAvailability } = useCatalogue()
  const cart = useCart()
  const id = params.get(PRODUCT_PARAM)

  const product = useMemo(() => catalogue?.products.find((p) => p.id === id) ?? null, [catalogue, id])
  const category = product ? catalogue?.categories.find((c) => c.id === product.category_id) : undefined
  const similar = useMemo(() => (
    product && catalogue
      ? catalogue.products.filter((p) => p.category_id === product.category_id && p.id !== product.id).slice(0, 8)
      : []
  ), [product, catalogue])

  // Stock is the one thing worth a round trip when the sheet opens.
  useEffect(() => { if (id) void refreshAvailability() }, [id, refreshAvailability])

  function close() {
    // Opened by a push from within the app: back keeps history tidy.
    // Landed here directly (shared link): just drop the param.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else {
      const next = new URLSearchParams(params)
      next.delete(PRODUCT_PARAM)
      setParams(next, { replace: true })
    }
  }

  function open(p: Product) {
    const next = new URLSearchParams(params)
    next.set(PRODUCT_PARAM, p.id)
    setParams(next, { replace: true })   // swap within the sheet, not a new history entry
  }

  const available = product ? availability.get(product.id) : undefined
  const outOfStock = available !== undefined && available <= 0
  const low = available !== undefined && available > 0 && available <= 5

  return (
    <BottomSheet open={!!id && !!product} onClose={close} title={product?.name} modal={false} maxHeight="88dvh">
      {product && (
        <Box sx={{ px: 2, pb: 3 }}>
          <Box sx={{
            aspectRatio: '4 / 3', bgcolor: '#F7F8FA', borderRadius: 3, display: 'grid', placeItems: 'center',
            overflow: 'hidden', mb: 1.5, opacity: outOfStock ? 0.5 : 1,
          }}>
            <Box sx={{ width: '100%', height: '100%', minHeight: 0, '& > img': { width: '100%', height: '100%', objectFit: 'contain' } }}>
              <ProductImage src={product.image_url} name={product.name} eager />
            </Box>
          </Box>

          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            {category && <span className="pill-tag">{category.name}</span>}
            {product.brand && <span className="pill-tag is-outlined">{product.brand}</span>}
            {low && <span className="pill-tag is-warning">Only {available} left</span>}
            {outOfStock && <span className="pill-tag is-error">Out of stock</span>}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{product.unit_label}</Typography>

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: 22 }}>
                {paiseToRupees(unitPrice(product))}
                {onDeal(product) && (
                  <Typography component="span" sx={{ ml: 1, fontSize: 14, color: 'text.secondary', textDecoration: 'line-through' }}>
                    {paiseToRupees(product.mrp_paise)}
                  </Typography>
                )}
                {onDeal(product) && <span className="pill-tag is-brand" style={{ marginLeft: 8, height: 20, verticalAlign: 'middle' }}>{discountPct(product)}% off</span>}
              </Typography>
              <Typography variant="caption" color="text.secondary">MRP, inclusive of all taxes</Typography>
            </Box>
            <Box sx={{ width: 120 }}>
              <QtyStepper
                qty={cart.qtyOf(product.id)}
                onAdd={() => cart.add(product)}
                onRemove={() => cart.remove(product.id)}
                disabled={outOfStock}
                max={available}
                fullWidth
              />
            </Box>
          </Stack>

          {product.description ? (
            <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-line' }}>{product.description}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Delivered from our Hospet store in about {BRAND.promiseMinutes} minutes.
            </Typography>
          )}

          {similar.length > 0 && (
            <>
              <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>More in {category?.name}</Typography>
              <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 1, mx: -2, px: 2,
                         '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
                {similar.map((p) => {
                  const a = availability.get(p.id)
                  return (
                    <Box
                      key={p.id}
                      role="button" tabIndex={0}
                      onClick={() => open(p)}
                      onKeyDown={(e) => { if (e.key === 'Enter') open(p) }}
                      sx={{ width: 112, flexShrink: 0, cursor: 'pointer' }}
                    >
                      <Box sx={{ aspectRatio: '1', bgcolor: '#F7F8FA', borderRadius: 2, display: 'grid', placeItems: 'center',
                                 overflow: 'hidden', mb: 0.5, opacity: a !== undefined && a <= 0 ? 0.4 : 1 }}>
                        {p.image_url
                          ? <img src={p.image_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <Typography sx={{ fontSize: 30 }} aria-hidden>{categoryIcon(category?.name ?? p.name)}</Typography>}
                      </Box>
                      <Typography variant="caption" sx={{ fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.2 }}>
                        {p.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {p.unit_label} · {paiseToRupees(unitPrice(p))}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </>
          )}
        </Box>
      )}
    </BottomSheet>
  )
}
