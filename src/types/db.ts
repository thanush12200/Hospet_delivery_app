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
  description: string | null
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
  /** Subtotal at or above which delivery is free; null = never free. */
  free_delivery_above_paise: number | null
  /** The delivery promise for this area; ETA = placed_at + sla. */
  sla_minutes: number
}

export type AddressLabel = 'HOME' | 'WORK' | 'OTHER'

export interface Address {
  id: string
  customer_id: string
  zone_id: string
  line1: string
  landmark: string | null
  lat: number | null
  lng: number | null
  is_default: boolean
  label: AddressLabel
  /** Soft-deleted addresses stay for order history; the client hides them. */
  deleted_at: string | null
}

export interface Customer {
  id: string
  phone: string
  name: string | null
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

/** Single-row store settings (0011). Readable by everyone, edited by staff. */
export interface StoreConfig {
  phone: string | null
  whatsapp: string | null
  cancel_window_minutes: number
  is_open: boolean
  closed_message: string | null
}

export type PlaceOrderError =
  | 'EMPTY_CART' | 'INVALID_ADDRESS' | 'INVALID_QTY' | 'PRODUCT_UNAVAILABLE'
  | 'OUT_OF_STOCK' | 'BELOW_MIN_ORDER' | 'PRICE_MISMATCH'
  | 'NOT_AUTHORIZED' | 'STORE_CLOSED'

/** Discriminated result of the place_order() RPC. */
export type PlaceOrderResult =
  | { ok: true; order_id: string; order_no: string; total_paise: number }
  | {
      ok: false
      error: PlaceOrderError
      shortages?: { product_id: string; name: string; requested: number; available: number }[]
      min_order_paise?: number
      subtotal_paise?: number
      server_total_paise?: number
      client_total_paise?: number
      product_id?: string
      /** STORE_CLOSED: the message staff set for customers. */
      message?: string | null
    }

/** Errors transition_order() and assign_rider() answer with (never thrown). */
export type TransitionError =
  | 'NO_SUCH_ORDER' | 'ILLEGAL_TRANSITION' | 'NOT_AUTHORIZED'
  | 'CANCEL_WINDOW_CLOSED' | 'NO_RIDER' | 'INVALID_RIDER' | 'ORDER_CLOSED'

export type TransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus; total_paise: number }
  | { ok: false; error: TransitionError; from?: OrderStatus; to?: OrderStatus; window_minutes?: number }
