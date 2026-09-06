import { lazy, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { StickyCartBar } from '@/components/StickyCartBar'
import { Welcome } from '@/components/shop/Welcome'
import { ToastProvider } from '@/components/Toast'
import { ProductSheet } from '@/components/shop/ProductSheet'
import { CatalogueContext, useCatalogueLoader, type CatalogueState } from '@/hooks/useCatalogue'
import { ShopHeader } from '@/components/shop/ShopHeader'
import { Link } from 'react-router-dom'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'

const LocationGate = lazy(() => import('@/components/shop/LocationGate'))

/** Routes that browse products get the sticky cart bar; the rest have their own CTA. */
const BROWSE = [/^\/$/, /^\/category\//, /^\/categories$/, /^\/search$/]

/**
 * The customer's tabbed shell: one catalogue load shared by every tab, the
 * tab bar, the sticky cart bar on browsing screens, a single toast, and the
 * product sheet that opens over any of them via ?product=<id>.
 */
export default function ShopLayout() {
  const state = useCatalogueLoader()
  return <ShopFrame state={state} />
}

export function ShopFrame({ state }: { state: CatalogueState }) {
  const { pathname } = useLocation()
  const browsing = BROWSE.some((r) => r.test(pathname))
  const { count } = useCart()
  const customer = useCustomer()
  const needsLocation = customer.status !== 'loading' && !customer.defaultAddress && !customer.selectedZoneId

  return (
    <CatalogueContext.Provider value={state}>
      <ToastProvider>
        <ShopHeader />
        <main id="main-content" className={`shop-main${browsing && count > 0 ? ' has-basket' : ''}`}>
          <Outlet />
        </main>
        <footer className="shop-footer"><div><strong>FAA.</strong><span>Your neighbourhood. Your everyday.</span></div>
          <span>Hospet, Karnataka</span><Link to="/help">Need a hand?</Link>
        </footer>
        {browsing && <StickyCartBar />}
        <BottomNav />
        {needsLocation && <Suspense fallback={null}><LocationGate /></Suspense>}
        <Welcome />
        <ProductSheet />
      </ToastProvider>
    </CatalogueContext.Provider>
  )
}
