import { useNavigate } from 'react-router-dom'
import type { OrderWithItems } from '@/api/customer'
import { useToast } from '@/components/toastContext'
import { buildReorderLines } from '@/lib/reorder'
import { useCart } from '@/store/cartContext'
import type { Product } from '@/types/db'

/**
 * "Order again": refill the cart from a past order and go to the cart.
 * Items no longer sold are skipped and named in the toast; a non-empty
 * cart is only replaced after a confirm. One place for the behaviour so
 * the orders list, the home shelf and the Reorder tab all act the same.
 */
export function useReorder(products: Product[] | undefined) {
  const cart = useCart()
  const toast = useToast()
  const navigate = useNavigate()

  return function reorder(o: OrderWithItems) {
    if (!products) { toast.show('Catalogue is still loading, try again in a moment.'); return }
    const plan = buildReorderLines(o.order_items, products)
    if (plan.lines.length === 0) { toast.show('None of those items are available right now.'); return }
    if (cart.lines.length > 0 && !window.confirm(`Replace the ${cart.count} item${cart.count === 1 ? '' : 's'} already in your cart with this order?`)) return
    cart.replace(plan.lines)
    const notes: string[] = []
    if (plan.skipped.length) notes.push(`Not available: ${plan.skipped.join(', ')}`)
    if (plan.repriced.length) notes.push('Some prices have changed')
    toast.show(notes.length ? `${plan.lines.length} items added. ${notes.join('. ')}.` : `${plan.lines.length} items added to your cart`)
    navigate('/cart')
  }
}
