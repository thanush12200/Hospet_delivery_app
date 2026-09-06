import { Box, Card, Typography } from '@mui/material'
import { QtyStepper } from './QtyStepper'
import { paiseToRupees } from '@/lib/money'
import { categoryIcon } from '@/constants/categoryIcons'
import { CARD_SHADOW } from '@/theme/brand'
import type { Product } from '@/types/db'

export function ProductCard({
  product, qty, available, categoryName, onAdd, onRemove, onOpen,
}: {
  product: Product
  qty: number
  available: number | undefined
  categoryName?: string
  onAdd: () => void
  onRemove: () => void
  /** Tap on the image or name opens the product sheet. */
  onOpen?: () => void
}) {
  // Unknown availability is treated as in-stock. The server is the real gate
  // and will reject with OUT_OF_STOCK if we guess wrong.
  const outOfStock = available !== undefined && available <= 0
  const low = available !== undefined && available > 0 && available <= 3

  return (
    <Card
      sx={{
        p: 1, borderRadius: 3, bgcolor: '#fff', boxShadow: CARD_SHADOW,
        display: 'flex', flexDirection: 'column', height: '100%', position: 'relative',
      }}
    >
      {low && (
        <Box sx={{
          position: 'absolute', top: 6, left: 6, zIndex: 1,
          bgcolor: '#FDEDEA', color: '#B3261E', fontSize: 9.5, fontWeight: 700,
          px: 0.75, py: 0.25, borderRadius: 1,
        }}>
          Only {available} left
        </Box>
      )}

      <Box
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? `View ${product.name}` : undefined}
        onClick={onOpen}
        onKeyDown={(e) => { if (onOpen && e.key === 'Enter') onOpen() }}
        sx={{
          aspectRatio: '1', bgcolor: '#F6F7F9', borderRadius: 2.5, mb: 1,
          display: 'grid', placeItems: 'center', overflow: 'hidden',
          opacity: outOfStock ? 0.4 : 1, cursor: onOpen ? 'pointer' : undefined,
        }}
      >
        {product.image_url ? (
          <img
            src={product.image_url} alt={product.name} loading="lazy"
            width={160} height={160}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <Typography sx={{ fontSize: 38 }} aria-hidden>
            {categoryIcon(categoryName ?? product.name)}
          </Typography>
        )}
      </Box>

      <Typography
        variant="body2"
        onClick={onOpen}
        sx={{
          fontWeight: 600, fontSize: 12.5, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', minHeight: 32, cursor: onOpen ? 'pointer' : undefined,
        }}
      >
        {product.name}
      </Typography>
      {product.name_kn && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: 11 }}>
          {product.name_kn}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
        {product.unit_label}
      </Typography>

      <Box sx={{ mt: 'auto', pt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>
          {paiseToRupees(product.mrp_paise)}
        </Typography>
        <QtyStepper qty={qty} onAdd={onAdd} onRemove={onRemove} disabled={outOfStock} max={available} />
      </Box>
    </Card>
  )
}
