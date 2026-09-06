import { supabase } from '@/lib/supabase'
import type { Order, OrderItem } from '@/types/db'

export interface RiderOrder extends Order {
  customers: { name: string | null; phone: string } | null
  addresses: { line1: string; landmark: string | null } | null
  order_items: OrderItem[]
}

export async function listMyDeliveries(): Promise<RiderOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customers(name, phone), addresses(line1, landmark), order_items(*)')
    .in('status', ['PACKED', 'OUT_FOR_DELIVERY'])
    .order('placed_at')
  if (error) throw error
  return data as unknown as RiderOrder[]
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

export async function markDelivered(orderId: string, riderId: string) {
  const { data, error } = await supabase.rpc('transition_order', {
    p_order_id: orderId, p_to_status: 'DELIVERED', p_actor_type: 'RIDER',
    p_actor_id: riderId, p_note: null, p_fulfilment: null, p_rider_id: riderId,
  })
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
