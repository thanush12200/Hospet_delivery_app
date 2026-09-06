import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { CssBaseline, LinearProgress, ThemeProvider } from '@mui/material'
import { theme } from '@/theme'
import { CartProvider } from '@/store/cart'
import { CustomerProvider } from '@/store/customer'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAuth } from '@/auth/RequireAuth'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// Route-level splitting: a customer must never download the admin or rider
// bundle. This is what keeps the shop inside its budget.
const ShopLayout      = lazy(() => import('@/pages/shop/ShopLayout'))
const ShopHome        = lazy(() => import('@/pages/shop/ShopHome'))
const SearchPage      = lazy(() => import('@/pages/shop/SearchPage'))
const CartPage        = lazy(() => import('@/pages/shop/CartPage'))
const CategoriesPage  = lazy(() => import('@/pages/shop/CategoriesPage'))
const OrdersPage      = lazy(() => import('@/pages/shop/OrdersPage'))
const Checkout        = lazy(() => import('@/pages/shop/Checkout'))
const OrderTracking   = lazy(() => import('@/pages/shop/OrderTracking'))
const Login           = lazy(() => import('@/pages/shop/Login'))
const AccountPage     = lazy(() => import('@/pages/shop/AccountPage'))
const AddressesPage   = lazy(() => import('@/pages/shop/AddressesPage'))
const AddressEditPage = lazy(() => import('@/pages/shop/AddressEditPage'))
const HelpPage        = lazy(() => import('@/pages/shop/HelpPage'))

const AdminLayout  = lazy(() => import('@/pages/admin/AdminLayout'))
const OrderBoard   = lazy(() => import('@/pages/admin/OrderBoard'))
const OrderDetail  = lazy(() => import('@/pages/admin/OrderDetail'))
const NewOrder     = lazy(() => import('@/pages/admin/NewOrder'))
const Inventory    = lazy(() => import('@/pages/admin/Inventory'))
const Catalogue    = lazy(() => import('@/pages/admin/Catalogue'))
const Riders       = lazy(() => import('@/pages/admin/Riders'))
const ImportCsv    = lazy(() => import('@/pages/admin/ImportCsv'))
const Zones        = lazy(() => import('@/pages/admin/Zones'))

const MyDeliveries = lazy(() => import('@/pages/rider/MyDeliveries'))

/** Shareable product links open the sheet over the home page. */
function ProductRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/?product=${encodeURIComponent(id)}`} replace />
}

function CustomerFlow() {
  return <div className="flow-shell"><Outlet /></div>
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <AuthProvider>
          <CustomerProvider>
            <CartProvider>
              <BrowserRouter>
                <Suspense fallback={<LinearProgress />}>
                  <Routes>
                    {/* Tabbed shell: shared catalogue, tab bar, cart bar, product sheet. */}
                    <Route element={<ShopLayout />}>
                      <Route path="/" element={<ShopHome />} />
                      <Route path="/category/:categoryId" element={<ShopHome />} />
                      <Route path="/categories" element={<CategoriesPage />} />
                      <Route path="/search" element={<SearchPage />} />
                      <Route path="/cart" element={<CartPage />} />
                      <Route path="/orders" element={<OrdersPage />} />
                      <Route path="/help" element={<HelpPage />} />
                      <Route element={<RequireAuth />}>
                        <Route path="/account" element={<AccountPage />} />
                      </Route>
                    </Route>
                    <Route path="/product/:id" element={<ProductRedirect />} />
                    <Route element={<CustomerFlow />}>
                    <Route path="/login" element={<Login />} />

                    {/* Full-screen flows without the tab bar. */}
                    <Route element={<RequireAuth />}>
                      <Route path="/checkout" element={<Checkout />} />
                      <Route path="/order/:id" element={<OrderTracking />} />
                      <Route path="/account/addresses" element={<AddressesPage />} />
                      <Route path="/account/addresses/new" element={<AddressEditPage />} />
                      <Route path="/account/addresses/:id" element={<AddressEditPage />} />
                    </Route>
                    </Route>

                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<OrderBoard />} />
                      <Route path="orders/:id" element={<OrderDetail />} />
                      <Route path="new" element={<NewOrder />} />
                      <Route path="catalogue" element={<Catalogue />} />
                      <Route path="import" element={<ImportCsv />} />
                      <Route path="inventory" element={<Inventory />} />
                      <Route path="riders" element={<Riders />} />
                      <Route path="zones" element={<Zones />} />
                    </Route>

                    <Route path="/rider" element={<MyDeliveries />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </CartProvider>
          </CustomerProvider>
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
