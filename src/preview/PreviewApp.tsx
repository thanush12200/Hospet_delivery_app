import { useMemo, useState } from 'react'
import { Box, Button, CssBaseline, ThemeProvider } from '@mui/material'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthContext } from '@/auth/authContext'
import { CustomerContext, type CustomerApi } from '@/store/customerContext'
import { CartProvider } from '@/store/cart'
import { ShopFrame } from '@/pages/shop/ShopLayout'
import ShopHome from '@/pages/shop/ShopHome'
import CategoriesPage from '@/pages/shop/CategoriesPage'
import SearchPage from '@/pages/shop/SearchPage'
import CartPage from '@/pages/shop/CartPage'
import OrdersPage from '@/pages/shop/OrdersPage'
import HelpPage from '@/pages/shop/HelpPage'
import { theme } from '@/theme'
import type { CatalogueState } from '@/hooks/useCatalogue'
import type { Product, Zone } from '@/types/db'
import products from './catalogue.json'

const zones: Zone[] = ['Chittawadgi', 'Station Road', 'Amaravathi'].map((name, i) => ({
  id: `preview-zone-${i}`, name, name_kn: null, is_active: true,
  delivery_fee_paise: 2000, min_order_paise: 15000, free_delivery_above_paise: 49900,
  sla_minutes: i === 2 ? 60 : 45, lat: null, lng: null, radius_m: null,
}))
const sampleProducts: Product[] = products.map((p, i) => ({ ...p, name_kn: p.name === 'Sona Masoori Rice' ? '\u0cb8\u0ccb\u0ca8\u0cbe \u0cae\u0cb8\u0cc2\u0cb0\u0cbf \u0c85\u0c95\u0ccd\u0c95\u0cbf' : null,
  // a few sample deals so the deals board renders in the preview
  sale_price_paise: i % 4 === 0 ? Math.round(p.mrp_paise * 0.8) : null }))
const state: CatalogueState = {
  catalogue: { version: 1, fetchedAt: Date.now(), products: sampleProducts,
    categories: [...new Set(products.map((p) => p.category_id))].map((name, i) => ({ id: name, name, name_kn: null, sort_order: i, is_active: true })) },
  availability: new Map(products.map((p, i) => [p.id, i === 6 ? 0 : i === 5 ? 2 : 20])),
  loading: false, error: null, refreshAvailability: async () => {},
}

function PreviewCheckout() {
  return <Box className="empty-state"><h2>This is a sample basket</h2><p>Preview prices and stock are illustrative. Ordering is disabled here.</p>
    <Button component={Link} to="/cart" variant="contained" color="success">Back to basket</Button></Box>
}

/** Uses the real storefront with isolated state, no auth provider or API reads. */
export default function PreviewApp() {
  const [zoneId, setZoneId] = useState<string | null>(zones[0]!.id)
  const customer = useMemo<CustomerApi>(() => ({
    status: 'anon', customerId: null, profile: null, addresses: [], defaultAddress: null,
    zones, activeZone: zones.find((z) => z.id === zoneId) ?? null,
    selectedZoneId: zoneId, setSelectedZoneId: setZoneId,
    storeConfig: { is_open: true, closed_message: null, phone: null, whatsapp: null, cancel_window_minutes: 5,
      promo_title: 'Launch week deals', promo_subtitle: 'Only till Sunday', promo_until: null },
    refresh: async () => {}, updateName: async () => {}, updateContactPhone: async () => {},
  }), [zoneId])
  return <ThemeProvider theme={theme}><CssBaseline />
    <AuthContext.Provider value={{ session: null, adminRole: null, loading: false, signIn: async () => ({ error: 'Sign-in is disabled in the preview.' }), signOut: async () => {} }}>
      <CustomerContext.Provider value={customer}><CartProvider storageKey="faa.ui-preview.cart.v1">
        <BrowserRouter basename="/preview">
          <div className="preview-notice">Design preview - sample products, prices and stock. Ordering disabled.<a href="/">Open live catalogue</a></div>
          <Routes><Route element={<ShopFrame state={state} />}>
            <Route index element={<ShopHome />} /><Route path="category/:categoryId" element={<ShopHome />} />
            <Route path="categories" element={<CategoriesPage />} /><Route path="search" element={<SearchPage />} />
            <Route path="cart" element={<CartPage />} /><Route path="orders" element={<OrdersPage />} />
            <Route path="help" element={<HelpPage />} /><Route path="checkout" element={<PreviewCheckout />} />
            <Route path="account" element={<PreviewCheckout />} /><Route path="login" element={<PreviewCheckout />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route></Routes>
        </BrowserRouter>
      </CartProvider></CustomerContext.Provider>
    </AuthContext.Provider>
  </ThemeProvider>
}
