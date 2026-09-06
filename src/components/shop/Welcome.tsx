import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BrandSheet } from './BrandSheet'

const KEY = 'welcome.seen.v1'
/** Show the welcome card again after this long. 0 = every full load. */
const WELCOME_EVERY_MS = 24 * 60 * 60 * 1000
/** After the splash has faded. */
const AFTER_SPLASH_MS = 1900

function due(): boolean {
  try {
    const last = Number(localStorage.getItem(KEY) ?? 0)
    return !last || Date.now() - last > WELCOME_EVERY_MS
  } catch { return true }
}

/**
 * The brand card that greets a customer on the home page after the splash:
 * logo, what FAA stands for, and "Start shopping". Once a day per device, so
 * regulars are not made to tap through it on every visit. Tapping the logo in
 * the header opens the same card any time.
 */
export function Welcome() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (pathname !== '/' || !due()) return
    const t = setTimeout(() => setOpen(true), AFTER_SPLASH_MS)
    return () => clearTimeout(t)
    // Only on the first render of the home page for this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function close() {
    setOpen(false)
    try { localStorage.setItem(KEY, String(Date.now())) } catch { /* private mode */ }
  }

  return <BrandSheet open={open} onClose={close} />
}
