import { Box, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { CategoryTiles } from '@/components/shop/CategoryTiles'
import { useCatalogue } from '@/hooks/useCatalogue'

export default function CategoriesPage() {
  const { catalogue } = useCatalogue()
  const navigate = useNavigate()

  return (
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', minHeight: '100dvh', bgcolor: '#fff' }}>
      <Box sx={{
        background: 'linear-gradient(165deg, #0E8A62 0%, #0B6E4F 100%)', color: '#fff',
        px: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 2.5,
        borderRadius: '0 0 20px 20px',
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: 22 }}>Categories</Typography>
        <Typography variant="caption" sx={{ opacity: 0.9 }}>
          {catalogue?.products.length ?? 0} products across {catalogue?.categories.length ?? 0} categories
        </Typography>
      </Box>

      {catalogue && (
        <CategoryTiles
          categories={catalogue.categories}
          products={catalogue.products}
          onSelect={(id) => navigate(`/category/${id}`)}
        />
      )}
    </Box>
  )
}
