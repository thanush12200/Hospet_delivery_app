import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import { useNavigate } from 'react-router-dom'
import { paiseToRupees } from '@/lib/money'
import { discountPct, onDeal } from '@/lib/price'
import { BRAND } from '@/theme/brand'
import type { Category, Product, StoreConfig } from '@/types/db'

const ROTATE_MS = 4200

interface Slide {
  key: string
  tone: 'green' | 'amber' | 'red'
  eyebrow: string
  title: ReactNode
  text: string
  cta: string
  go: () => void
  photos: Product[]
}

/**
 * The landing hero: a rotating set of promo cards the way Blinkit and Zepto
 * open, built from the store's own product photos rather than stock art.
 *
 *   1. the promise   groceries in 15 minutes, in the customer's area
 *   2. the pricing   free delivery over the zone threshold, no hidden fees
 *   3. the hook      today's best deals when there are any, else fresh produce
 *
 * Slides advance on their own, pause under a finger or the pointer, swipe on
 * touch, and stand still for people who asked for reduced motion.
 */
export function HeroCarousel({ products, categories, config, freeAbovePaise, zoneName, minutes = BRAND.promiseMinutes }: {
  products: Product[]; categories: Category[]; config: StoreConfig | null
  freeAbovePaise: number | null; zoneName?: string; minutes?: number
}) {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const touchX = useRef<number | null>(null)

  const slides = useMemo<Slide[]>(() => {
    const used = new Set<string>()
    const withPhoto = products.filter((p) => p.is_active && p.image_url)
    const inCategory = (re: RegExp) => new Set(categories.filter((c) => re.test(c.name)).map((c) => c.id))
    /** Up to n unused photographed products from the matching categories, topped up from anywhere. */
    const pick = (re: RegExp, n = 3): Product[] => {
      const ids = inCategory(re)
      const out: Product[] = []
      for (const list of [withPhoto.filter((p) => ids.has(p.category_id)), withPhoto]) {
        for (const p of list) {
          if (out.length >= n) break
          if (!used.has(p.id)) { used.add(p.id); out.push(p) }
        }
      }
      return out
    }
    const scrollTo = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const deals = products.filter((p) => p.is_active && onDeal(p)).sort((a, b) => discountPct(b) - discountPct(a))
    const fresh = categories.find((c) => /fruit|veg/i.test(c.name))

    const list: Slide[] = [
      {
        key: 'promise', tone: 'green', eyebrow: zoneName ? `YOUR STORE IN ${zoneName.toUpperCase()}` : 'YOUR HOSPET STORE',
        title: <>Groceries in<br /><em>{minutes} minutes</em></>,
        text: 'From the first chai to the last-minute essentials, from a store in your own neighbourhood.',
        cta: 'Shop now', go: scrollTo('products'), photos: pick(/fruit|veg|dairy|rice|atta/i),
      },
      {
        key: 'pricing', tone: 'amber', eyebrow: 'NO HIDDEN CHARGES',
        title: freeAbovePaise != null ? <>Free delivery<br /><em>over {paiseToRupees(freeAbovePaise)}</em></> : <>What you see<br /><em>is what you pay</em></>,
        text: 'No handling or platform fees. Pay by cash or UPI when your order reaches your door.',
        cta: 'Fill your basket', go: () => navigate('/categories'), photos: pick(/snack|biscuit|tea|coffee|oil|ghee/i),
      },
    ]
    if (deals.length > 0) {
      const top = deals[0]
      list.push({
        key: 'deals', tone: 'red', eyebrow: (config?.promo_title || "TODAY'S DEALS").toUpperCase(),
        title: <>Up to<br /><em>{discountPct(top as Product)}% off</em></>,
        text: config?.promo_subtitle || `${deals.slice(0, 3).map((p) => p.name).join(', ')} and more, while stocks last.`,
        cta: 'See the deals', go: scrollTo('deals'), photos: deals.slice(0, 3),
      })
    } else {
      list.push({
        key: 'fresh', tone: 'red', eyebrow: 'FRESH EVERY MORNING',
        title: <>Fruits & veg<br /><em>picked today</em></>,
        text: 'Onions, tomatoes, greens and seasonal fruit, bought fresh at the Hospet market each morning.',
        cta: 'Shop fresh', go: () => navigate(fresh ? `/category/${fresh.id}` : '/categories'), photos: pick(/fruit|veg/i),
      })
    }
    return list
  }, [products, categories, config, freeAbovePaise, zoneName, minutes, navigate])

  const count = slides.length

  useEffect(() => {
    if (paused || count < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => (i + 1) % count)
    }, ROTATE_MS)
    return () => clearInterval(t)
  }, [paused, count])

  function step(delta: number) { setIndex((i) => (i + delta + count) % count) }

  return (
    <>
      <section
        className="hero" aria-roledescription="carousel" aria-label="Offers"
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        onTouchStart={(e) => { setPaused(true); touchX.current = e.touches[0]?.clientX ?? null }}
        onTouchEnd={(e) => {
          const from = touchX.current; touchX.current = null; setPaused(false)
          const to = e.changedTouches[0]?.clientX
          if (from != null && to != null && Math.abs(to - from) > 40) step(to < from ? 1 : -1)
        }}
      >
        <div className="hero-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {slides.map((s, i) => {
            const Title = i === 0 ? 'h1' : 'h2'
            return (
              <article key={s.key} className={`hero-slide hero-${s.tone}${i === index ? ' is-active' : ''}`} aria-hidden={i !== index}>
                <div className="hero-copy">
                  <span className="hero-eyebrow">{s.eyebrow}</span>
                  <Title className="hero-title">{s.title}</Title>
                  <p>{s.text}</p>
                  <Button variant="contained" size="small" endIcon={<ArrowForwardIcon />} onClick={s.go} tabIndex={i === index ? 0 : -1}>
                    {s.cta}
                  </Button>
                </div>
                <div className="hero-photos" aria-hidden="true">
                  {s.photos.map((p, j) => (
                    <span key={p.id} className={`hero-photo hero-photo-${j}`}>
                      <img src={p.image_url ?? ''} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
                      {s.key === 'deals' && <b>{discountPct(p)}% off</b>}
                    </span>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
        {count > 1 && (
          <div className="hero-dots" role="tablist" aria-label="Slides">
            {slides.map((s, i) => (
              <button key={s.key} role="tab" aria-selected={i === index} aria-label={`Slide ${i + 1} of ${count}`}
                className={i === index ? 'is-active' : undefined} onClick={() => setIndex(i)} />
            ))}
          </div>
        )}
      </section>
      <div className="shop-promises">
        <span><LocalShippingOutlinedIcon />{freeAbovePaise != null ? `Free delivery over ${paiseToRupees(freeAbovePaise)}${zoneName ? ` in ${zoneName}` : ''}` : 'Delivered from our Hospet store'}</span>
        <span><VerifiedOutlinedIcon />No hidden charges</span>
        <span><PaymentsOutlinedIcon />Cash or UPI at your door</span>
      </div>
    </>
  )
}
