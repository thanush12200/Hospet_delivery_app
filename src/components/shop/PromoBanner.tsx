import { Box, Stack, Typography } from '@mui/material'
import { BRAND, BRAND_GRADIENT, CARD_SHADOW } from '@/theme/brand'
import { paiseToRupees } from '@/lib/money'

/**
 * A single honest promise rather than a fake discount banner. FAA sells at
 * MRP -- inventing a "70% OFF" flash would be a lie, and in a town this size
 * word travels faster than any campaign.
 */
export function PromoBanner({ freeAbovePaise, zoneName }: { freeAbovePaise: number | null; zoneName?: string }) {
  return (
    <Box sx={{ px: 2, pt: 2 }}>
      <Box
        sx={{
          position: 'relative', overflow: 'hidden',
          borderRadius: 3.5, p: 2, pr: 13, minHeight: 104,
          background: BRAND_GRADIENT, color: '#fff', boxShadow: CARD_SHADOW,
        }}
      >
        <Stack spacing={0.5}>
          <Typography sx={{ fontWeight: 900, fontSize: 18, lineHeight: 1.15 }}>
            {freeAbovePaise != null
              ? `Free delivery over ${paiseToRupees(freeAbovePaise)}`
              : 'Every item at MRP'}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.92, lineHeight: 1.35 }}>
            {freeAbovePaise != null
              ? `${zoneName ? `In ${zoneName}. ` : ''}No markups, straight from our ${BRAND.city} store.`
              : `No markups, ever. Straight from our ${BRAND.city} store in minutes.`}
          </Typography>
        </Stack>
        <Box
          component="img" src={BRAND.mark} alt="" aria-hidden decoding="async"
          sx={{
            position: 'absolute', right: -6, bottom: -4, width: 128, height: 'auto',
            filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.25))',
          }}
        />
      </Box>
    </Box>
  )
}
