import { Box, Button, Slide, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { paiseToRupees } from '@/lib/money'
import { useCart } from '@/store/cartContext'

export function StickyCartBar() {
  const { count, subtotalPaise } = useCart()
  const navigate = useNavigate()

  return (
    <Slide direction="up" in={count > 0} mountOnEnter unmountOnExit>
      <Box
        sx={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1200,
          p: 1.5, pb: 'calc(12px + env(safe-area-inset-bottom))',
          bgcolor: 'primary.main', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <Box>
          <Typography variant="caption" sx={{ opacity: 0.85 }}>
            {count} {count === 1 ? 'item' : 'items'}
          </Typography>
          <Typography variant="body1" fontWeight={700}>{paiseToRupees(subtotalPaise)}</Typography>
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
