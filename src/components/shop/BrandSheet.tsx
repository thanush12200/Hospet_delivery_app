import { Box, Button, Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { BRAND } from '@/theme/brand'

/** Tap the logo: the full logo, large and clear, with what FAA stands for. */
export function BrandSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <BottomSheet open={open} onClose={onClose}>
      <Box sx={{ px: 3, pb: 3, pt: 1, textAlign: 'center' }}>
        <Box sx={{ maxWidth: 360, mx: 'auto' }}>
          <img
            src={BRAND.logo} alt={`${BRAND.name} logo: ${BRAND.tagline}`}
            style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 16 }}
          />
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: 20, mt: 1.5 }}>
          {BRAND.name} <Typography component="span" sx={{ fontWeight: 500, fontSize: 16, color: 'text.secondary' }}>· {BRAND.expansion}</Typography>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {BRAND.subline}, from our own store in {BRAND.city}.
        </Typography>
        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 2 }}>
          <Button variant="contained" onClick={() => { onClose(); navigate('/') }}>Start shopping</Button>
          <Button variant="outlined" onClick={() => { onClose(); navigate('/help') }}>Help & support</Button>
        </Stack>
      </Box>
    </BottomSheet>
  )
}
