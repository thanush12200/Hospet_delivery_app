/**
 * A durable queue for rider actions taken without a connection.
 *
 * Riders lose signal — in stairwells, basements, and half the lanes in Hospet.
 * If "mark delivered" only worked online, the rider would stand in the street
 * waiting for bars, or forget entirely and the order would look undelivered.
 * Actions are recorded locally first, then drained when connectivity returns.
 *
 * localStorage rather than IndexedDB deliberately: this queue is tiny, and it
 * must never itself be the thing that stalls (see the catalogue cache).
 *
 * Rules that keep it honest (audit F04):
 *  - the queue is keyed per rider, so one phone shared by two riders never
 *    replays the other's actions;
 *  - a write is verified by reading it back; if storage refuses, enqueue()
 *    throws and the screen must not pretend the action was saved;
 *  - drain() stops at the first transport failure, so a pickup that has not
 *    reached the server is never followed by a delivery attempt the server
 *    would refuse and we would then drop.
 */

const KEY_PREFIX = 'rider.queue.v2:'
const LEGACY_KEY = 'rider.queue.v1'

export interface QueuedAction {
  id: string
  kind: 'PICKED_UP' | 'DELIVERED' | 'FAILED'
  orderId: string
  riderId: string
  note?: string
  /** DELIVERED only: what was collected at the door. */
  method?: 'COD' | 'UPI'
  reference?: string | null
  queuedAt: number
}

function key(riderId: string) { return KEY_PREFIX + riderId }

function read(riderId: string): QueuedAction[] {
  try {
    const raw = localStorage.getItem(key(riderId)) ?? localStorage.getItem(LEGACY_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((a): a is QueuedAction =>
      !!a && typeof a === 'object' && typeof (a as QueuedAction).id === 'string'
      && typeof (a as QueuedAction).orderId === 'string'
      && ['PICKED_UP', 'DELIVERED', 'FAILED'].includes((a as QueuedAction).kind)
      && ((a as QueuedAction).riderId === riderId || !(a as QueuedAction).riderId))
  } catch { return [] }
}

/** Writes and reads back; throws if the browser refused the write. */
function write(riderId: string, q: QueuedAction[]): void {
  const json = JSON.stringify(q)
  try {
    localStorage.setItem(key(riderId), json)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    throw new Error('This phone refused to save the update. Free some storage or try again online.')
  }
  if (localStorage.getItem(key(riderId)) !== json) {
    throw new Error('This phone did not save the update. Try again online.')
  }
}

export function enqueue(a: Omit<QueuedAction, 'id' | 'queuedAt'>): QueuedAction {
  const item: QueuedAction = { ...a, id: crypto.randomUUID(), queuedAt: Date.now() }
  write(a.riderId, [...read(a.riderId), item])
  return item
}

export function pending(riderId: string): QueuedAction[] { return read(riderId) }

export function remove(riderId: string, id: string): void {
  write(riderId, read(riderId).filter((a) => a.id !== id))
}

let draining = false

/**
 * Drains the queue in order. A permanent rejection (an illegal transition,
 * e.g. the order was already delivered from the admin console) is dropped
 * and reported; a transport failure stops the drain so later actions on the
 * same or other orders wait for the next attempt.
 */
export async function drain(
  riderId: string,
  run: (a: QueuedAction) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ sent: number; dropped: QueuedAction[]; failed: number }> {
  const dropped: QueuedAction[] = []
  let sent = 0, failed = 0
  if (draining) return { sent, dropped, failed }
  draining = true
  try {
    for (const a of read(riderId)) {
      try {
        const r = await run(a)
        if (r.ok) { remove(riderId, a.id); sent++ }
        else { remove(riderId, a.id); dropped.push(a) }   // server refused: retrying cannot help
      } catch {
        failed = read(riderId).length - sent - dropped.length   // offline still: keep the rest for later
        break
      }
    }
  } finally { draining = false }
  return { sent, dropped, failed }
}
