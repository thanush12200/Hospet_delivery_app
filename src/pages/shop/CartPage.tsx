import { useEffect, useRef } from 'react'
import { Alert, Button } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler'
import AddIcon from '@mui/icons-material/Add'
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useToast } from '@/components/toastContext'
import { useCatalogue } from '@/hooks/useCatalogue'
import { isFresh, reconcileCart } from '@/lib/reconcile'
import { QtyStepper } from '@/components/QtyStepper'
import { FreeDeliveryBar } from '@/components/shop/FreeDeliveryBar'
import { ProductImage } from '@/components/shop/ProductImage'
import { SubPageBar } from '@/components/shop/SubPageBar'
import { usePricing } from '@/hooks/usePricing'
import { paiseToRupees } from '@/lib/money'
import { onDeal, unitPrice } from '@/lib/price'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'
import { BRAND } from '@/theme/brand'

export default function CartPage() {
  const cart = useCart()
  const customer = useCustomer()
  const navigate = useNavigate()
  const pricing = usePricing()
  const { availability: stock, refreshAvailability, catalogue } = useCatalogue()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const productIds = cart.lines.map((l) => l.product.id).join(',')
  useEffect(() => { if (productIds) void refreshAvailability(productIds.split(',')) }, [productIds, refreshAvailability])

  // Bring the stored product copies up to today's catalogue: prices, names,
  // photos, and anything delisted. Runs once per catalogue load.
  const reconciledFor = useRef<number | null>(null)
  useEffect(() => {
    if (!catalogue || cart.lines.length === 0) return
    if (reconciledFor.current === catalogue.version && !params.get('repriced')) return
    reconciledFor.current = catalogue.version
    if (isFresh(cart.lines, catalogue.products) && !params.get('repriced')) return
    const r = reconcileCart(cart.lines, catalogue.products)
    cart.replace(r.lines)
    const notes: string[] = []
    if (r.repriced.length) notes.push(`Prices updated: ${r.repriced.join(', ')}`)
    if (r.removed.length) notes.push(`No longer available: ${r.removed.join(', ')}`)
    if (notes.length) toast.show(notes.join('. '))
    else if (params.get('repriced')) toast.show('Your basket is up to date. Try placing the order again.')
    if (params.get('repriced')) { const next = new URLSearchParams(params); next.delete('repriced'); setParams(next, { replace: true }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, cart.lines.length])
  const short = cart.lines.filter((l) => {
    const available = stock.get(l.product.id)
    return available !== undefined && available < l.qty
  })
  const mrpTotal = cart.lines.reduce((sum, l) => sum + l.product.mrp_paise * l.qty, 0)
  const savings = mrpTotal - pricing.subtotalPaise
  const feeWaived = pricing.knownZone && pricing.feePaise === 0 && (pricing.zone?.delivery_fee_paise ?? 0) > 0
  const minutes = customer.activeZone?.sla_minutes ?? BRAND.promiseMinutes
  const cancelMinutes = customer.storeConfig?.cancel_window_minutes ?? 5
  const blocked = short.length > 0 ? 'Fix the quantities above to continue'
    : pricing.belowMin ? `Add ${paiseToRupees(pricing.minOrderPaise - pricing.subtotalPaise)} more to reach the minimum order`
    : null

  if (cart.lines.length === 0) return <div className="empty-state empty-basket"><ShoppingBagOutlinedIcon />
    <h1>Your cart is empty</h1><p>Everyday essentials, at your door in {minutes} minutes.</p>
    <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/')}>Start shopping</Button></div>

  return <div className="cart-page">
    <SubPageBar title="My cart" backTo="/" />
    <div className="cart-body">
      <section className="cart-card cart-delivery" aria-label="Delivery time">
        <span className="cart-delivery-icon"><TwoWheelerIcon /></span>
        <div>
          <strong>Delivery in {minutes} minutes</strong>
          <span>Shipment of {cart.count} {cart.count === 1 ? 'item' : 'items'}{customer.activeZone ? ` · ${customer.activeZone.name}` : ''}</span>
        </div>
      </section>

      {short.length > 0 && <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 3 }}>Stock has changed for {short.map((l) => l.product.name).join(', ')}. Reduce the quantity to continue.</Alert>}

      <section className="cart-card" aria-label="Items in your cart">
        {cart.lines.map(({ product, qty }) => {
          const available = stock.get(product.id)
          const over = available !== undefined && available < qty
          const price = unitPrice(product)
          return <article className="cart-item" key={product.id}>
            <div className="cart-photo"><ProductImage src={product.image_url} name={product.name} /></div>
            <div className="cart-item-info">
              <h3>{product.name}</h3>
              <span>{product.unit_label}</span>
              <div className="cart-item-price">
                <strong>{paiseToRupees(price * qty)}</strong>
                {onDeal(product) && <s>{paiseToRupees(product.mrp_paise * qty)}</s>}
              </div>
              {over && <small className="cart-short">{available === 0 ? 'Sold out' : `Only ${available} left`}</small>}
            </div>
            <div className="cart-item-qty">
              <QtyStepper qty={qty} max={available} onAdd={() => cart.add(product)} onRemove={() => cart.remove(product.id)} />
              <button type="button" className="cart-remove" onClick={() => cart.removeLine(product.id)} aria-label={`Remove ${product.name}`}>Remove</button>
            </div>
          </article>
        })}
        <button type="button" className="cart-add-more" onClick={() => navigate('/')}>
          <span>Missed something?</span><strong><AddIcon fontSize="small" /> Add more items</strong>
        </button>
      </section>

      <div className="cart-nudge"><FreeDeliveryBar pricing={pricing} /></div>

      <section className="cart-card cart-bill" aria-label="Bill details">
        <h2>Bill details</h2>
        <div className="bill-row"><span>Items total</span>
          <span>{savings > 0 && <s>{paiseToRupees(mrpTotal)}</s>}{paiseToRupees(pricing.subtotalPaise)}</span></div>
        <div className="bill-row"><span>Delivery charge</span>
          <span>{!pricing.knownZone ? 'At checkout'
            : feeWaived ? <><s>{paiseToRupees(pricing.zone?.delivery_fee_paise ?? 0)}</s><em>FREE</em></>
            : pricing.feePaise === 0 ? <em>FREE</em> : paiseToRupees(pricing.feePaise)}</span></div>
        <div className="bill-row"><span>Handling charge</span><span><em>₹0</em></span></div>
        <div className="bill-total"><span>To pay</span><span>{paiseToRupees(pricing.totalPaise)}</span></div>
        {(savings > 0 || feeWaived) && <div className="cart-savings">
          <SavingsOutlinedIcon fontSize="small" /> You save {paiseToRupees(savings + (feeWaived ? (pricing.zone?.delivery_fee_paise ?? 0) : 0))} on this order
        </div>}
      </section>

      {pricing.belowMin && <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 3 }}>
        Minimum order is {paiseToRupees(pricing.minOrderPaise)}. Add {paiseToRupees(pricing.minOrderPaise - pricing.subtotalPaise)} more to check out.
      </Alert>}

      <section className="cart-card cart-policy" aria-label="Payment and cancellation">
        <p><strong>Pay at your door.</strong> Cash or UPI to the delivery partner. No advance payment.</p>
        <p><strong>Change your mind?</strong> Cancel free within {cancelMinutes} minutes of placing the order, before packing starts.</p>
      </section>
    </div>

    <div className="cart-footer">
      <div className="cart-footer-total">
        <strong>{paiseToRupees(pricing.totalPaise)}</strong>
        <span>{blocked ?? `${cart.count} ${cart.count === 1 ? 'item' : 'items'} · pay at your door`}</span>
      </div>
      <Button variant="contained" size="large" endIcon={<ArrowForwardIcon />}
        disabled={!!blocked} onClick={() => navigate('/checkout')}>Proceed to checkout</Button>
    </div>
  </div>
}
