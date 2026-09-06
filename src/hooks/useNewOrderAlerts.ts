import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { alertsArmed, armAlerts, chime, flashTitle, notify } from '@/lib/orderAlerts'
import { paiseToRupees } from '@/lib/money'
import type { Order } from '@/types/db'

const REMIND_MS = 12000

/**
 * Watches the orders table for new rows and raises the alarm: chime, browser
 * notification, flashing tab title, and a list of orders nobody has looked
 * at yet. The chime repeats while that list is non-empty, so a new order
 * cannot slip by while the counter is busy. Acknowledge clears it.
 */
export function useNewOrderAlerts(onNewOrder?: () => void) {
  const [unseen, setUnseen] = useState<Order[]>([])
  const [armed, setArmed] = useState(alertsArmed())
  const latest = useRef(onNewOrder)
  latest.current = onNewOrder

  useEffect(() => {
    const channel = supabase
      .channel('admin:new-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const o = payload.new as Order
        setUnseen((list) => (list.some((x) => x.id === o.id) ? list : [o, ...list]))
        chime(2)
        notify(`New order ${o.order_no}`, `${paiseToRupees(o.total_paise)} · ${o.payment_method} · tap to open`, o.id)
        latest.current?.()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    flashTitle(unseen.length)
    if (unseen.length === 0) return
    const t = setInterval(() => chime(1), REMIND_MS)
    return () => { clearInterval(t); flashTitle(0) }
  }, [unseen.length])

  const acknowledge = useCallback((id?: string) => {
    setUnseen((list) => (id ? list.filter((o) => o.id !== id) : []))
  }, [])

  const arm = useCallback(async () => { await armAlerts(); setArmed(true); chime(1) }, [])

  return { unseen, acknowledge, armed, arm }
}
