import { Box, Typography } from '@mui/material'
import { categoryIcon, TILE_TINTS } from '@/constants/categoryIcons'
import type { Category, Product } from '@/types/db'

/** Shop-by-category grid, with a live count so nothing looks emptier than it is. */
export function CategoryTiles({
  categories, products, onSelect,
}: {
  categories: Category[]
  products: Product[]
  onSelect: (id: string) => void
}) {
  if (categories.length === 0) return null

  return (
    <Box sx={{ px: 2, pt: 2.5 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 16, mb: 1.25 }}>
        Shop by category
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 1.25 }}>
        {categories.map((c, i) => {
          const n = products.filter((p) => p.category_id === c.id).length
          return (
            <Box
              key={c.id}
              onClick={() => onSelect(c.id)}
              sx={{
                bgcolor: TILE_TINTS[i % TILE_TINTS.length],
                borderRadius: 2.5, p: 1.5, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 0.5,
                minHeight: 96, justifyContent: 'space-between',
                transition: 'transform .12s',
                '&:active': { transform: 'scale(0.97)' },
              }}
            >
              <Typography sx={{ fontSize: 26, lineHeight: 1 }}>{categoryIcon(c.name)}</Typography>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 12.5, lineHeight: 1.2 }}>
                  {c.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                  {n} {n === 1 ? 'item' : 'items'}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
