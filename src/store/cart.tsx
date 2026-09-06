import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CartContext, CART_STORAGE_KEY, type CartApi, type CartLine } from './cartContext'
import { sanitiseLines } from './sanitise'
import { unitPrice } from '@/lib/price'

export function CartProvider({ children, storageKey = CART_STORAGE_KEY }: { children: ReactNode; storageKey?: string }) {
  // The cart lives in localStorage so a refresh or a dropped connection never
  // loses the basket — the most common cause of an abandoned order.
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? sanitiseLines(JSON.parse(raw) as unknown) : []
    } catch { return [] }
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(lines)) } catch { /* quota */ }
  }, [lines, storageKey])

  const api = useMemo<CartApi>(() => ({
    lines,
    count: lines.reduce((n, l) => n + l.qty, 0),
    subtotalPaise: lines.reduce((n, l) => n + unitPrice(l.product) * l.qty, 0),
    qtyOf: (id) => lines.find((l) => l.product.id === id)?.qty ?? 0,
    add: (product) => setLines((prev) => {
      const found = prev.find((l) => l.product.id === product.id)
      return found
        ? prev.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l))
        : [...prev, { product, qty: 1 }]
    }),
    remove: (id) => setLines((prev) =>
      prev.flatMap((l) =>
        l.product.id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l])),
    removeLine: (id) => setLines((prev) => prev.filter((l) => l.product.id !== id)),
    setQty: (product, qty) => setLines((prev) => {
      if (qty <= 0) return prev.filter((l) => l.product.id !== product.id)
      const found = prev.find((l) => l.product.id === product.id)
      return found
        ? prev.map((l) => (l.product.id === product.id ? { ...l, product, qty } : l))
        : [...prev, { product, qty }]
    }),
    replace: (next) => setLines(next.filter((l) => l.qty > 0)),
    clear: () => setLines([]),
  }), [lines])

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>
}
