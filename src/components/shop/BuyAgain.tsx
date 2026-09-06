import { useEffect, useMemo, useState } from 'react'
import { Button } from '@mui/material'
import ReplayIcon from '@mui/icons-material/Replay'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listMyOrders, type OrderWithItems } from '@/api/customer'
import { QtyStepper } from '@/components/QtyStepper'
import { ProductImage } from './ProductImage'
import { PRODUCT_PARAM } from './ProductSheet'
import { useToast } from '@/components/toastContext'
import { buildReorderLines } from '@/lib/reorder'
import { paiseToRupees } from '@/lib/money'
import { unitPrice } from '@/lib/price'
import { useCart } from '@/store/cartContext'
import type { Product } from '@/types/db'

const MAX_ITEMS = 12

/**
 * "Buy again": the products this customer has ordered before, most recent
 * first, as a scrolling shelf on the home page with one-tap ADD. Repeat
 * purchases are most of a grocery store's volume, so the shelf sits high on
 * the page. Also carries a "Repeat last order" button that refills the cart
 * with the most recent order.
 *
 * Loaded lazily and only for signed-in customers; renders nothing until
 * there is at least one delivered order.
 */
export default function BuyAgain({ products, availability }: { products: Product[]; availability: Map<string, number> }) {
  const cart = useCart()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null)

  useEffect(() => {
    let active = true
    listMyOrders().then((o) => { if (active) setOrders(o) }).catch(() => { if (active) setOrders([]) })
    return () => { active = false }
  }, [])

  const past = useMemo(() => {
    if (!orders) return []
    const byId = new Map(products.filter((p) => p.is_active).map((p) => [p.id, p]))
    const seen = new Set<string>()
    const out: Product[] = []
    for (const o of orders) {
      if (o.status !== 'DELIVERED') continue
      for (const it of o.order_items) {
        const p = byId.get(it.product_id)
        if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p) }
        if (out.length >= MAX_ITEMS) return out
      }
    }
    return out
  }, [orders, products])

  const last = orders?.find((o) => o.status === 'DELIVERED') ?? null
  if (past.length === 0 || !last) return null

  function repeatLast() {
    if (!last) return
    const plan = buildReorderLines(last.order_items, products)
    if (plan.lines.length === 0) { toast.show('None of those items are available right now.'); return }
    if (cart.lines.length > 0 && !window.confirm(`Replace the ${cart.count} item${cart.count === 1 ? '' : 's'} already in your cart with your last order?`)) return
    cart.replace(plan.lines)
    toast.show(plan.skipped.length ? `${plan.lines.length} items added. Not available: ${plan.skipped.join(', ')}.` : `${plan.lines.length} items added from your last order`)
    navigate('/cart')
  }

  return (
    <section className="buy-again" aria-label="Buy again">
      <div className="section-heading">
        <div><span className="eyebrow">YOUR USUALS</span><h2>Buy again</h2></div>
        <Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={repeatLast}>Repeat last order</Button>
      </div>
      <div className="buy-again-rail">
        {past.map((p) => {
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
  )
}
