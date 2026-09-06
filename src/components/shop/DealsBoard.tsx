import { useEffect, useMemo, useRef, useState } from 'react'
import BoltIcon from '@mui/icons-material/Bolt'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ProductImage } from './ProductImage'
import { PRODUCT_PARAM } from './ProductSheet'
import { paiseToRupees } from '@/lib/money'
import { discountPct, onDeal, unitPrice } from '@/lib/price'
import type { Category, Product, StoreConfig } from '@/types/db'

const ROTATE_MS = 2600

/**
 * The offers board: a sale header, a featured tile that rotates through the
 * running deals, and category tiles with the best discount in each. Deals
 * are real prices (products.sale_price_paise) charged at checkout; when no
 * product is on a deal the board does not render, so there is never a sale
 * banner over full-price shelves.
 */
export function DealsBoard({ products, categories, config }: {
  products: Product[]; categories: Category[]; config: StoreConfig | null
}) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const deals = useMemo(() => products.filter((p) => p.is_active && onDeal(p))
    .sort((a, b) => discountPct(b) - discountPct(a)), [products])
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [entering, setEntering] = useState(true)
  const timer = useRef<number>(0)

  // Auto-rotate the featured deal; pause while the customer is looking at it.
  useEffect(() => {
    if (deals.length <= 1 || paused) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    timer.current = window.setInterval(() => {
      setEntering(false)
      window.setTimeout(() => { setIdx((i) => (i + 1) % deals.length); setEntering(true) }, reduce ? 0 : 260)
    }, ROTATE_MS)
    return () => clearInterval(timer.current)
  }, [deals.length, paused])

  if (deals.length === 0) return null
  const featured = deals[idx % deals.length] as Product

  const byCategory = categories
    .map((c) => {
      const inCat = deals.filter((p) => p.category_id === c.id)
      if (!inCat.length) return null
      return { category: c, best: inCat[0] as Product, maxPct: Math.max(...inCat.map(discountPct)) }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 4)

  const until = config?.promo_until ? new Date(config.promo_until) : null
  const live = !until || until.getTime() > Date.now()
  const title = live && config?.promo_title ? config.promo_title : "Today's deals"
  const subtitle = live && config?.promo_subtitle ? config.promo_subtitle
    : until && live ? `Till ${until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Prices below MRP, while stocks last'

  function open(p: Product) {
    const next = new URLSearchParams(params); next.set(PRODUCT_PARAM, p.id); setParams(next)
  }

  return (
    <section className="deals-board" aria-label="Deals">
      <div className="deals-header">
        <BoltIcon className="deals-bolt" aria-hidden />
        <div><h2>{title}</h2><span>{subtitle}</span></div>
        <BoltIcon className="deals-bolt flip" aria-hidden />
      </div>

      <div className={`deals-grid${byCategory.length === 0 ? ' single' : ''}`}>
        <button
          type="button"
          className={`deal-featured${entering ? ' is-entering' : ' is-leaving'}`}
          onClick={() => open(featured)}
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
          onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}
          aria-live="polite"
          aria-label={`Deal: ${featured.name} at ${paiseToRupees(unitPrice(featured))}, was ${paiseToRupees(featured.mrp_paise)}`}
        >
          <span className="deal-kicker">FEATURED DEAL</span>
          <div key={featured.id} className="deal-body">
            <div className="deal-prices">
              <s>{paiseToRupees(featured.mrp_paise)}</s>
              <strong>{paiseToRupees(unitPrice(featured))}</strong>
            </div>
            <span className="deal-name">{featured.name}</span>
            <span className="deal-unit">{featured.unit_label}</span>
            <div className="deal-photo"><ProductImage src={featured.image_url} name={featured.name} /></div>
          </div>
          {deals.length > 1 && (
            <div className="deal-dots" aria-hidden>
              {deals.slice(0, 6).map((d, i) => <span key={d.id} className={i === idx % Math.min(deals.length, 6) ? 'on' : ''} />)}
            </div>
          )}
        </button>

        {byCategory.map(({ category, best, maxPct }) => (
          <button type="button" key={category.id} className="deal-tile" onClick={() => navigate(`/category/${category.id}`)}>
            <span className="deal-tile-off">Up to <b>{maxPct}% OFF</b></span>
            <span className="deal-tile-name">{category.name}</span>
            <div className="deal-tile-photo"><ProductImage src={best.image_url} name={best.name} /></div>
          </button>
        ))}
      </div>
    </section>
  )
}
