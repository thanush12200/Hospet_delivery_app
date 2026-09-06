import { useEffect, useMemo, useState } from 'react'
import { Button, Skeleton, Switch, FormControlLabel } from '@mui/material'
import WifiOffOutlinedIcon from '@mui/icons-material/WifiOffOutlined'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ProductCard } from '@/components/ProductCard'
import { CategoryIconRail } from '@/components/shop/CategoryIconRail'
import { PromoBanner } from '@/components/shop/PromoBanner'
import { CategoryTiles } from '@/components/shop/CategoryTiles'
import { PRODUCT_PARAM } from '@/components/shop/ProductSheet'
import { useCatalogue } from '@/hooks/useCatalogue'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'
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

  useEffect(() => {
    if (categoryId && catalogue && !activeCategory) navigate('/', { replace: true })
  }, [categoryId, catalogue, activeCategory, navigate])

  const visible = useMemo(() => {
    const items = (catalogue?.products ?? []).filter((p) => (!categoryId || p.category_id === categoryId)
      && (!inStock || (availability.get(p.id) ?? 0) > 0))
    if (sort === 'price-low') items.sort((a, b) => a.mrp_paise - b.mrp_paise)
    if (sort === 'price-high') items.sort((a, b) => b.mrp_paise - a.mrp_paise)
    if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name))
    return items
  }, [catalogue, categoryId, inStock, availability, sort])

  return (
    <div className="shop-home">
      {!categoryId && <PromoBanner freeAbovePaise={customer.activeZone?.free_delivery_above_paise ?? null}
        zoneName={customer.activeZone?.name} minutes={customer.activeZone?.sla_minutes ?? BRAND.promiseMinutes} />}
      {!categoryId && catalogue && <CategoryTiles categories={catalogue.categories} products={catalogue.products}
        onSelect={(id) => navigate(`/category/${id}`)} limit={8} />}
      {customer.storeConfig?.is_open === false && <div className="store-closed" role="status">{customer.storeConfig.closed_message || 'The store is closed right now. You can still build your basket for later.'}</div>}
      <section id="products" className="product-section">
        <div className="section-heading product-heading">
          <div><span className="eyebrow">GOOD THINGS, EVERY DAY</span><h2>{activeCategory?.name ?? 'Stock up on the everyday'}</h2>
            {activeCategory?.name_kn && <p>{activeCategory.name_kn}</p>}
          </div>
          <label className="sort-control">Sort by <select aria-label="Sort products" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">Featured</option><option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option><option value="name">Name: A to Z</option>
          </select></label>
        </div>
        <CategoryIconRail categories={catalogue?.categories ?? []} selected={categoryId} onSelect={(id) => navigate(id ? `/category/${id}` : '/')} />
        <div className="product-meta"><span>{loading ? 'Loading your essentials...' : `${visible.length} products`}</span>
          <FormControlLabel control={<Switch size="small" color="success" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />} label="In stock only" />
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
        <p>The everyday things you need, from a store in your own neighbourhood.</p><Button color="success" onClick={() => navigate('/help')}>Meet FAA &rarr;</Button></section>}
    </div>
  )
}
