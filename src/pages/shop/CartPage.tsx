import { useEffect } from 'react'
import { Alert, Button, IconButton } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useNavigate } from 'react-router-dom'
import { useCatalogue } from '@/hooks/useCatalogue'
import { QtyStepper } from '@/components/QtyStepper'
import { ProductImage } from '@/components/shop/ProductImage'
import { usePricing } from '@/hooks/usePricing'
import { paiseToRupees } from '@/lib/money'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'

export default function CartPage() {
  const cart = useCart()
  const customer = useCustomer()
  const navigate = useNavigate()
  const pricing = usePricing()
  const { availability: stock, refreshAvailability } = useCatalogue()
  const productIds = cart.lines.map((l) => l.product.id).join(',')
  useEffect(() => { if (productIds) void refreshAvailability(productIds.split(',')) }, [productIds, refreshAvailability])
  const short = cart.lines.filter((l) => {
    const available = stock.get(l.product.id)
    return available !== undefined && available < l.qty
  })
  if (cart.lines.length === 0) return <div className="empty-state empty-basket"><ShoppingBagOutlinedIcon />
    <h1>A little empty. A lot of possibilities.</h1><p>Your everyday essentials are a few taps away.</p>
    <Button variant="contained" color="success" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/')}>Start shopping</Button></div>

  return <div className="basket-page">
    <div className="section-heading"><div><span className="eyebrow">YOUR DAILY HAUL</span><h1>Your basket <small>{cart.count} {cart.count === 1 ? 'item' : 'items'}</small></h1></div>
      <Button color="success" onClick={() => navigate('/')}>Keep shopping</Button></div>
    {short.length > 0 && <Alert severity="warning" sx={{ mb: 2 }}>Stock has changed for {short.map((l) => l.product.name).join(', ')}. Reduce the quantity to continue.</Alert>}
    <div className="basket-layout">
      <section aria-label="Basket items">
        <div className="basket-delivery"><LocalShippingOutlinedIcon /><div><strong>At your door in about {customer.activeZone?.sla_minutes ?? 45} minutes</strong>
          <span>{customer.activeZone ? `Delivering to ${customer.activeZone.name}` : 'Choose your delivery address at checkout'}</span></div></div>
        <div className="basket-items">{cart.lines.map(({ product, qty }) => {
          const available = stock.get(product.id)
          const over = available !== undefined && available < qty
          return <article className="basket-item" key={product.id}>
            <div className="basket-photo"><ProductImage src={product.image_url} name={product.name} /></div>
            <div className="basket-item-name"><h3>{product.name}</h3><span>{product.unit_label} - {paiseToRupees(product.mrp_paise)}</span>
              {over && <small className="basket-short">{available === 0 ? 'Sold out' : `Only ${available} left`}</small>}</div>
            <div className="basket-quantity"><QtyStepper qty={qty} max={available} onAdd={() => cart.add(product)} onRemove={() => cart.remove(product.id)} /></div>
            <strong className="basket-line-price">{paiseToRupees(product.mrp_paise * qty)}</strong>
            <IconButton className="basket-remove" size="small" aria-label={`Remove ${product.name}`} title="Remove item" onClick={() => cart.removeLine(product.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
          </article>
        })}</div>
        <div className="basket-assurance">Every item at MRP. No handling or platform fees.</div>
      </section>
      <aside className="basket-summary" aria-label="Bill summary">
        <h2>Bill details</h2><div className="bill-row"><span>Items total</span><span>{paiseToRupees(pricing.subtotalPaise)}</span></div>
        <div className="bill-row"><span>Delivery fee</span><span>{!pricing.knownZone ? 'At checkout' : pricing.feePaise === 0 ? 'FREE' : paiseToRupees(pricing.feePaise)}</span></div>
        <div className="bill-total"><strong>To pay</strong><strong>{paiseToRupees(pricing.totalPaise)}</strong></div>
        {pricing.toFreeDeliveryPaise != null && <div className="free-delivery-note"><LocalShippingOutlinedIcon /><span>Add {paiseToRupees(pricing.toFreeDeliveryPaise)} for free delivery</span></div>}
        {pricing.belowMin && <Alert severity="warning" sx={{ my: 2 }}>Minimum order is {paiseToRupees(pricing.minOrderPaise)}. Add {paiseToRupees(pricing.minOrderPaise - pricing.subtotalPaise)} more.</Alert>}
        {!pricing.knownZone && <p className="bill-note">Delivery charges will be confirmed after you choose an address.</p>}
        <div className="basket-checkout"><Button fullWidth size="large" color="success" variant="contained" endIcon={<ArrowForwardIcon />}
          disabled={short.length > 0 || pricing.belowMin} onClick={() => navigate('/checkout')}>Continue to checkout</Button></div>
        <p className="bill-note">Pay with cash or UPI at your door.</p>
      </aside>
    </div>
  </div>
}
