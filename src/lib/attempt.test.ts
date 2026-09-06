import { beforeEach, describe, expect, it } from 'vitest'
import { attemptKeyFor, clearAttempt, fingerprint } from './attempt'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    },
  })
})

const a = [{ product: { id: 'x' }, qty: 2 }, { product: { id: 'y' }, qty: 1 }]

describe('attempt key', () => {
  it('is stable for the same basket and order-independent', () => {
    const k1 = attemptKeyFor(a)
    const k2 = attemptKeyFor([...a].reverse())
    expect(k2).toBe(k1)
  })
  it('changes when the basket changes', () => {
    const k1 = attemptKeyFor(a)
    const k2 = attemptKeyFor([{ product: { id: 'x' }, qty: 3 }])
    expect(k2).not.toBe(k1)
  })
  it('is forgotten after success', () => {
    const k1 = attemptKeyFor(a)
    clearAttempt()
    expect(attemptKeyFor(a)).not.toBe(k1)
  })
  it('fingerprints deterministically', () => {
    expect(fingerprint(a)).toBe('x:2|y:1')
  })
})
