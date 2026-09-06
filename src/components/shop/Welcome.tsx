import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BrandSheet } from './BrandSheet'
import { useCustomer } from '@/store/customerContext'
import { markWelcomeSeen, welcomeDue } from '@/lib/welcome'

/** After the splash has faded. */
const AFTER_SPLASH_MS = 1900

/**
 * The brand card that greets a returning customer on the home page after the
 * splash: logo, what FAA stands for, and "Start shopping". Once a day per
 * device. A device with no delivery location yet gets the location prompt
 * instead (LocationGate), which carries the same greeting. Tapping the logo
 * in the header opens this card any time.
 */
export function Welcome() {
  const { pathname } = useLocation()
  const customer = useCustomer()
  const [open, setOpen] = useState(false)
  const located = !!customer.defaultAddress || !!customer.selectedZoneId

  useEffect(() => {
    if (pathname !== '/' || customer.status === 'loading' || !located || !welcomeDue()) return
    const t = setTimeout(() => setOpen(true), AFTER_SPLASH_MS)
    return () => clearTimeout(t)
    // Decide once, when the customer has resolved on the first home render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.status])

  function close() {
    setOpen(false)
    markWelcomeSeen()
  }

  return <BrandSheet open={open} onClose={close} />
}
