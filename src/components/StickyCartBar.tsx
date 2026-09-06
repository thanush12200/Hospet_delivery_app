import { Box, Button, Slide, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { usePricing } from '@/hooks/usePricing'
import { paiseToRupees } from '@/lib/money'
import { useCart } from '@/store/cartContext'

export function StickyCartBar() {
  const { count } = useCart()
  const pricing = usePricing()
  const navigate = useNavigate()

  return (
    <Slide direction="up" in={count > 0} mountOnEnter unmountOnExit>
      <Box
        sx={{
          position: 'fixed', left: 8, right: 8, zIndex: 1200,
          // Sits directly above the tab bar, not underneath it.
          bottom: 'calc(58px + env(safe-area-inset-bottom) + 8px)',
          p: 1.25, px: 2, borderRadius: 3,
          bgcolor: 'primary.main', color: '#fff',
          boxShadow: '0 6px 20px rgba(11,110,79,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <Box>
          <Typography variant="caption" sx={{ opacity: 0.85 }}>
            {count} {count === 1 ? 'item' : 'items'}
            {pricing.toFreeDeliveryPaise != null && ` · ${paiseToRupees(pricing.toFreeDeliveryPaise)} to free delivery`}
            {pricing.knownZone && pricing.feePaise === 0 && pricing.freeAbovePaise != null && ' · free delivery'}
          </Typography>
          <Typography variant="body1" fontWeight={700}>{paiseToRupees(pricing.subtotalPaise)}</Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() => navigate('/cart')}
          sx={{ bgcolor: '#fff', color: 'primary.main', '&:hover': { bgcolor: '#F1F1F1' } }}
        >
          View cart
        </Button>
      </Box>
    </Slide>
  )
}
