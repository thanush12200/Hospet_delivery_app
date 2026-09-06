import { supabase } from '@/lib/supabase'
import type {
  Address, Order, OrderItem, OrderStatus, PaymentMethod, PlaceOrderResult, StoreConfig,
  TransitionResult, Zone,
} from '@/types/db'

export interface AdminOrder extends Order {
  customers: { name: string | null; phone: string | null; contact_phone: string | null } | null
  addresses: { line1: string; landmark: string | null } | null
  riders: { name: string; phone: string } | null
  payments: { status: string; reported_method: PaymentMethod | null; reported_reference: string | null; reported_at: string | null }[]
  order_items: OrderItem[]
}

export interface Rider { id: string; name: string; phone: string; is_active: boolean }

const ORDER_SELECT =
  '*, customers(name, phone, contact_phone), addresses(line1, landmark), riders(name, phone), order_items(*), payments(status, reported_method, reported_reference, reported_at)'

/** Orders currently in play. Terminal ones are excluded from the board. */
export async function listActiveOrders(): Promise<AdminOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .in('status', ['PLACED', 'CONFIRMED', 'PICKING', 'PACKED', 'OUT_FOR_DELIVERY'])
    .order('placed_at', { ascending: true })
  if (error) throw error
  return data as unknown as AdminOrder[]
}

/** Every order, newest first, including delivered/cancelled/failed ones. */
export async function listRecentOrders(limit = 100): Promise<AdminOrder[]> {
  const { data, error } = await supabase
    .from('orders').select(ORDER_SELECT)
    .order('placed_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data as unknown as AdminOrder[]
}

/** Staff confirmed the UPI credit for an order the rider reported as paid by UPI. */
export async function verifyPayment(orderId: string): Promise<TransitionResult> {
  const { data, error } = await supabase.rpc('admin_verify_payment', { p_order_id: orderId })
  if (error) throw error
  return data as TransitionResult
}

/**
 * A failed delivery's goods came back. Lines omitted from `items` count as
 * fully returned in good condition; only good units are restocked.
 */
export async function receiveReturn(orderId: string, items?: { product_id: string; good_qty: number }[]) {
  const { data, error } = await supabase.rpc('admin_receive_return', {
    p_order_id: orderId, p_items: items ?? null,
  })
  if (error) throw error
  return data as { ok: boolean; error?: string; not_resellable?: number }
}

export async function getStoreConfigForAdmin(): Promise<StoreConfig | null> {
  const { data, error } = await supabase
    .from('store_config').select('phone, whatsapp, cancel_window_minutes, is_open, closed_message, promo_title, promo_subtitle, promo_until').maybeSingle()
  if (error) throw error
  return (data as StoreConfig | null) ?? null
}

/** Owner/staff edit of the single store_config row (RLS: is_admin()). */
export async function updateStoreConfig(patch: Partial<StoreConfig>): Promise<void> {
  const { error, count } = await supabase
    .from('store_config').update(patch, { count: 'exact' }).eq('id', true)
  if (error) throw error
  if (!count) throw new Error('Nothing was saved. Is this account staff?')
}

export async function getAdminOrder(id: string): Promise<AdminOrder> {
  const { data, error } = await supabase
    .from('orders').select(ORDER_SELECT).eq('id', id).single()
  if (error) throw error
  return data as unknown as AdminOrder
}

export type { TransitionResult }

/**
 * The ONLY way to move an order. Never update orders.status directly --
 * a database trigger rejects it.
 *
 * The server derives who is acting from the session; actorType is the hat
 * being claimed (ADMIN here) and is verified against admin_users. A rider is
 * needed to send an order out: pass riderId, or assign one first.
 *
 * fulfilment is meaningful only when moving to PACKED, and records a short
 * pick. The server then recomputes the bill from what was actually packed.
 */
export async function transitionOrder(args: {
  orderId: string
  to: OrderStatus
  actorType?: 'ADMIN' | 'RIDER' | 'CUSTOMER' | 'SYSTEM'
  actorId?: string | null
  note?: string | null
  fulfilment?: { product_id: string; fulfilled_qty: number }[] | null
  riderId?: string | null
}): Promise<TransitionResult> {
  const { data, error } = await supabase.rpc('transition_order', {
    p_order_id: args.orderId,
    p_to_status: args.to,
    p_actor_type: args.actorType ?? 'ADMIN',
    p_actor_id: args.actorId ?? null,
    p_note: args.note ?? null,
    p_fulfilment: args.fulfilment ?? null,
    p_rider_id: args.riderId ?? null,
  })
  if (error) throw error
  return data as TransitionResult
}

/**
 * Attach a rider before dispatch so the order shows up in their app while it
 * is still being packed. Staff only; the server writes an audit event.
 */
export async function assignRider(orderId: string, riderId: string): Promise<TransitionResult> {
  const { data, error } = await supabase.rpc('assign_rider', {
    p_order_id: orderId, p_rider_id: riderId,
  })
  if (error) throw error
  return data as TransitionResult
}

export async function listRiders(): Promise<Rider[]> {
  const { data, error } = await supabase
    .from('riders').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return data as Rider[]
}

export async function listZones(): Promise<Zone[]> {
  const { data, error } = await supabase
    .from('zones').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return data as Zone[]
}

// ---------------------------------------------------------------- manual entry
// The WhatsApp pilot runs through these: an order arrives as a message, and
// staff key it in here.

export async function findOrCreateCustomer(phone: string, name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('find_or_create_customer', {
    p_phone: phone, p_name: name ?? null,
  })
  if (error) throw error
  return data as string
}

export async function listAddresses(customerId: string): Promise<Address[]> {
  const { data, error } = await supabase
    .from('addresses').select('*').eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
  if (error) throw error
  return data as Address[]
}

export async function addAddress(args: {
  customerId: string; zoneId: string; line1: string; landmark?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_add_address', {
    p_customer_id: args.customerId,
    p_zone_id: args.zoneId,
    p_line1: args.line1,
    p_landmark: args.landmark ?? null,
  })
  if (error) throw error
  return data as string
}

