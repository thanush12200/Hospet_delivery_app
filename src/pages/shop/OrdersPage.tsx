import { Box, Button, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'

/**
 * Placeholder until phone-OTP sign-in lands in Phase 2. Order history needs an
 * identity, and there is no point inventing a fake one here -- RLS scopes
 * orders to the signed-in customer.
 */
export default function OrdersPage() {
  const navigate = useNavigate()
  return (
    <Box sx={{
      pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', minHeight: '100dvh',
      display: 'grid', placeItems: 'center', px: 3, textAlign: 'center', bgcolor: '#fff',
    }}>
      <Box>
        <Typography sx={{ fontSize: 44, mb: 1 }}>🧾</Typography>
        <Typography variant="h6" gutterBottom>No orders yet</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your past orders will appear here once you place one.
        </Typography>
        <Button variant="contained" onClick={() => navigate('/')}>Start shopping</Button>
      </Box>
      <BottomNav />
    </Box>
  )
}
