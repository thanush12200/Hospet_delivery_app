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
 */

const KEY = 'rider.queue.v1'

export interface QueuedAction {
  id: string
  kind: 'DELIVERED' | 'FAILED'
  orderId: string
  riderId: string
  note?: string
  queuedAt: number
}

function read(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as QueuedAction[]) : []
  } catch { return [] }
}

function write(q: QueuedAction[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* quota */ }
}

export function enqueue(a: Omit<QueuedAction, 'id' | 'queuedAt'>): QueuedAction {
  const item: QueuedAction = { ...a, id: crypto.randomUUID(), queuedAt: Date.now() }
  write([...read(), item])
  return item
}

export function pending(): QueuedAction[] { return read() }

export function remove(id: string): void {
  write(read().filter((a) => a.id !== id))
}

/**
 * Drains the queue. A permanent rejection (an illegal transition, e.g. the
 * order was already delivered from the admin console) is dropped rather than
 * retried forever; a transport failure is left in place for the next attempt.
 */
export async function drain(
  run: (a: QueuedAction) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ sent: number; dropped: number; failed: number }> {
  let sent = 0, dropped = 0, failed = 0
  for (const a of read()) {
    try {
      const r = await run(a)
      if (r.ok) { remove(a.id); sent++ }
      else { remove(a.id); dropped++ }   // server refused: retrying cannot help
    } catch { failed++ }                 // offline still: keep for later
  }
  return { sent, dropped, failed }
}
