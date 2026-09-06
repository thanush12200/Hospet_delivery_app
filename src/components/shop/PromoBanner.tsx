import { Box, Stack, Typography } from '@mui/material'
import BoltIcon from '@mui/icons-material/Bolt'
import { paiseToRupees } from '@/lib/money'

/**
 * A single honest promise rather than a fake discount banner. FAA sells at
 * MRP -- inventing a "70% OFF" flash would be a lie, and in a town this size
 * word travels faster than any campaign.
 */
export function PromoBanner({ freeAbovePaise, zoneName }: { freeAbovePaise: number | null; zoneName?: string }) {
  return (
    <Box sx={{ px: 2, pt: 1.5 }}>
      <Box
        sx={{
          borderRadius: 3, p: 2,
          background: 'linear-gradient(135deg, #FFF4F3 0%, #FFE3E1 100%)',
          border: '1px solid #FBD5D3',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <BoltIcon sx={{ color: 'primary.main' }} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 15, color: 'text.primary' }}>
              {freeAbovePaise != null
                ? `Free delivery over ${paiseToRupees(freeAbovePaise)}${zoneName ? ` in ${zoneName}` : ''}`
                : 'Every item at MRP, no markups'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {freeAbovePaise != null
                ? 'Straight from our Hospet warehouse · every item at MRP'
                : 'Straight from our Hospet warehouse in about 45 minutes'}
            </Typography>
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}
