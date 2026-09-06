import { supabase } from '@/lib/supabase'
import type {
  Address, AddressLabel, Customer, Order, OrderEvent, OrderItem, PaymentMethod, PlaceOrderResult,
  StoreConfig, TransitionResult, Zone,
} from '@/types/db'

// ---------------------------------------------------------------- identity

/**
 * Binds the signed-in auth user to a customer record. The server takes the
 * phone from the verified JWT claim; the argument is only a fallback for
 * staff accounts that sign in by email.
 */
export async function linkMyCustomer(phone: string | null, name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('link_current_user_to_customer', {
    p_phone: phone, p_name: name ?? null,
  })
  if (error) throw error
  return data as string
}

/** The customer row for this session, or null if none is linked yet. */
export async function getMyProfile(): Promise<Customer | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('customers').select('id, phone, contact_phone, email, name').eq('auth_uid', user.id).maybeSingle()
  if (error) throw error
  return (data as Customer | null) ?? null
}

export async function updateMyProfile(name: string): Promise<void> {
  const { data, error } = await supabase.rpc('update_my_profile', { p_name: name })
  if (error) throw error
  const r = data as { ok: boolean; error?: string }
  if (!r.ok) throw new Error(r.error === 'INVALID_NAME' ? 'Please enter a name.' : 'Could not save your name.')
}

/** The number the rider calls. Validated server-side as an Indian mobile. */
export async function setMyContactPhone(phone: string): Promise<string> {
  const { data, error } = await supabase.rpc('set_my_contact_phone', { p_phone: phone })
  if (error) throw error
  const r = data as { ok: boolean; error?: string; phone?: string }
  if (!r.ok) throw new Error(r.error === 'INVALID_PHONE' ? 'Enter a 10-digit Indian mobile number.' : 'Could not save the number.')
  return r.phone ?? phone
}

// ---------------------------------------------------------------- addresses

/**
 * The signed-in customer's id, or null. Every "my" query below filters by
 * it explicitly rather than trusting RLS to narrow the rows: RLS lets a
 * staff account read every customer (the admin console needs that), and a
 * staff member browsing the shop must still see only their own address book
 * and orders.
 */
export async function myCustomerId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('customers').select('id').eq('auth_uid', user.id).maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id ?? null
}

export async function listMyAddresses(customerId?: string): Promise<Address[]> {
  const id = customerId ?? await myCustomerId()
  if (!id) return []
  const { data, error } = await supabase
    .from('addresses').select('*')
    .eq('customer_id', id)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Address[]
}

export interface AddressInput {
  id?: string | null
  /** Optional since 0023: the server resolves the area from the pin. */
  zoneId?: string | null
  line1: string
  landmark?: string | null
  label: AddressLabel
  isDefault?: boolean
  lat?: number | null
  lng?: number | null
}

const ADDRESS_ERRORS: Record<string, string> = {
  OUTSIDE_DELIVERY_AREA: "We don't deliver at that spot yet. Move the pin closer to the store, or use a landmark nearby.",
  INVALID_ADDRESS: 'Please enter the house or street.',
  INVALID_ZONE: 'Please pick a delivery area.',
  INVALID_LABEL: 'Please pick a label.',
  NO_SUCH_ADDRESS: 'That address no longer exists.',
  NOT_AUTHORIZED: 'Please sign in again.',
}

export async function upsertMyAddress(a: AddressInput): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_my_address', {
    p_id: a.id ?? null,
    p_zone_id: a.zoneId ?? null,
    p_line1: a.line1,
    p_landmark: a.landmark ?? null,
    p_label: a.label,
    p_is_default: a.isDefault ?? false,
    p_lat: a.lat ?? null,
    p_lng: a.lng ?? null,
  })
  if (error) throw error
  const r = data as { ok: boolean; id?: string; error?: string }
  if (!r.ok || !r.id) throw new Error(ADDRESS_ERRORS[r.error ?? ''] ?? 'Could not save the address.')
  return r.id
}

export async function setDefaultAddress(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('set_default_address', { p_id: id })
  if (error) throw error
  const r = data as { ok: boolean; error?: string }
  if (!r.ok) throw new Error(ADDRESS_ERRORS[r.error ?? ''] ?? 'Could not change the default address.')
}

