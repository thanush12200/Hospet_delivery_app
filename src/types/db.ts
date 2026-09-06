// Shapes returned by the Postgres schema in supabase/migrations.
// All money is integer paise. Never introduce a float here.

export type OrderStatus =
  | 'PLACED' | 'CONFIRMED' | 'PICKING' | 'PACKED'
  | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'FAILED'

export type PaymentMethod = 'COD' | 'UPI'
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED'

export interface Category {
  id: string
  name: string
  name_kn: string | null
  sort_order: number
  is_active: boolean
}

export interface Product {
  id: string
  category_id: string
  name: string
  name_kn: string | null
  brand: string | null
  unit_label: string
  mrp_paise: number
  image_url: string | null
  sort_order: number
  is_active: boolean
}

export interface Zone {
  id: string
  name: string
  name_kn: string | null
  delivery_fee_paise: number
  min_order_paise: number
  is_active: boolean
  /** Optional centre point, used to guess the customer's area without paying
   *  for reverse geocoding. Null until an admin sets it. */
  lat: number | null
  lng: number | null
  radius_m: number | null
}

export interface Address {
  id: string
  customer_id: string
  zone_id: string
  line1: string
  landmark: string | null
  lat: number | null
  lng: number | null
  is_default: boolean
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  qty: number
  fulfilled_qty: number | null
  unit_mrp_paise: number
  line_total_paise: number
  product_name: string
}

export interface Order {
  id: string
  order_no: string
  customer_id: string
  address_id: string
  zone_id: string
  status: OrderStatus
  subtotal_paise: number
  delivery_fee_paise: number
  total_paise: number
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  rider_id: string | null
  note: string | null
  placed_at: string
  delivered_at: string | null
}

/** Discriminated result of the place_order() RPC. */
export type PlaceOrderResult =
  | { ok: true; order_id: string; order_no: string; total_paise: number }
  | {
      ok: false
      error:
        | 'EMPTY_CART' | 'INVALID_ADDRESS' | 'INVALID_QTY' | 'PRODUCT_UNAVAILABLE'
        | 'OUT_OF_STOCK' | 'BELOW_MIN_ORDER' | 'PRICE_MISMATCH'
      shortages?: { product_id: string; name: string; requested: number; available: number }[]
      min_order_paise?: number
      subtotal_paise?: number
      server_total_paise?: number
      client_total_paise?: number
      product_id?: string
    }
