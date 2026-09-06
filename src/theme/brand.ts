/**
 * FAA — Fast at any Accuracy. One place for the name, the lines and the
 * colours taken from the logo, so no screen carries its own copy.
 */
export const BRAND = {
  name: 'FAA',
  expansion: 'Fast at any Accuracy',
  tagline: 'FAA it, get it, love it',
  subline: 'Everyday essentials · delivered in minutes',
  city: 'Hospet',
  /** The delivery promise shown before a zone is known; zones.sla_minutes overrides per area. */
  promiseMinutes: 15,
  /** Assets cut from the master logo (public/brand). */
  logo: '/brand/faa-logo.jpg',
  mark: '/brand/faa-mark.png',
  wordmark: '/brand/faa-wordmark.png',
  red: '#E5231F',
  redDark: '#B8181C',
  ink: '#14181F',
} as const

/** Header surface for the categories, orders, tracking and rider screens. */
export const BRAND_GRADIENT = 'linear-gradient(135deg, #F04A45 0%, #B8181C 100%)'
export const MUTED_GRADIENT = '#59645E'
/** Light red tint for selected states. */
export const BRAND_TINT = '#FFF2F1'
export const BRAND_SHADOW = 'rgba(229,35,31,0.35)'
/** White storefront with borders separating products and working surfaces. */
export const PAGE_BG = '#FFFFFF'
/** A subtle outline shared by secondary screens. */
export const CARD_SHADOW = '0 0 0 1px #E7EBE7'
export const HEADER_SHADOW = '0 4px 14px rgba(0,0,0,0.14)'