export async function deleteMyAddress(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_my_address', { p_id: id })
  if (error) throw error
  const r = data as { ok: boolean; error?: string }
  if (!r.ok) throw new Error(ADDRESS_ERRORS[r.error ?? ''] ?? 'Could not remove the address.')
}

// ---------------------------------------------------------------- store

export async function listZones(): Promise<Zone[]> {
  const { data, error } = await supabase
    .from('zones').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return data as Zone[]
}

export async function getStoreConfig(): Promise<StoreConfig | null> {
  const { data, error } = await supabase
    .from('store_config')
    .select('phone, whatsapp, cancel_window_minutes, is_open, closed_message, promo_title, promo_subtitle, promo_until')
    .maybeSingle()
  if (error) throw error
  return (data as StoreConfig | null) ?? null
}

// ---------------------------------------------------------------- orders

export async function placeMyOrder(args: {
  customerId: string
  addressId: string
  items: { product_id: string; qty: number }[]
  paymentMethod: PaymentMethod
  clientTotalPaise: number
  note?: string
  /**
   * Idempotency key for this attempt. A retry after a lost response sends the
   * same key and gets the same order back instead of a second one.
   */
  clientKey: string
}): Promise<PlaceOrderResult> {
  const params = {
    p_customer_id: args.customerId,
    p_address_id: args.addressId,
    p_items: args.items,
    p_payment_method: args.paymentMethod,
    p_client_total_paise: args.clientTotalPaise,
    p_note: args.note ?? null,
  }
  let { data, error } = await supabase.rpc('place_order', { ...params, p_client_key: args.clientKey })
  // A database that has not yet received migration 0017 does not know the
  // key; fall back to the older shape rather than blocking every checkout.
  if (error && error.code === 'PGRST202') ({ data, error } = await supabase.rpc('place_order', params))
  if (error) throw error
  return data as PlaceOrderResult
}

export interface OrderWithItems extends Order {
  order_items: OrderItem[]
  zones: { name: string; sla_minutes: number } | null
}

export interface OrderDetail extends OrderWithItems {
  addresses: { line1: string; landmark: string | null; label: AddressLabel } | null
}

const ORDER_LIST_SELECT = '*, order_items(*), zones(name, sla_minutes)'

export const ORDERS_PAGE = 20

/** Newest first, a page at a time; pass the oldest placed_at seen to get the next page. */
export async function listMyOrders(before?: string): Promise<OrderWithItems[]> {
  const id = await myCustomerId()
  if (!id) return []
  let q = supabase
    .from('orders').select(ORDER_LIST_SELECT)
    .eq('customer_id', id)
    .order('placed_at', { ascending: false }).limit(ORDERS_PAGE)
  if (before) q = q.lt('placed_at', before)
  const { data, error } = await q
  if (error) throw error
  return data as unknown as OrderWithItems[]
}

export async function getMyOrder(id: string): Promise<OrderDetail> {
  const mine = await myCustomerId()
  if (!mine) throw new Error('Sign in to see this order.')
  const { data, error } = await supabase
    .from('orders')
    .select(`${ORDER_LIST_SELECT}, addresses(line1, landmark, label)`)
    .eq('id', id).eq('customer_id', mine).single()
  if (error) throw error
  return data as unknown as OrderDetail
}

export async function listOrderEvents(orderId: string): Promise<OrderEvent[]> {
  const { data, error } = await supabase
    .from('order_events').select('id, order_id, from_status, to_status, actor_type, note, created_at')
    .eq('order_id', orderId).order('created_at', { ascending: true })
  if (error) throw error
  return data as OrderEvent[]
}

/** Rider name and phone, only while the order is out for delivery; null otherwise. */
export async function getOrderRider(orderId: string): Promise<{ name: string; phone: string } | null> {
  const { data, error } = await supabase.rpc('my_order_rider', { p_order_id: orderId })
  if (error) throw error
  return (data as { name: string; phone: string } | null) ?? null
}

export async function cancelMyOrder(orderId: string, reason?: string): Promise<TransitionResult> {
  const { data, error } = await supabase.rpc('cancel_my_order', {
    p_order_id: orderId, p_reason: reason ?? null,
  })
  if (error) throw error
  return data as TransitionResult
}

/** Live status for the tracking screen — no polling. */
export function subscribeToOrder(orderId: string, onChange: (o: Order) => void) {
  const channel = supabase
    .channel(`order:${orderId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
      (p) => onChange(p.new as Order))
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
