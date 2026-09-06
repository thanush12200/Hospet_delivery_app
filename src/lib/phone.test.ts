import { describe, expect, it } from 'vitest'
import { formatIndianMobile, toE164 } from './phone'

describe('toE164', () => {
  it('accepts a plain 10-digit mobile', () => {
    expect(toE164('9876543210')).toBe('+919876543210')
  })
  it('keeps a 10-digit number that starts with 91 (regression)', () => {
    expect(toE164('9198765432')).toBe('+919198765432')
  })
  it('strips a leading 0', () => {
    expect(toE164('09876543210')).toBe('+919876543210')
  })
  it('strips a 91 country prefix with or without +', () => {
    expect(toE164('919876543210')).toBe('+919876543210')
    expect(toE164('+91 98765 43210')).toBe('+919876543210')
    expect(toE164('+91-98765-43210')).toBe('+919876543210')
  })
  it('rejects anything that is not 10 local digits', () => {
    expect(toE164('98765')).toBeNull()
    expect(toE164('98765432101')).toBeNull()
    expect(toE164('')).toBeNull()
  })
  it('rejects landline-looking numbers', () => {
    expect(toE164('0836123456')).toBeNull()
    expect(toE164('1234567890')).toBeNull()
  })
})

describe('formatIndianMobile', () => {
  it('groups 5+5', () => {
    expect(formatIndianMobile('+919876543210')).toBe('98765 43210')
  })
  it('leaves odd shapes alone', () => {
    expect(formatIndianMobile('+4420123')).toBe('+4420123')
  })
})
