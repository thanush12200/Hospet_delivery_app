import { QtyStepper } from './QtyStepper'
import { ProductImage } from './shop/ProductImage'
import { paiseToRupees } from '@/lib/money'
import type { Product } from '@/types/db'

export function ProductCard({ product, qty, available, categoryName, onAdd, onRemove, onOpen }: {
  product: Product; qty: number; available: number | undefined; categoryName?: string
  onAdd: () => void; onRemove: () => void; onOpen?: () => void
}) {
  const outOfStock = available !== undefined && available <= 0
  const low = available !== undefined && available > 0 && available <= 3
  return (
    <article className={`product-card${qty > 0 ? ' in-basket' : ''}${outOfStock ? ' sold-out' : ''}`}>
      <button className="product-open" onClick={onOpen} aria-label={`View ${product.name}`} disabled={!onOpen}>
        <div className="product-photo"><ProductImage src={product.image_url} name={product.name} />
          {low && <span className="stock-label">Only {available} left</span>}
          {outOfStock && <span className="stock-label">Sold out</span>}
        </div>
        <div className="product-info">
          <span className="product-brand">{product.brand || categoryName || 'Everyday essentials'}</span>
          <h3>{product.name}</h3>
          <span className="product-kannada">{product.name_kn || '\u00a0'}</span>
          <span className="product-unit">{product.unit_label}</span>
        </div>
      </button>
      <div className="product-purchase"><div><strong>{paiseToRupees(product.mrp_paise)}</strong><small>MRP incl. taxes</small></div>
        <QtyStepper qty={qty} onAdd={onAdd} onRemove={onRemove} disabled={outOfStock} max={available} />
      </div>
    </article>
  )
}
