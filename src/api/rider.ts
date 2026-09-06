import { supabase } from '@/lib/supabase'
import type { Order, OrderItem } from '@/types/db'

export interface RiderOrder extends Order {
  customers: { name: string | null; phone: string } | null
  addresses: { line1: string; landmark: string | null; lat: number | null; lng: number | null } | null
  order_items: OrderItem[]
}

/**
 * The rider's live orders: assigned at PACKED (waiting at the store) or
 * already out. Filtered by rider explicitly as well as by RLS so an admin
 * opening /rider does not see the whole board. Customer and address embeds
 * come through because 0011 lets a rider read them for assigned live orders.
 */
export async function listMyDeliveries(riderId: string): Promise<RiderOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customers(name, phone), addresses(line1, landmark, lat, lng), order_items(*)')
    .eq('rider_id', riderId)
    .in('status', ['PACKED', 'OUT_FOR_DELIVERY'])
    .order('placed_at')
  if (error) throw error
  return data as unknown as RiderOrder[]
}

/** New assignment or an office-side change: refetch. */
export function subscribeToMyOrders(riderId: string, onChange: () => void) {
  const channel = supabase
    .channel(`rider:${riderId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `rider_id=eq.${riderId}` },
      onChange)
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export async function markPickedUp(orderId: string, riderId: string) {
  const { data, error } = await supabase.rpc('transition_order', {
    p_order_id: orderId, p_to_status: 'OUT_FOR_DELIVERY', p_actor_type: 'RIDER',
    p_actor_id: riderId, p_note: null, p_fulfilment: null, p_rider_id: riderId,
  })
  if (error) throw error
  return data as { ok: boolean; error?: string }
}

export async function getMyRiderId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_rider_id')
  if (error) throw error
  return (data as string | null) ?? null
}

export interface CashToday {
  expected_paise: number
  deposited_paise: number | null
  status: 'OPEN' | 'SETTLED' | 'SHORT'
}

export async function getCashToday(): Promise<CashToday> {
  const { data, error } = await supabase.rpc('rider_cash_today')
  if (error) throw error
  return data as CashToday
}

/**
 * Deliver, recording what was actually collected. Cash marks the payment paid
 * and adds to the rider's cash; UPI (paid to the store's QR) stays pending
 * until the office confirms the credit.
 */
export async function markDelivered(orderId: string, method: 'COD' | 'UPI', reference?: string | null) {
  let { data, error } = await supabase.rpc('rider_deliver', {
    p_order_id: orderId, p_method: method, p_reference: reference ?? null,
  })
  // Before migration 0017 the database has no rider_deliver; use the plain
  // transition so a delivery is never lost in the upgrade window.
  if (error && error.code === 'PGRST202') {
    ({ data, error } = await supabase.rpc('transition_order', {
      p_order_id: orderId, p_to_status: 'DELIVERED', p_actor_type: 'RIDER',
      p_actor_id: null, p_note: null, p_fulfilment: null, p_rider_id: null,
    }))
  }
  if (error) throw error
  return data as { ok: boolean; error?: string }
}

export async function markFailed(orderId: string, riderId: string, note: string) {
  const { data, error } = await supabase.rpc('transition_order', {
    p_order_id: orderId, p_to_status: 'FAILED', p_actor_type: 'RIDER',
    p_actor_id: riderId, p_note: note, p_fulfilment: null, p_rider_id: riderId,
  })
  if (error) throw error
  return data as { ok: boolean; error?: string }
}
