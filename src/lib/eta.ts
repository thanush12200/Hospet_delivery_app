import { BRAND } from '@/theme/brand'
import type { OrderStatus } from '@/types/db'

export const TERMINAL: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'FAILED']
export const isTerminal = (s: OrderStatus) => TERMINAL.includes(s)

/** placed_at + the zone's promise, as a Date. */
export function promisedAt(placedAt: string, slaMinutes: number | null | undefined): Date {
  return new Date(new Date(placedAt).getTime() + (slaMinutes ?? BRAND.promiseMinutes) * 60000)
}

/**
 * The promise for an order: the timestamp stamped at placement when there is
 * one (orders since 0017), else derived from today's zone promise. The stamp
 * wins so that editing a zone's SLA never rewrites what a customer was told.
 */
export function promiseOf(order: { placed_at: string; promised_at?: string | null }, slaMinutes: number | null | undefined): Date {
  return order.promised_at ? new Date(order.promised_at) : promisedAt(order.placed_at, slaMinutes)
}

export function etaHeadlineAt(due: Date, now = new Date()): string {
  const mins = Math.round((due.getTime() - now.getTime()) / 60000)
  if (mins > 1) return `Arriving in about ${mins} min`
  if (mins >= -5) return 'Arriving any minute'
  return `Running ${Math.abs(mins)} min late, sorry`
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

/**
 * The headline for an active order. Honest about lateness: a promise that
 * quietly slips is worse than one that says so.
 */
export function etaHeadline(placedAt: string, slaMinutes: number | null | undefined, now = new Date()): string {
  return etaHeadlineAt(promisedAt(placedAt, slaMinutes), now)
}

/** Seconds left in the cancellation window, clamped at 0. */
export function cancelSecondsLeft(placedAt: string, windowMinutes: number, now = new Date()): number {
  const end = new Date(placedAt).getTime() + windowMinutes * 60000
  return Math.max(0, Math.floor((end - now.getTime()) / 1000))
}
