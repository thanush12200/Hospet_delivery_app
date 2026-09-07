import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Button, Skeleton } from '@mui/material'
import WifiOffOutlinedIcon from '@mui/icons-material/WifiOffOutlined'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ProductCard } from '@/components/ProductCard'
import { CategoryIconRail } from '@/components/shop/CategoryIconRail'
import { HeroCarousel } from '@/components/shop/HeroCarousel'
import { CategoryTiles } from '@/components/shop/CategoryTiles'
import { DealsBoard } from '@/components/shop/DealsBoard'

const BuyAgain = lazy(() => import('@/components/shop/BuyAgain'))
import { PRODUCT_PARAM } from '@/components/shop/ProductSheet'
import { useCatalogue } from '@/hooks/useCatalogue'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'
import { unitPrice } from '@/lib/price'
import { shelvedCategories } from '@/lib/categories'
import { BRAND } from '@/theme/brand'

export default function ShopHome() {
  const { catalogue, availability, loading, error } = useCatalogue()
  const cart = useCart()
  const customer = useCustomer()
  const navigate = useNavigate()
  const { categoryId = null } = useParams()
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState('featured')
  const [inStock, setInStock] = useState(false)
  const activeCategory = catalogue?.categories.find((c) => c.id === categoryId)
  const shelf = useMemo(() => catalogue ? shelvedCategories(catalogue.categories, catalogue.products) : [], [catalogue])

  useEffect(() => {
    if (categoryId && catalogue && !activeCategory) navigate('/', { replace: true })
  }, [categoryId, catalogue, activeCategory, navigate])

  const visible = useMemo(() => {
    const items = (catalogue?.products ?? []).filter((p) => (!categoryId || p.category_id === categoryId)
      && (!inStock || (availability.get(p.id) ?? 0) > 0))
    if (sort === 'price-low') items.sort((a, b) => unitPrice(a) - unitPrice(b))
    if (sort === 'price-high') items.sort((a, b) => unitPrice(b) - unitPrice(a))
    if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name))
    return items
  }, [catalogue, categoryId, inStock, availability, sort])

  return (
    <div className="shop-home">
      {!categoryId && <HeroCarousel products={catalogue?.products ?? []} categories={catalogue?.categories ?? []} config={customer.storeConfig}
        freeAbovePaise={customer.activeZone?.free_delivery_above_paise ?? null}
        minutes={customer.activeZone?.sla_minutes ?? BRAND.promiseMinutes} />}
      {!categoryId && catalogue && <DealsBoard products={catalogue.products} categories={catalogue.categories} config={customer.storeConfig} />}
      {!categoryId && catalogue && customer.status === 'ready' && customer.customerId && (
        <Suspense fallback={null}><BuyAgain products={catalogue.products} availability={availability} /></Suspense>
      )}
      {!categoryId && catalogue && <CategoryTiles categories={shelf} products={catalogue.products}
        onSelect={(id) => navigate(`/category/${id}`)} limit={8} />}
      {customer.storeConfig?.is_open === false && <div className="store-closed" role="status">{customer.storeConfig.closed_message || 'The store is closed right now. You can still build your basket for later.'}</div>}
      <section id="products" className="product-section">
        <div className="section-heading product-heading">
          <div><span className="eyebrow">GOOD THINGS, EVERY DAY</span><h2>{activeCategory?.name ?? 'Stock up on the everyday'}</h2>
          </div>
          <label className="sort-control">Sort by <select aria-label="Sort products" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">Featured</option><option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option><option value="name">Name: A to Z</option>
          </select></label>
        </div>
        <CategoryIconRail categories={shelf} selected={categoryId} onSelect={(id) => navigate(id ? `/category/${id}` : '/')} />
        <div className="product-meta"><span>{loading ? 'Loading your essentials...' : `${visible.length} products`}</span>
          <button type="button" className={`pill-toggle${inStock ? ' is-on' : ''}`} onClick={() => setInStock((v) => !v)} aria-pressed={inStock}>In stock only</button>
        </div>
        {error ? <div className="empty-state"><WifiOffOutlinedIcon /><h3>We couldn&apos;t reach the shop</h3><p>Check your connection and try again.</p>
          <Button variant="outlined" onClick={() => window.location.reload()}>Try again</Button></div>
          : loading ? <div className="product-grid">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="rounded" height={320} />)}</div>
          : visible.length === 0 ? <div className="empty-state"><h3>No products here just yet</h3><p>{inStock ? 'Try turning off the stock filter.' : 'Take a look at our other essentials.'}</p>
            <Button onClick={() => { setInStock(false); navigate('/') }}>Browse all products</Button></div>
          : <div className="product-grid">{visible.map((p) => <ProductCard key={p.id} product={p}
            categoryName={catalogue?.categories.find((c) => c.id === p.category_id)?.name}
            qty={cart.qtyOf(p.id)} available={availability.get(p.id)} onAdd={() => cart.add(p)} onRemove={() => cart.remove(p.id)}
            onOpen={() => { const next = new URLSearchParams(params); next.set(PRODUCT_PARAM, p.id); setParams(next) }} />)}</div>}
      </section>
      {!categoryId && <section className="local-note"><span>FROM HOSPET, WITH CARE.</span><h2>A familiar store.<br />A fresher way to shop.</h2>
        <p>The everyday things you need, from a store in your own neighbourhood.</p><Button onClick={() => navigate('/help')}>Meet FAA &rarr;</Button></section>}
    </div>
  )
}
