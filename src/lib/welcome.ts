/**
 * Whether the brand welcome card is due on this device.
 *
 * Shown once a day, so regulars are not made to tap through it on every
 * visit. The landing location prompt counts as a welcome too: a customer who
 * has just been greeted and asked where to deliver should not get a second
 * card straight after.
 */
const KEY = 'welcome.seen.v1'
/** Show the welcome card again after this long. 0 = every full load. */
export const WELCOME_EVERY_MS = 24 * 60 * 60 * 1000

export function welcomeDue(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(KEY) ?? 0)
    return !last || now - last > WELCOME_EVERY_MS
  } catch { return true }
}

export function markWelcomeSeen(now = Date.now()): void {
  try { localStorage.setItem(KEY, String(now)) } catch { /* private mode */ }
}

/**
 * The landing location prompt was dismissed without choosing an area. Kept
 * for this tab session only: the next visit asks again, a reload does not.
 */
const SKIP_KEY = 'location.skipped.v1'

export function locationSkipped(): boolean {
  try { return sessionStorage.getItem(SKIP_KEY) === '1' } catch { return false }
}

export function markLocationSkipped(): void {
  try { sessionStorage.setItem(SKIP_KEY, '1') } catch { /* private mode */ }
}
