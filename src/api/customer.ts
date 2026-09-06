import { supabase } from '@/lib/supabase'
import type {
  Address, AddressLabel, Customer, Order, OrderItem, PaymentMethod, PlaceOrderResult,
  StoreConfig, Zone,
} from '@/types/db'

// ---------------------------------------------------------------- identity

/**
 * Binds the signed-in auth user to a customer record. The server takes the
 * phone from the verified JWT claim; the argument is only a fallback for
 * staff accounts that sign in by email.
 */
export async function linkMyCustomer(phone: string, name?: string): Promise<string> {
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
    .from('customers').select('id, phone, name').eq('auth_uid', user.id).maybeSingle()
  if (error) throw error
  return (data as Customer | null) ?? null
}

export async function updateMyProfile(name: string): Promise<void> {
  const { data, error } = await supabase.rpc('update_my_profile', { p_name: name })
  if (error) throw error
  const r = data as { ok: boolean; error?: string }
  if (!r.ok) throw new Error(r.error === 'INVALID_NAME' ? 'Please enter a name.' : 'Could not save your name.')
}

// ---------------------------------------------------------------- addresses

export async function listMyAddresses(): Promise<Address[]> {
  const { data, error } = await supabase
    .from('addresses').select('*')
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Address[]
}

export interface AddressInput {
  id?: string | null
  zoneId: string
  line1: string
  landmark?: string | null
  label: AddressLabel
  isDefault?: boolean
  lat?: number | null
  lng?: number | null
}

const ADDRESS_ERRORS: Record<string, string> = {
  INVALID_ADDRESS: 'Please enter the house or street.',
  INVALID_ZONE: 'Please pick a delivery area.',
  INVALID_LABEL: 'Please pick a label.',
  NO_SUCH_ADDRESS: 'That address no longer exists.',
  NOT_AUTHORIZED: 'Please sign in again.',
}

export async function upsertMyAddress(a: AddressInput): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_my_address', {
    p_id: a.id ?? null,
    p_zone_id: a.zoneId,
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
    .select('phone, whatsapp, cancel_window_minutes, is_open, closed_message')
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

export interface OrderWithItems extends Order { order_items: OrderItem[] }

export async function listMyOrders(): Promise<OrderWithItems[]> {
  const { data, error } = await supabase
    .from('orders').select('*, order_items(*)')
    .order('placed_at', { ascending: false }).limit(30)
  if (error) throw error
  return data as unknown as OrderWithItems[]
}

export async function getMyOrder(id: string): Promise<OrderWithItems> {
  const { data, error } = await supabase
    .from('orders').select('*, order_items(*)').eq('id', id).single()
  if (error) throw error
  return data as unknown as OrderWithItems
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
