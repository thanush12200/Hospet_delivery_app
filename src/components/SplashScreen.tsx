import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BRAND } from '@/theme/brand'

/** The logo's own red, not the green of the status banners. */
const SPLASH_BG = `linear-gradient(160deg, #FF8578 0%, #F4453C 45%, ${BRAND.redDark} 100%)`

const MIN_MS = 1400   // long enough to register, short enough not to annoy
const FADE_MS = 380

/**
 * The brand moment on a cold load: the logo on a red field, then a fade into
 * the app. Shown on every full page load of the customer app (not on staff
 * or rider routes, and not on in-app navigation). Kept short on purpose;
 * the catalogue is loading behind it anyway.
 */
export function SplashScreen() {
  const { pathname } = useLocation()
  const staff = /^\/(admin|rider|preview)(\/|$)/.test(pathname)
  const [phase, setPhase] = useState<'show' | 'fade' | 'done'>(staff ? 'done' : 'show')

  useEffect(() => {
    if (staff) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t1 = setTimeout(() => setPhase('fade'), reduce ? 700 : MIN_MS)
    const t2 = setTimeout(() => setPhase('done'), (reduce ? 700 : MIN_MS) + FADE_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [staff])

  if (phase === 'done') return null
  return (
    <div
      className={`splash${phase === 'fade' ? ' splash-out' : ''}`}
      style={{ background: SPLASH_BG }}
      role="status"
      aria-label={`${BRAND.name} is loading`}
    >
      <div className="splash-card">
        <img src={BRAND.logo} alt="" width={280} height={280} decoding="sync" />
      </div>
      <p className="splash-expansion">{BRAND.expansion}</p>
      <div className="splash-dots" aria-hidden><span /><span /><span /></div>
    </div>
  )
}
