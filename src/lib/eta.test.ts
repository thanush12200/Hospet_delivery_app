import { describe, expect, it } from 'vitest'
import { cancelSecondsLeft, etaHeadline, promisedAt } from './eta'

const placed = '2026-09-06T10:00:00.000Z'

describe('promisedAt', () => {
  it('adds the zone SLA, defaulting to 45', () => {
    expect(promisedAt(placed, 30).toISOString()).toBe('2026-09-06T10:30:00.000Z')
    expect(promisedAt(placed, null).toISOString()).toBe('2026-09-06T10:45:00.000Z')
  })
})

describe('etaHeadline', () => {
  it('counts down while there is time', () => {
    expect(etaHeadline(placed, 45, new Date('2026-09-06T10:10:00Z'))).toBe('Arriving in about 35 min')
  })
  it('says any minute around the promise', () => {
    expect(etaHeadline(placed, 45, new Date('2026-09-06T10:45:30Z'))).toBe('Arriving any minute')
    expect(etaHeadline(placed, 45, new Date('2026-09-06T10:49:00Z'))).toBe('Arriving any minute')
  })
  it('admits lateness past the grace', () => {
    expect(etaHeadline(placed, 45, new Date('2026-09-06T11:00:00Z'))).toBe('Running 15 min late, sorry')
  })
})

describe('cancelSecondsLeft', () => {
  it('counts down and clamps at zero', () => {
    expect(cancelSecondsLeft(placed, 5, new Date('2026-09-06T10:03:00Z'))).toBe(120)
    expect(cancelSecondsLeft(placed, 5, new Date('2026-09-06T10:06:00Z'))).toBe(0)
  })
})
