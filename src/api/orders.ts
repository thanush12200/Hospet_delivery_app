import { supabase } from '@/lib/supabase'
import type { Order, OrderItem, PaymentMethod, PlaceOrderResult } from '@/types/db'

export interface CartLine { product_id: string; qty: number }

/**
 * Places an order via the atomic place_order() Postgres function.
 *
 * clientTotalPaise is sent only as a cross-check — the server recomputes the
 * real total from products.mrp_paise and rejects a mismatch. Never rely on the
 * client's arithmetic.
 */
export async function placeOrder(args: {
  customerId: string
  addressId: string
  items: CartLine[]
  paymentMethod: PaymentMethod
  clientTotalPaise: number
  note?: string
}): Promise<PlaceOrderResult> {
  const { data, error } = await supabase.rpc('place_order', {
    p_customer_id: args.customerId,
    p_address_id: args.addressId,
    p_items: args.items,
    p_payment_method: args.paymentMethod,
    p_client_total_paise: args.clientTotalPaise,
    p_note: args.note ?? null,
  })
  if (error) throw error
  return data as PlaceOrderResult
}

export async function getOrder(orderId: string): Promise<Order> {
  const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single()
  if (error) throw error
  return data as Order
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  const { data, error } = await supabase.from('order_items').select('*').eq('order_id', orderId)
  if (error) throw error
  return data as OrderItem[]
}

export async function listMyOrders(customerId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders').select('*')
    .eq('customer_id', customerId)
    .order('placed_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data as Order[]
}

/** Live status updates for the tracking screen. */
export function subscribeToOrder(orderId: string, onChange: (o: Order) => void) {
  const channel = supabase
    .channel(`order:${orderId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
      (payload) => onChange(payload.new as Order),
    )
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
