import { createContext, useContext } from 'react'
import type { Product } from '@/types/db'

export interface CartLine { product: Product; qty: number }

export interface CartApi {
  lines: CartLine[]
  count: number
  subtotalPaise: number
  qtyOf: (productId: string) => number
  add: (product: Product) => void
  /** Decrement by one; drops the line at zero. */
  remove: (productId: string) => void
  /** Drop the whole line. */
  removeLine: (productId: string) => void
  setQty: (product: Product, qty: number) => void
  /** Replace the whole cart (reorder). */
  replace: (lines: CartLine[]) => void
  clear: () => void
}

export const CartContext = createContext<CartApi | null>(null)
export const CART_STORAGE_KEY = 'cart.v1'

export function useCart(): CartApi {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}
