import { useCallback, useEffect, useState } from 'react'
import { Button } from '@mui/material'
import { Link } from 'react-router-dom'
import { listActiveOrders, subscribeToOrders, transitionOrder, type AdminOrder } from '@/api/admin'
import { useAuth } from '@/auth/authContext'
import { useNewOrderAlerts } from '@/hooks/useNewOrderAlerts'
import { paiseToRupees } from '@/lib/money'
import { callablePhone } from '@/lib/phone'
import type { OrderStatus } from '@/types/db'

const LANES: { status: OrderStatus[]; title: string; tone: string }[] = [
  { status: ['PLACED'], title: 'New', tone: 'new' },
  { status: ['CONFIRMED', 'PICKING'], title: 'Packing', tone: 'packing' },
  { status: ['PACKED'], title: 'Ready', tone: 'ready' },
  { status: ['OUT_FOR_DELIVERY'], title: 'On the way', tone: 'out' },
]

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'just now' : m === 1 ? '1 min' : `${m} min`
}

/**
 * The big screen: every live order in large type, newest first, for a TV or
 * a tablet propped by the packing table. A new order chimes, flashes the tab
 * title, raises a browser notification and pulses until someone taps it.
 * One button per new order: Accept, which moves it to Confirmed.
 */
export default function Display() {
  const { session, adminRole, loading } = useAuth()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setOrders(await listActiveOrders()); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  const { unseen, acknowledge, armed, arm } = useNewOrderAlerts(() => { void refresh() })

  useEffect(() => {
    if (!adminRole) return
    void refresh()
    const unsub = subscribeToOrders(() => { void refresh() })
    const poll = setInterval(() => { void refresh() }, 30000)
    const clock = setInterval(() => setNow(Date.now()), 15000)
    return () => { unsub(); clearInterval(poll); clearInterval(clock) }
  }, [adminRole, refresh])

  async function accept(o: AdminOrder) {
    acknowledge(o.id)
    const r = await transitionOrder({ orderId: o.id, to: 'CONFIRMED', actorType: 'ADMIN' })
    if (!r.ok) setError(`Could not accept ${o.order_no}: ${r.error}`)
    await refresh()
  }

  if (loading) return null
  if (!session || !adminRole) {
    return <div className="display-board"><div className="display-gate">
      <h1>Order display</h1><p>Sign in with a staff account to use the big screen.</p>
      <Button component={Link} to="/admin" variant="contained">Go to admin sign-in</Button>
    </div></div>
  }

  const unseenIds = new Set(unseen.map((o) => o.id))
  const total = orders.length

  return (
    <div className="display-board">
      <header className="display-top">
        <div><strong>FAA</strong> live orders <span>{total} in play</span></div>
        <div className="display-top-right">
          {!armed && <Button variant="contained" size="small" onClick={() => void arm()}>Enable sound & alerts</Button>}
          {armed && unseen.length > 0 && <Button variant="outlined" size="small" color="inherit" onClick={() => acknowledge()}>Seen all</Button>}
          <time>{new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</time>
          <Link to="/admin">Back to admin</Link>
        </div>
      </header>
      {error && <div className="display-error">{error}</div>}
      {unseen.length > 0 && (
        <div className="display-alert" role="alert" onClick={() => acknowledge()}>
          🛒 {unseen.length === 1 ? `New order ${unseen[0]?.order_no ?? ''}` : `${unseen.length} new orders`} · tap to dismiss
        </div>
      )}
      <div className="display-lanes">
        {LANES.map((lane) => {
          const rows = orders.filter((o) => lane.status.includes(o.status)).sort((a, b) => b.placed_at.localeCompare(a.placed_at))
          return (
            <section key={lane.title} className={`display-lane lane-${lane.tone}`}>
              <h2>{lane.title} <span>{rows.length}</span></h2>
              {rows.length === 0 && <p className="display-empty">Nothing here</p>}
              {rows.map((o) => (
                <article key={o.id} className={`display-card${unseenIds.has(o.id) ? ' is-new' : ''}`} onClick={() => acknowledge(o.id)}>
                  <div className="display-card-head">
                    <strong>{o.order_no}</strong>
                    <span>{ago(o.placed_at, now)}</span>
                    <b>{paiseToRupees(o.total_paise)}</b>
                  </div>
                  <ul>
                    {o.order_items.map((it) => <li key={it.id}><span>{it.qty}×</span> {it.product_name}</li>)}
                  </ul>
                  <div className="display-card-foot">
                    <span>{o.customers?.name ?? 'Customer'} · {callablePhone(o.customers) ?? ''}</span>
                    <span>{o.addresses?.line1 ?? ''}{o.addresses?.landmark ? ` · ${o.addresses.landmark}` : ''}</span>
                    <span>{o.payment_method === 'COD' ? 'Cash / UPI at door' : o.payment_method}{o.note ? ` · “${o.note}”` : ''}</span>
                  </div>
                  {o.status === 'PLACED' && (
                    <Button fullWidth variant="contained" size="large" onClick={(e) => { e.stopPropagation(); void accept(o) }}>Accept & start packing</Button>
                  )}
                </article>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
