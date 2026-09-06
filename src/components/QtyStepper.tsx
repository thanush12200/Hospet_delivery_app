import { Box, Button, IconButton, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'

/**
 * The signature quick-commerce control: an ADD button that becomes a
 * -/qty/+ stepper in place. Updates are optimistic and purely local, so it
 * always feels instant regardless of connection.
 */
export function QtyStepper({
  qty, onAdd, onRemove, disabled, fullWidth, max,
}: {
  qty: number
  onAdd: () => void
  onRemove: () => void
  disabled?: boolean
  fullWidth?: boolean
  /** Units available right now; "+" stops here instead of failing at checkout. */
  max?: number
}) {
  const capped = max !== undefined && qty >= max
  if (qty === 0) {
    return (
      <Button
        variant="outlined"
        color="primary"
        size="small"
        onClick={onAdd}
        disabled={disabled}
        fullWidth={fullWidth}
        sx={{
          width: fullWidth ? '100%' : 80, minWidth: 80, height: 36, borderWidth: 1.5, fontWeight: 800,
          fontSize: 12, px: 0.5, bgcolor: '#FFF2F1', flexShrink: 0,
          '&:hover': { borderWidth: 1.5 },
        }}
      >
        {disabled ? 'Sold out' : 'ADD +'}
      </Button>
    )
  }
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        bgcolor: 'primary.main', color: '#fff', borderRadius: '6px',
        minWidth: 80, width: fullWidth ? '100%' : 80, height: 36, flexShrink: 0,
      }}
    >
      <IconButton size="small" onClick={onRemove} sx={{ color: '#fff', p: 0.5 }} aria-label="Remove one">
        <RemoveIcon fontSize="small" />
      </IconButton>
      <Typography variant="body2" fontWeight={700}>{qty}</Typography>
      <IconButton size="small" onClick={onAdd} disabled={disabled || capped} sx={{ color: '#fff', p: 0.5, '&.Mui-disabled': { color: 'rgba(255,255,255,0.45)' } }}
        aria-label={capped ? 'No more in stock' : 'Add one'}>
        <AddIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
