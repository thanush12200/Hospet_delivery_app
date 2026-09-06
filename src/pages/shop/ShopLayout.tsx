import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { StickyCartBar } from '@/components/StickyCartBar'
import { ToastProvider } from '@/components/Toast'
import { ProductSheet } from '@/components/shop/ProductSheet'
import { CatalogueContext, useCatalogueLoader } from '@/hooks/useCatalogue'

/** Routes that browse products get the sticky cart bar; the rest have their own CTA. */
const BROWSE = [/^\/$/, /^\/category\//, /^\/categories$/, /^\/search$/]

/**
 * The customer's tabbed shell: one catalogue load shared by every tab, the
 * tab bar, the sticky cart bar on browsing screens, a single toast, and the
 * product sheet that opens over any of them via ?product=<id>.
 */
export default function ShopLayout() {
  const state = useCatalogueLoader()
  const { pathname } = useLocation()
  const browsing = BROWSE.some((r) => r.test(pathname))

  return (
    <CatalogueContext.Provider value={state}>
      <ToastProvider>
        <Outlet />
        {browsing && <StickyCartBar />}
        <BottomNav />
        <ProductSheet />
      </ToastProvider>
    </CatalogueContext.Provider>
  )
}
