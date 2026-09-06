import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BRAND } from '@/theme/brand'

/** The logo's own red. */
const SPLASH_BG = `linear-gradient(160deg, #FF8578 0%, #F4453C 45%, ${BRAND.redDark} 100%)`

/** The ride: in from the left, a beat under the wordmark, off to the right. */
const RIDE_MS = 1650
const FADE_MS = 300
/** When the app behind may open its first sheet (welcome / location). */
export const SPLASH_TOTAL_MS = RIDE_MS + FADE_MS

/**
 * The brand moment on a cold load: the FAA scooter rides in across a red
 * field, stops under the wordmark for a beat, then speeds off the right
 * edge and the app is there. Shown on every full page load of the customer
 * app (not on staff or rider routes, not on in-app navigation). Reduced
 * motion gets a still logo for a moment instead.
 */
export function SplashScreen() {
  const { pathname } = useLocation()
  const staff = /^\/(admin|rider|preview)(\/|$)/.test(pathname)
  const [phase, setPhase] = useState<'show' | 'fade' | 'done'>(staff ? 'done' : 'show')
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (staff) return
    const hold = reduce ? 700 : RIDE_MS
    const t1 = setTimeout(() => setPhase('fade'), hold)
    const t2 = setTimeout(() => setPhase('done'), hold + FADE_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [staff, reduce])

  if (phase === 'done') return null
  return (
    <div
      className={`splash${phase === 'fade' ? ' splash-out' : ''}${reduce ? ' splash-still' : ''}`}
      style={{ background: SPLASH_BG }}
      role="status"
      aria-label={`${BRAND.name} is loading`}
    >
      <div className="splash-stage">
        <div className="splash-road" aria-hidden />
        <img className="splash-scooter" src={BRAND.mark} alt="" width={220} height={220} decoding="sync" />
      </div>
      <img className="splash-wordmark" src={BRAND.wordmark} alt={BRAND.name} width={200} height={70} decoding="sync" />
      <p className="splash-expansion">{BRAND.expansion}</p>
    </div>
  )
}
