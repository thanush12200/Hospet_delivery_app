import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { Button } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { ProductImage } from './ProductImage'
import { categoryIcon } from '@/constants/categoryIcons'
import type { Category, Product } from '@/types/db'

/**
 * The category grid. Pass categories already run through shelvedCategories:
 * every tile here is expected to have something behind it. A tile shows the
 * first product photo in the category, or the category glyph when none of
 * its products has one yet.
 */
export function CategoryTiles({ categories, products, onSelect, limit }: {
  categories: Category[]; products: Product[]; onSelect: (id: string) => void; limit?: number
}) {
  const navigate = useNavigate()
  if (categories.length === 0) return null
  const shown = limit ? categories.slice(0, limit) : categories
  return (
    <section className="category-section">
      <div className="section-heading"><div><span className="eyebrow">SHOP BY CATEGORY</span><h2>What&apos;s on your list?</h2></div>
        {limit && categories.length > limit && <Button color="primary" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/categories')}>All categories</Button>}
      </div>
      <div className="category-grid">
        {shown.map((c, i) => {
          const items = products.filter((p) => p.category_id === c.id)
          const photo = items.find((p) => p.image_url)?.image_url ?? null
          return <button className={`category-tile category-tone-${i % 5}`} key={c.id} onClick={() => onSelect(c.id)}>
            <div className="category-photo">
              {photo ? <ProductImage src={photo} name={c.name} /> : <span className="category-glyph" aria-hidden="true">{categoryIcon(c.name)}</span>}
            </div>
            <strong>{c.name}</strong>
            <small>{items.length} {items.length === 1 ? 'item' : 'items'}</small>
          </button>
        })}
      </div>
    </section>
  )
}