/** Same guarded path a customer's own checkout uses. */
export async function placeOrderForCustomer(args: {
  customerId: string
  addressId: string
  items: { product_id: string; qty: number }[]
  paymentMethod: PaymentMethod
  note?: string
}): Promise<PlaceOrderResult> {
  const { data, error } = await supabase.rpc('place_order', {
    p_customer_id: args.customerId,
    p_address_id: args.addressId,
    p_items: args.items,
    p_payment_method: args.paymentMethod,
    p_client_total_paise: null,   // admin entry: trust the server's arithmetic
    p_note: args.note ?? null,
  })
  if (error) throw error
  return data as PlaceOrderResult
}

export async function adjustStock(productId: string, newOnHand: number, reason = 'ADJUST') {
  const { data, error } = await supabase.rpc('admin_adjust_stock', {
    p_product_id: productId, p_new_on_hand: newOnHand, p_reason: reason,
  })
  if (error) throw error
  return data as { ok: boolean; error?: string; from?: number; to?: number; reserved?: number }
}

/** Push updates for the board, so it never needs polling. */
export function subscribeToOrders(onChange: () => void) {
  const channel = supabase
    .channel('admin:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export async function settleRiderCash(riderId: string, depositedPaise: number, note?: string) {
  const { data, error } = await supabase.rpc('settle_rider_cash', {
    p_rider_id: riderId,
    p_date: new Date().toISOString().slice(0, 10),
    p_deposited_paise: depositedPaise,
    p_note: note ?? null,
  })
  if (error) throw error
  return data as {
    ok: boolean; error?: string
    expected_paise?: number; deposited_paise?: number; difference_paise?: number
  }
}
