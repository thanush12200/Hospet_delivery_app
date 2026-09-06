import { Box, Button, Slide, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { FreeDeliveryBar } from '@/components/shop/FreeDeliveryBar'
import { usePricing } from '@/hooks/usePricing'
import { paiseToRupees } from '@/lib/money'
import { useCart } from '@/store/cartContext'
import { BRAND_SHADOW } from '@/theme/brand'

export function StickyCartBar() {
  const { count } = useCart()
  const pricing = usePricing()
  const navigate = useNavigate()

  return (
    <Slide direction="up" in={count > 0} mountOnEnter unmountOnExit>
      <Box
        sx={{
          position: 'fixed', left: 12, right: 12, zIndex: 1200, maxWidth: 560, mx: 'auto',
          // Sits directly above the tab bar, not underneath it.
          bottom: { xs: 'calc(58px + env(safe-area-inset-bottom) + 8px)', md: 16 },
          display: 'flex', flexDirection: 'column', gap: 0.75,
        }}
      >
        <FreeDeliveryBar pricing={pricing} compact />
        <Box
          sx={{
            p: 1.25, px: 2, borderRadius: '8px', gap: 1,
            bgcolor: 'success.main', color: '#fff',
            boxShadow: `0 6px 20px ${BRAND_SHADOW}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {count} {count === 1 ? 'item' : 'items'}
              {pricing.knownZone && pricing.feePaise === 0 && ' · free delivery'}
            </Typography>
            <Typography variant="body1" fontWeight={700}>{paiseToRupees(pricing.subtotalPaise)}</Typography>
          </Box>
          <Button
            variant="contained"
            onClick={() => navigate('/cart')}
            sx={{ bgcolor: '#fff', color: 'success.main', flexShrink: 0, '&:hover': { bgcolor: '#F1F1F1' } }}
          >
            View cart
          </Button>
        </Box>
      </Box>
    </Slide>
  )
}
