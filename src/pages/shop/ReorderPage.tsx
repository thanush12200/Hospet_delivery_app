import { useEffect, useMemo, useState } from 'react'
import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import ReplayIcon from '@mui/icons-material/Replay'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listMyOrders, type OrderWithItems } from '@/api/customer'
import { useAuth } from '@/auth/authContext'
import { QtyStepper } from '@/components/QtyStepper'
import { ProductImage } from '@/components/shop/ProductImage'
import { PRODUCT_PARAM } from '@/components/shop/ProductSheet'
import { useCatalogue } from '@/hooks/useCatalogue'
import { useReorder } from '@/hooks/useReorder'
import { paiseToRupees } from '@/lib/money'
import { unitPrice } from '@/lib/price'
import { useCart } from '@/store/cartContext'
import { BRAND_GRADIENT, CARD_SHADOW } from '@/theme/brand'
import type { Product } from '@/types/db'

const MAX_USUALS = 40
const MAX_PAST = 6

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * The Reorder tab: everything this customer has had delivered before, ready
 * to add again. "Repeat last order" refills the cart in one tap; below it,
 * every product from past orders with a stepper, then the recent orders
 * themselves, each with its own "Order again".
 */
export default function ReorderPage() {
  const { session, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const cart = useCart()
  const { catalogue, availability } = useCatalogue()
  const reorder = useReorder(catalogue?.products)
  const [params, setParams] = useSearchParams()
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null)

  useEffect(() => {
    if (!session) { setOrders([]); return }
    let active = true
    listMyOrders().then((o) => { if (active) setOrders(o) }).catch(() => { if (active) setOrders([]) })
    return () => { active = false }
  }, [session])

  const delivered = useMemo(() => (orders ?? []).filter((o) => o.status === 'DELIVERED'), [orders])
  const usuals = useMemo(() => {
    if (!catalogue) return []
    const byId = new Map(catalogue.products.filter((p) => p.is_active).map((p) => [p.id, p]))
    const seen = new Set<string>()
    const out: Product[] = []
    for (const o of delivered) {
      for (const it of o.order_items) {
        const p = byId.get(it.product_id)
        if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p) }
        if (out.length >= MAX_USUALS) return out
      }
    }
    return out
  }, [delivered, catalogue])
  const last = delivered[0] ?? null

  const shell = (children: React.ReactNode) => (
    <Box sx={{ pb: 'calc(var(--nav-clearance) + 8px)', minHeight: '100dvh' }}>
      <Box sx={{
        background: BRAND_GRADIENT, color: '#fff',
        px: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 2.5, borderRadius: '0 0 20px 20px',
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: 22 }}>Order again</Typography>
        <Typography sx={{ opacity: 0.9, fontSize: 13 }}>Your usuals, one tap away.</Typography>
      </Box>
      {children}
    </Box>
  )

  if (authLoading || orders === null || !catalogue) {
    return shell(<Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>)
  }

  if (!session) {
    return shell(
      <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 40, mb: 1 }}>🔁</Typography>
        <Typography variant="h6" gutterBottom>Sign in to reorder</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Everything you've ordered before, ready to add again.</Typography>
        <Button variant="contained" onClick={() => navigate('/login?returnTo=/reorder')}>Sign in</Button>
      </Box>,
    )
  }

  if (!last) {
    return shell(
      <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 40, mb: 1 }}>🔁</Typography>
        <Typography variant="h6" gutterBottom>Nothing to repeat yet</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Once an order is delivered, it shows up here for one-tap reordering.</Typography>
        <Button variant="contained" onClick={() => navigate('/')}>Start shopping</Button>
      </Box>,
    )
  }

  return shell(
    <Stack spacing={2.5} sx={{ px: 2, pt: 2 }}>
      <Paper sx={{ p: 2, borderRadius: 3, boxShadow: CARD_SHADOW }}>
        <Typography variant="overline" color="text.secondary">Last order · {when(last.placed_at)}</Typography>
        <Typography variant="body2" sx={{ mt: 0.25, mb: 1.5 }}>
          {last.order_items.length} item{last.order_items.length === 1 ? '' : 's'} · {paiseToRupees(last.total_paise)}
        </Typography>
        <Button fullWidth variant="contained" size="large" startIcon={<ReplayIcon />} onClick={() => reorder(last)}>
          Repeat last order
        </Button>
      </Paper>

      {usuals.length > 0 && (
        <section aria-label="Your usuals">
          <div className="section-heading"><div><span className="eyebrow">YOUR USUALS</span><h2>Buy again</h2></div></div>
          <div className="buy-again-grid">
            {usuals.map((p) => {
              const available = availability.get(p.id)
              return (
                <article className="buy-again-card" key={p.id}>
                  <button type="button" className="buy-again-open" aria-label={`View ${p.name}`}
                    onClick={() => { const next = new URLSearchParams(params); next.set(PRODUCT_PARAM, p.id); setParams(next) }}>
                    <div className="buy-again-photo"><ProductImage src={p.image_url} name={p.name} /></div>
                    <strong>{p.name}</strong>
                    <span>{p.unit_label} · {paiseToRupees(unitPrice(p))}</span>
                  </button>
                  <QtyStepper qty={cart.qtyOf(p.id)} max={available} fullWidth disabled={available === 0}
                    onAdd={() => cart.add(p)} onRemove={() => cart.remove(p.id)} />
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section aria-label="Past orders">
        <div className="section-heading"><div><span className="eyebrow">DELIVERED</span><h2>Past orders</h2></div></div>
        <Stack spacing={1}>
          {delivered.slice(0, MAX_PAST).map((o) => (
            <Paper key={o.id} sx={{ p: 1.5, borderRadius: 3, boxShadow: CARD_SHADOW, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700}>{when(o.placed_at)} · {paiseToRupees(o.total_paise)}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                  {o.order_items.map((it) => it.product_name).join(', ')}
                </Typography>
              </Box>
              <Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={() => reorder(o)}>Order again</Button>
            </Paper>
          ))}
        </Stack>
        <Button fullWidth variant="text" sx={{ mt: 1 }} onClick={() => navigate('/orders')}>All orders</Button>
      </section>
    </Stack>,
  )
}
