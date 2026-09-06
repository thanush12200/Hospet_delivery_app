import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { CssBaseline, LinearProgress, ThemeProvider } from '@mui/material'
import { theme } from '@/theme'
import { CartProvider } from '@/store/cart'
import { CustomerProvider } from '@/store/customer'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAuth } from '@/auth/RequireAuth'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// Route-level splitting: a customer must never download the admin or rider
// bundle. This is what keeps the shop inside its budget.
const ShopHome        = lazy(() => import('@/pages/shop/ShopHome'))
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
                    <Route path="/" element={<ShopHome />} />
                    <Route path="/cart" element={<CartPage />} />
                    <Route path="/categories" element={<CategoriesPage />} />
                    <Route path="/orders" element={<OrdersPage />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/help" element={<HelpPage />} />

                    <Route element={<RequireAuth />}>
                      <Route path="/checkout" element={<Checkout />} />
                      <Route path="/order/:id" element={<OrderTracking />} />
                      <Route path="/account" element={<AccountPage />} />
                      <Route path="/account/addresses" element={<AddressesPage />} />
                      <Route path="/account/addresses/new" element={<AddressEditPage />} />
                      <Route path="/account/addresses/:id" element={<AddressEditPage />} />
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
