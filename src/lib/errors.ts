import { paiseToRupees } from '@/lib/money'
import type { PlaceOrderResult, TransitionError } from '@/types/db'

/**
 * Human copy for every error the order functions can answer with. The raw
 * enum used to reach the screen for anything the caller had not mapped
 * ("PRODUCT_UNAVAILABLE" in a red box is not something a customer can act on).
 */
export function describePlaceOrderError(r: Extract<PlaceOrderResult, { ok: false }>): string {
  switch (r.error) {
    case 'OUT_OF_STOCK':
      return `Just sold out: ${(r.shortages ?? [])
        .map((s) => `${s.name} (${s.available} left)`).join(', ')}`
    case 'BELOW_MIN_ORDER':
      return `Minimum order for this area is ${paiseToRupees(r.min_order_paise ?? 0)}`
    case 'PRICE_MISMATCH':
      return 'Prices changed while you were shopping. Please review your cart.'
    case 'PRODUCT_UNAVAILABLE':
      return 'One of the items is no longer available. Please remove it from your cart.'
    case 'INVALID_ADDRESS':
      return 'That address is no longer deliverable. Please pick or add another.'
    case 'INVALID_QTY':
      return 'One of the quantities is invalid. Please review your cart.'
    case 'EMPTY_CART':
      return 'Your cart is empty.'
    case 'NO_CONTACT_PHONE':
      return 'Add a mobile number so the delivery partner can reach you.'
    case 'STORE_CLOSED':
      return r.message?.trim() || 'The store is closed right now. Please try again later.'
    case 'NOT_AUTHORIZED':
      return 'Please sign in again to place this order.'
    default:
      return 'Could not place the order. Please try again.'
  }
}

export function describeTransitionError(code: TransitionError | string | undefined): string {
  switch (code) {
    case 'NOT_AUTHORIZED':      return 'You are not allowed to change this order.'
    case 'ILLEGAL_TRANSITION':  return 'This order has already moved on.'
    case 'CANCEL_WINDOW_CLOSED': return 'The cancellation window has closed. Call the store and we will help.'
    case 'NO_RIDER':            return 'Assign a rider before sending the order out.'
    case 'INVALID_RIDER':       return 'That rider is not active.'
    case 'ORDER_CLOSED':        return 'This order is complete; nothing more to do.'
    case 'NOTHING_PACKED':      return 'Nothing was packed. Cancel the order instead of sending an empty one.'
    case 'INVALID_QTY':         return 'A packed quantity is invalid.'
    case 'NOT_FAILED':          return 'Only a failed delivery can be received back.'
    case 'ALREADY_RETURNED':    return 'This return was already received.'
    case 'NO_SUCH_ORDER':       return 'Order not found.'
    default:                    return 'The change was refused. Please refresh and try again.'
  }
}

/**
 * Supabase Auth messages a customer should never see raw. "Unsupported phone
 * provider" is the project having no SMS gateway configured (or the number
 * not being on the test list); the customer cannot fix that, so say so.
 */
export function describeAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('unsupported phone provider') || m.includes('sms provider') || m.includes('phone provider'))
    return 'SMS sign-in is still being switched on for this store. Please try again a little later, or message the store.'
  if (m.includes('signups not allowed') || m.includes('phone_provider_disabled'))
    return 'Phone sign-in is turned off right now. Please message the store.'
  if (m.includes('provider is not enabled') || m.includes('unsupported provider'))
    return 'Google sign-in is not switched on for this store yet. Please use your mobile number.'
  if (m.includes('nonce') || m.includes('audience'))
    return "Google sign-in isn't set up correctly for this site yet. Please use your mobile number."
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('token has expired') || m.includes('otp_expired'))
    return 'That code has expired. Tap "Resend code" for a new one.'
  if (m.includes('invalid') && (m.includes('token') || m.includes('otp')))
    return 'That code is not right. Check the SMS and try again.'
  if (m.includes('invalid phone') || m.includes('phone number'))
    return 'That does not look like a valid Indian mobile number.'
  return message
}
