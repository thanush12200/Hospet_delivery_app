import { Box, Typography } from '@mui/material'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CategoryTiles } from '@/components/shop/CategoryTiles'
import { useCatalogue } from '@/hooks/useCatalogue'
import { shelvedCategories } from '@/lib/categories'
import { BRAND_GRADIENT } from '@/theme/brand'

export default function CategoriesPage() {
  const { catalogue } = useCatalogue()
  const navigate = useNavigate()
  const shelf = useMemo(() => catalogue ? shelvedCategories(catalogue.categories, catalogue.products) : [], [catalogue])

  return (
    <Box sx={{ pb: 'calc(var(--nav-clearance) + 8px)', minHeight: '100dvh' }}>
      <Box sx={{
        background: BRAND_GRADIENT, color: '#fff',
        px: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 2.5,
        borderRadius: '0 0 20px 20px',
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: 22 }}>Categories</Typography>
        <Typography variant="caption" sx={{ opacity: 0.9 }}>
          {catalogue?.products.length ?? 0} products across {shelf.length} categories
        </Typography>
      </Box>

      {catalogue && (
        <CategoryTiles
          categories={shelf}
          products={catalogue.products}
          onSelect={(id) => navigate(`/category/${id}`)}
        />
      )}
    </Box>
  )
}
