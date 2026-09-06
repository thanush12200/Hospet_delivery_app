import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import type { Pricing } from '@/lib/pricing'
import { paiseToRupees } from '@/lib/money'

/**
 * The nudge every quick-commerce customer knows: how far the basket is from
 * free delivery, and a small celebration when it gets there. Reads the same
 * pricing as checkout and place_order, so it can never promise a fee the
 * server will not honour.
 */
export function FreeDeliveryBar({ pricing, compact = false }: { pricing: Pricing; compact?: boolean }) {
  if (!pricing.knownZone || pricing.freeAbovePaise == null || pricing.subtotalPaise === 0) return null
  const reached = pricing.toFreeDeliveryPaise == null
  const pct = reached ? 100 : Math.min(100, Math.round((pricing.subtotalPaise / pricing.freeAbovePaise) * 100))

  return (
    <div className={`free-delivery${reached ? ' is-reached' : ''}${compact ? ' is-compact' : ''}`} role="status">
      <span className="free-delivery-icon" aria-hidden>
        {reached ? <CheckCircleIcon /> : <LocalShippingOutlinedIcon />}
      </span>
      <div className="free-delivery-text">
        {reached ? (
          <>
            <strong>Yay! You got FREE delivery</strong>
            {!compact && <span>No coupon needed</span>}
          </>
        ) : (
          <>
            <strong>Add {paiseToRupees(pricing.toFreeDeliveryPaise ?? 0)} more for FREE delivery</strong>
            {!compact && <span>Free delivery on orders over {paiseToRupees(pricing.freeAbovePaise)}</span>}
          </>
        )}
        <div className="free-delivery-track"><div className="free-delivery-fill" style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  )
}
