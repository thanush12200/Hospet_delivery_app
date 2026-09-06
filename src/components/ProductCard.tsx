import { Box, Card, Typography } from '@mui/material'
import { QtyStepper } from './QtyStepper'
import { paiseToRupees } from '@/lib/money'
import type { Product } from '@/types/db'

export function ProductCard({
  product, qty, available, onAdd, onRemove,
}: {
  product: Product
  qty: number
  available: number | undefined
  onAdd: () => void
  onRemove: () => void
}) {
  // Treat unknown availability as in-stock; the server is the real gate and
  // will reject with OUT_OF_STOCK if we are wrong.
  const outOfStock = available !== undefined && available <= 0

  return (
    <Card sx={{ p: 1, border: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          aspectRatio: '1', bgcolor: '#F7F8FA', borderRadius: 1.5, mb: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', opacity: outOfStock ? 0.45 : 1,
        }}
      >
        {product.image_url
          ? <img src={product.image_url} alt={product.name} loading="lazy" width={160} height={160}
                 style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <Typography variant="caption" color="text.secondary">No image</Typography>}
      </Box>

      <Typography variant="body2" fontWeight={600} sx={{
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36,
      }}>
        {product.name}
      </Typography>
      {product.name_kn && (
        <Typography variant="caption" color="text.secondary" noWrap>{product.name_kn}</Typography>
      )}
      <Typography variant="caption" color="text.secondary">{product.unit_label}</Typography>

      <Box sx={{ mt: 'auto', pt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2" fontWeight={700}>{paiseToRupees(product.mrp_paise)}</Typography>
        <QtyStepper qty={qty} onAdd={onAdd} onRemove={onRemove} disabled={outOfStock} />
      </Box>
    </Card>
  )
}
