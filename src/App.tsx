import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { CssBaseline, LinearProgress, ThemeProvider } from '@mui/material'
import { theme } from '@/theme'
import { CartProvider } from '@/store/cart'
import { AuthProvider } from '@/auth/AuthProvider'

// Route-level splitting: a customer must never download the admin or rider
// bundle. This is what keeps the shop inside its budget.
const ShopHome     = lazy(() => import('@/pages/shop/ShopHome'))
const CartPage     = lazy(() => import('@/pages/shop/CartPage'))
const AdminLayout  = lazy(() => import('@/pages/admin/AdminLayout'))
const OrderBoard   = lazy(() => import('@/pages/admin/OrderBoard'))
const OrderDetail  = lazy(() => import('@/pages/admin/OrderDetail'))
const NewOrder     = lazy(() => import('@/pages/admin/NewOrder'))
const Inventory    = lazy(() => import('@/pages/admin/Inventory'))
const MyDeliveries = lazy(() => import('@/pages/rider/MyDeliveries'))

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <CartProvider>
          <BrowserRouter>
            <Suspense fallback={<LinearProgress />}>
              <Routes>
                <Route path="/" element={<ShopHome />} />
                <Route path="/cart" element={<CartPage />} />

                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<OrderBoard />} />
                  <Route path="orders/:id" element={<OrderDetail />} />
                  <Route path="new" element={<NewOrder />} />
                  <Route path="inventory" element={<Inventory />} />
                </Route>

                <Route path="/rider" element={<MyDeliveries />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
