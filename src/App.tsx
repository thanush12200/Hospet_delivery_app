import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { CssBaseline, LinearProgress, ThemeProvider } from '@mui/material'
import { theme } from '@/theme'
import { CartProvider } from '@/store/cart'

// Route-level splitting: a customer must never download the admin or rider
// bundle. This is what keeps the shop under the 200KB budget.
const ShopHome     = lazy(() => import('@/pages/shop/ShopHome'))
const CartPage     = lazy(() => import('@/pages/shop/CartPage'))
const OrderBoard   = lazy(() => import('@/pages/admin/OrderBoard'))
const MyDeliveries = lazy(() => import('@/pages/rider/MyDeliveries'))

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <CartProvider>
        <BrowserRouter>
          <Suspense fallback={<LinearProgress />}>
            <Routes>
              <Route path="/" element={<ShopHome />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/admin" element={<OrderBoard />} />
              <Route path="/rider" element={<MyDeliveries />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </CartProvider>
    </ThemeProvider>
  )
}
