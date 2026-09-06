import { Box, Container, Paper, Stack, Typography } from '@mui/material'
import type { OrderStatus } from '@/types/db'

const COLUMNS: OrderStatus[] = ['PLACED', 'CONFIRMED', 'PICKING', 'PACKED', 'OUT_FOR_DELIVERY']

/**
 * Phase 1 surface: the board the business is actually run from.
 * Status changes must call the transition_order() RPC — never update
 * orders.status directly; the database will reject it.
 */
export default function OrderBoard() {
  return (
    <Container sx={{ py: 3 }}>
      <Typography variant="h6" gutterBottom>Order board</Typography>
      <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 2 }}>
        {COLUMNS.map((status) => (
          <Paper key={status} sx={{ minWidth: 240, p: 1.5, bgcolor: '#F7F8FA', borderRadius: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{status.replace(/_/g, ' ')}</Typography>
            <Box sx={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">No orders</Typography>
            </Box>
          </Paper>
        ))}
      </Stack>
    </Container>
  )
}
