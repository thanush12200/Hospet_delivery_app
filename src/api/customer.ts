import { supabase } from '@/lib/supabase'
import type { Address, Order, OrderItem, PaymentMethod, PlaceOrderResult, Zone } from '@/types/db'

/** Binds the signed-in auth user to a customer record. Called once after login. */
export async function linkMyCustomer(phone: string, name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('link_current_user_to_customer', {
    p_phone: phone, p_name: name ?? null,
  })
  if (error) throw error
  return data as string
}

export async function getMyCustomerId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_customer_id')
  if (error) throw error
  return (data as string | null) ?? null
}

export async function listMyAddresses(): Promise<Address[]> {
  const { data, error } = await supabase
    .from('addresses').select('*').order('is_default', { ascending: false })
  if (error) throw error
  return data as Address[]
}

export async function addMyAddress(args: {
  zoneId: string; line1: string; landmark?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('add_my_address', {
    p_zone_id: args.zoneId, p_line1: args.line1, p_landmark: args.landmark ?? null,
  })
  if (error) throw error
  return data as string
}

export async function listZones(): Promise<Zone[]> {
  const { data, error } = await supabase
    .from('zones').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return data as Zone[]
}

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
