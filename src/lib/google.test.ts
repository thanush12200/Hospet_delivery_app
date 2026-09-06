import { describe, expect, it } from 'vitest'
import { randomNonce, sha256Hex } from './google'

describe('google nonce', () => {
  it('hashes the nonce the way Google expects (hex SHA-256)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('makes distinct hex nonces of the requested length', () => {
    const a = randomNonce(), b = randomNonce()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})
