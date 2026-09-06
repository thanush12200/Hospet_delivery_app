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
          position: 'fixed', left: 12, right: 12, zIndex: 1350, maxWidth: 560, mx: 'auto',
          // Sits directly above the floating tab bar, not underneath it.
          bottom: { xs: 'calc(var(--nav-clearance) + 6px)', md: 'calc(var(--nav-clearance) + 6px)' },
          display: 'flex', flexDirection: 'column', gap: 0.75,
        }}
      >
        <FreeDeliveryBar pricing={pricing} compact />
        <Box
          sx={{
            p: 1.25, px: 2, borderRadius: '18px', gap: 1,
            bgcolor: 'rgba(229,35,31,0.86)', color: '#fff',
            backdropFilter: 'blur(18px) saturate(1.6)', WebkitBackdropFilter: 'blur(18px) saturate(1.6)',
            border: '1px solid rgba(255,255,255,0.35)',
            boxShadow: `0 10px 30px ${BRAND_SHADOW}, inset 0 1px 0 rgba(255,255,255,0.35)`,
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
            sx={{ bgcolor: '#fff', color: 'primary.main', flexShrink: 0, '&:hover': { bgcolor: '#F1F1F1' } }}
          >
            View cart
          </Button>
        </Box>
      </Box>
    </Slide>
  )
}
