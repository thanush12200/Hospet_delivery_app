import { Container, Typography } from '@mui/material'

/**
 * Phase 3 surface. Design constraints, from the plan:
 *  - one-thumb operation, large targets, readable in sunlight
 *  - must tolerate connection loss: queue "mark delivered" locally and sync later
 */
export default function MyDeliveries() {
  return (
    <Container sx={{ py: 3 }}>
      <Typography variant="h6" gutterBottom>My deliveries</Typography>
      <Typography variant="body2" color="text.secondary">
        No deliveries assigned.
      </Typography>
    </Container>
  )
}
