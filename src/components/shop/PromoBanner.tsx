import { Box, Stack, Typography } from '@mui/material'
import BoltIcon from '@mui/icons-material/Bolt'
import { paiseToRupees } from '@/lib/money'

/**
 * A single honest promise rather than a fake discount banner. Wink sells at
 * MRP -- inventing a "70% OFF" flash would be a lie, and in a town this size
 * word travels faster than any campaign.
 */
export function PromoBanner({ freeAbovePaise, zoneName }: { freeAbovePaise: number | null; zoneName?: string }) {
  return (
    <Box sx={{ px: 2, pt: 1.5 }}>
      <Box
        sx={{
          borderRadius: 3, p: 2,
          background: 'linear-gradient(135deg, #FFF4D6 0%, #FFE9B0 100%)',
          border: '1px solid #F5DFA3',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <BoltIcon sx={{ color: '#B8860B' }} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 15, color: '#5C4708' }}>
              {freeAbovePaise != null
                ? `Free delivery over ${paiseToRupees(freeAbovePaise)}${zoneName ? ` in ${zoneName}` : ''}`
                : 'Every item at MRP, no markups'}
            </Typography>
            <Typography variant="caption" sx={{ color: '#7A6220' }}>
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
