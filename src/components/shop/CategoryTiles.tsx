import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { Button } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { ProductImage } from './ProductImage'
import type { Category, Product } from '@/types/db'

export function CategoryTiles({ categories, products, onSelect, limit }: {
  categories: Category[]; products: Product[]; onSelect: (id: string) => void; limit?: number
}) {
  const navigate = useNavigate()
  if (categories.length === 0) return null
  return (
    <section className="category-section">
      <div className="section-heading"><div><span className="eyebrow">THE DAILY LINEUP</span><h2>What&apos;s on your list?</h2></div>
        {limit && <Button color="success" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/categories')}>All categories</Button>}
      </div>
      <div className="category-grid">
        {categories.slice(0, limit).map((c, i) => {
          const items = products.filter((p) => p.category_id === c.id)
          return <button className={`category-tile category-tone-${i % 5}`} key={c.id} onClick={() => onSelect(c.id)}>
            <div className="category-photo"><ProductImage src={items.find((p) => p.image_url)?.image_url ?? null} name={c.name} /></div>
            <strong>{c.name}</strong><small>{items.length} {items.length === 1 ? 'item' : 'items'}</small>
          </button>
        })}
      </div>
    </section>
  )
}
