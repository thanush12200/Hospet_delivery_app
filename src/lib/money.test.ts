import { describe, expect, it } from 'vitest'
import { paiseToRupees, rupeesToPaise } from './money'

describe('paiseToRupees', () => {
  it('drops the decimals for whole rupees', () => {
    expect(paiseToRupees(35000)).toBe('₹350')
  })
  it('keeps two decimals otherwise', () => {
    expect(paiseToRupees(16550)).toBe('₹165.50')
    expect(paiseToRupees(5)).toBe('₹0.05')
  })
  it('groups in the Indian style', () => {
    expect(paiseToRupees(12345600)).toBe('₹1,23,456')
  })
  it('handles negatives (refunds, shortfalls)', () => {
    expect(paiseToRupees(-10000)).toBe('-₹100')
  })
})

describe('rupeesToPaise', () => {
  it('rounds float input to integer paise', () => {
    expect(rupeesToPaise(19.99)).toBe(1999)
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30)
  })
})
