/**
 * The idempotency key for the current checkout attempt.
 *
 * Generated when the customer first taps "Place order" for this basket and
 * kept in sessionStorage until the order is confirmed, so a retry after a
 * dropped connection (or a reload mid-request) sends the same key and the
 * server returns the same order rather than reserving stock twice. A
 * different basket gets a different key: the key is bound to a fingerprint
 * of the lines.
 */
const KEY = 'checkout.attempt.v1'

export function fingerprint(lines: { product: { id: string }; qty: number }[]): string {
  return lines.map((l) => `${l.product.id}:${l.qty}`).sort().join('|')
}

export function attemptKeyFor(lines: { product: { id: string }; qty: number }[]): string {
  const fp = fingerprint(lines)
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { fp: string; key: string }
      if (saved.fp === fp && typeof saved.key === 'string') return saved.key
    }
  } catch { /* private mode */ }
  const key = crypto.randomUUID()
  try { sessionStorage.setItem(KEY, JSON.stringify({ fp, key })) } catch { /* ignore */ }
  return key
}

export function clearAttempt(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}
