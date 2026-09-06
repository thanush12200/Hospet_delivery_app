/**
 * Loud-enough alerts for the store counter: a synthesised chime (no audio
 * asset to load or cache), a browser notification, and a flashing tab title.
 *
 * Browsers only let a page make sound or show notifications after a user
 * gesture, so the admin screens show an "Enable alerts" button once; armed
 * state is remembered per tab.
 */

const ARMED_KEY = 'faa.alerts.armed'
let ctx: AudioContext | null = null

export function alertsArmed(): boolean {
  try { return sessionStorage.getItem(ARMED_KEY) === '1' } catch { return false }
}

/** Call from a click handler: unlocks audio and asks for notification permission. */
export async function armAlerts(): Promise<void> {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
  } catch { /* no audio on this device */ }
  try {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
  } catch { /* denied or unsupported */ }
  try { sessionStorage.setItem(ARMED_KEY, '1') } catch { /* private mode */ }
}

/** Two rising tones, about half a second. Silent until armAlerts() ran. */
export function chime(times = 1): void {
  if (!ctx) { if (!alertsArmed()) return; try { ctx = new AudioContext() } catch { return } }
  const ac = ctx
  if (ac.state === 'suspended') void ac.resume()
  for (let i = 0; i < times; i++) {
    const at = ac.currentTime + i * 0.7
    for (const [freq, start, len] of [[880, 0, 0.18], [1174.66, 0.2, 0.28]] as const) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at + start)
      gain.gain.exponentialRampToValueAtTime(0.35, at + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + start + len)
      osc.connect(gain).connect(ac.destination)
      osc.start(at + start); osc.stop(at + start + len + 0.05)
    }
  }
}

export function notify(title: string, body: string, tag?: string): void {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const n = new Notification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', requireInteraction: true })
    n.onclick = () => { window.focus(); n.close() }
  } catch { /* some browsers throw when the page is not visible */ }
}

let baseTitle: string | null = null
let flashTimer = 0

/** "(2) New order" alternating with the normal title; 0 restores it. */
export function flashTitle(count: number): void {
  baseTitle ??= document.title
  window.clearInterval(flashTimer)
  if (count <= 0) { document.title = baseTitle; return }
  let on = true
  const loud = `(${count}) New order${count > 1 ? 's' : ''}!`
  document.title = loud
  flashTimer = window.setInterval(() => { on = !on; document.title = on ? loud : (baseTitle as string) }, 1200)
}
